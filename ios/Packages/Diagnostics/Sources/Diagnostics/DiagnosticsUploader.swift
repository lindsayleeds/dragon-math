import API
import Foundation
import OSLog

/// Queues MetricKit reports on the device and uploads them to
/// `POST /api/diagnostics/metrickit`, best effort.
///
/// Nothing here ever blocks or fails the caller: ``submit(_:kind:)`` returns at
/// once, and every problem — a malformed or oversized report, a full queue, no
/// network, a server error — is logged and absorbed. A report leaves the queue
/// when the server accepts it (202) or refuses it for good (400, 413); anything
/// else (429, 5xx, a status this build doesn't know, no network) stops the
/// flush and leaves the rest for the next one. The server stores a resend of
/// the same report id once, so a response lost after upload costs nothing.
///
/// Reports are not linked to anyone: build the client with a token provider
/// that returns nil (the app does), so no `Authorization` header is sent. The
/// server ignores one anyway.
public actor DiagnosticsUploader {
    /// Which MetricKit payload a report came from.
    public enum Kind: String, Sendable {
        /// An `MXMetricPayload`: about a day of launch, hang, memory, energy
        /// and disk metrics.
        case metric
        /// An `MXDiagnosticPayload`: crash, hang, CPU, disk-write or launch
        /// diagnostics with call stacks.
        case diagnostic
    }

    /// What one flush did.
    public struct FlushReport: Sendable, Equatable {
        /// Accepted by the server and removed.
        public var uploaded = 0
        /// Refused for good (or unreadable) and removed.
        public var dropped = 0
        /// Left in the queue for the next flush.
        public var remaining = 0

        public init() {}
    }

    private let queue: DiagnosticsQueue
    private let api: any APIProtocol
    private let appVersion: String
    private let osVersion: String
    private let now: @Sendable () -> Date
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Diagnostics")

    private var running: Task<FlushReport, Never>?
    private var flushAgain = false

    /// - Parameters:
    ///   - client: the server. Give it a token provider returning nil.
    ///   - appVersion: e.g. "1.0 (42)"; see ``appVersion(of:)``.
    ///   - osVersion: e.g. `ProcessInfo.processInfo.operatingSystemVersionString`.
    public init(
        queue: DiagnosticsQueue,
        client: DragonAPIClient,
        appVersion: String,
        osVersion: String,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.queue = queue
        api = client.api
        self.appVersion = String(appVersion.prefix(32))
        self.osVersion = String(osVersion.prefix(64))
        self.now = now
    }

    /// "<CFBundleShortVersionString> (<CFBundleVersion>)", e.g. "1.0 (42)".
    public static func appVersion(of bundle: Bundle) -> String {
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(version) (\(build))"
    }

    // MARK: - Entry points

    /// Queues each report (a payload's `jsonRepresentation()`) and starts an
    /// upload in the background. Returns at once — safe on MetricKit's
    /// delivery queue or the main thread.
    public nonisolated func submit(_ reports: [Data], kind: Kind) {
        Task {
            for report in reports { await self.enqueue(report, kind: kind) }
            await self.flush()
        }
    }

    /// Starts an upload of whatever is queued in the background, e.g. when the
    /// app comes to the foreground. Returns at once.
    public nonisolated func requestFlush() {
        Task { await self.flush() }
    }

    /// Queues one report. Returns false (and queues nothing) when it isn't a
    /// JSON object, is too big to upload, or can't be written.
    @discardableResult
    public func enqueue(_ report: Data, kind: Kind) -> Bool {
        guard let payload = try? JSONSerialization.jsonObject(with: report), payload is [String: Any] else {
            log.error("diagnostics: dropping a \(kind.rawValue, privacy: .public) report that isn't a JSON object")
            return false
        }
        let id = UUID()
        let body: [String: Any] = [
            "id": id.uuidString,
            "kind": kind.rawValue,
            "app_version": appVersion,
            "os_version": osVersion,
            "payload": payload,
        ]
        do {
            let data = try JSONSerialization.data(withJSONObject: body)
            guard try queue.add(data, id: id, at: now()) else {
                log.error("diagnostics: dropping a \(kind.rawValue, privacy: .public) report of \(data.count) bytes, over the limit")
                return false
            }
            return true
        } catch {
            log.error("diagnostics: couldn't queue a report: \(error)")
            return false
        }
    }

    /// Uploads what's queued, oldest first, until the queue is empty or the
    /// server or network says to stop. One flush runs at a time; asking during
    /// one joins it, and it goes round again for reports queued meanwhile.
    @discardableResult
    public func flush() async -> FlushReport {
        if let running {
            flushAgain = true
            return await running.value
        }
        let task = Task { await self.run() }
        running = task
        return await task.value
    }

    // MARK: - Uploading

    private func run() async -> FlushReport {
        var report = FlushReport()
        repeat {
            flushAgain = false
            if !(await drain(&report)) { break }
        } while flushAgain
        report.remaining = (try? queue.pending(now: now()).count) ?? 0
        running = nil
        return report
    }

    /// Returns false when it stopped early (leave the rest for later).
    private func drain(_ report: inout FlushReport) async -> Bool {
        let items: [DiagnosticsQueue.Item]
        do {
            items = try queue.pending(now: now())
        } catch {
            log.error("diagnostics: couldn't read the queue: \(error)")
            return false
        }
        for item in items {
            let request: Components.Schemas.MetricKitUploadRequest
            do {
                request = try JSONDecoder().decode(Components.Schemas.MetricKitUploadRequest.self, from: queue.data(for: item))
            } catch {
                log.error("diagnostics: dropping an unreadable queued report: \(error)")
                queue.remove(item)
                report.dropped += 1
                continue
            }
            switch await upload(request) {
            case .accepted:
                queue.remove(item)
                report.uploaded += 1
            case .refused:
                queue.remove(item)
                report.dropped += 1
            case .later:
                return false
            }
        }
        return true
    }

    private enum Verdict { case accepted, refused, later }

    private func upload(_ request: Components.Schemas.MetricKitUploadRequest) async -> Verdict {
        do {
            switch try await api.uploadMetricKitPayload(body: .json(request)) {
            case .accepted:
                return .accepted
            case .badRequest(let response):
                let message = (try? response.body.json.error) ?? "?"
                log.error("diagnostics: server refused a report: \(message, privacy: .public)")
                return .refused
            case .contentTooLarge:
                log.error("diagnostics: server refused a report as too large")
                return .refused
            case .tooManyRequests:
                return .later
            case .undocumented(let status, _):
                log.error("diagnostics: upload got HTTP \(status)")
                return .later
            }
        } catch {
            log.debug("diagnostics: upload failed: \(error)")
            return .later
        }
    }
}
