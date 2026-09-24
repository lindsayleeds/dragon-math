import API
import Foundation
import OSLog
import Store

/// Why a sync was asked for; only logged.
public enum SyncTrigger: String, Sendable {
    /// The app asked, e.g. at the end of a battle.
    case explicit
    /// The app came to the foreground.
    case foreground
    /// The network came back.
    case reconnected
}

/// What one sync run did.
public struct SyncReport: Sendable, Equatable {
    public enum Outcome: Sendable, Equatable {
        /// Every sendable event of every eligible profile was sent and
        /// acknowledged (or there was nothing to send).
        case finished
        /// Signed out: nothing was sent.
        case noSession
        /// The network is down; the next reconnect tries again.
        case offline
        /// The server refused the session (401); nothing more is sent until
        /// the next trigger.
        case unauthorized
        /// The server rejected the whole batch (400). A bug, not a network
        /// problem, so it isn't retried until the next trigger.
        case badRequest
        /// Still failing after every retry; the next trigger tries again.
        case gaveUp
    }

    public var outcome: Outcome = .finished
    /// Upload requests made, retries included.
    public var requests = 0
    /// Events the server acknowledged, now marked uploaded. Includes the two
    /// below.
    public var acknowledged = 0
    /// Acknowledged as already received — a resend after a lost response.
    public var duplicates = 0
    /// Acknowledged but rejected for good (see the server's `reason`); dropped
    /// from the queue, since no resend could fix them.
    public var rejected = 0

    public init() {}
}

/// Uploads the Store's event queue to `POST /api/sync/events` (ADR 0003).
///
/// Only child profiles with a server id upload, and only while signed in; the
/// guest stays on the device until a parent signs up. Events go oldest first,
/// in batches, one profile at a time. An event is marked uploaded only when the
/// server acknowledges it; `failed` ones stay pending and the batch is retried
/// with exponential backoff and jitter. The server dedupes by event id, so a
/// resend after a lost response is harmless.
///
/// One sync runs at a time. Asking while one is running joins it and makes it
/// go round once more at the end, so events recorded meanwhile aren't left
/// behind. Everything runs on this actor, never on the main actor, and callers
/// in the UI use ``requestSync(_:)``, which returns at once: play never waits
/// on the network.
public actor SyncEngine {
    public struct Configuration: Sendable {
        /// Events per request; the server takes at most 100.
        public var batchSize: Int
        public var retry: RetryPolicy

        public init(batchSize: Int = 100, retry: RetryPolicy = RetryPolicy()) {
            self.batchSize = batchSize
            self.retry = retry
        }
    }

    /// Waits for a duration; `Task.sleep` in the app, instant in tests.
    public typealias Sleep = @Sendable (Duration) async throws -> Void

    private let store: any Store
    private let api: any APIProtocol
    private let hasSession: @Sendable () async -> Bool
    private let reachability: (any NetworkReachability)?
    private let configuration: Configuration
    private let mappings: [EventKind: SyncKindMapping]
    private let sleep: Sleep
    private let random: @Sendable () -> Double
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Sync")

    private var running: Task<SyncReport, Never>?
    private var runAgain = false
    private var isOnline = true
    private var watching: Task<Void, Never>?

    /// - Parameters:
    ///   - client: the server; its token provider supplies the session.
    ///   - hasSession: whether a session token is available now. While it's
    ///     false nothing is sent.
    ///   - reachability: network status, for uploading on reconnect and not
    ///     retrying while offline. Nil treats the network as always up.
    ///   - kinds: which Store kinds upload, and how (``SyncKinds/all``).
    ///   - sleep: the backoff wait.
    ///   - random: jitter, in [0, 1).
    public init(
        store: any Store,
        client: DragonAPIClient,
        hasSession: @escaping @Sendable () async -> Bool,
        reachability: (any NetworkReachability)? = nil,
        configuration: Configuration = Configuration(),
        kinds: [SyncKindMapping] = SyncKinds.all,
        sleep: @escaping Sleep = { try await Task.sleep(for: $0) },
        random: @escaping @Sendable () -> Double = { Double.random(in: 0..<1) }
    ) {
        self.store = store
        api = client.api
        self.hasSession = hasSession
        self.reachability = reachability
        self.configuration = configuration
        mappings = Dictionary(kinds.map { ($0.storeKind, $0) }, uniquingKeysWith: { first, _ in first })
        self.sleep = sleep
        self.random = random
    }

    // MARK: - Triggers

    /// Starts a sync in the background and returns at once. For the UI: the
    /// end of a battle, the app coming to the foreground.
    public nonisolated func requestSync(_ trigger: SyncTrigger = .explicit) {
        Task { await self.syncNow(trigger) }
    }

    /// Syncs and returns what happened. If a sync is already running this
    /// joins it (and it goes round once more for anything recorded since).
    @discardableResult
    public func syncNow(_ trigger: SyncTrigger = .explicit) async -> SyncReport {
        if let running {
            runAgain = true
            return await running.value
        }
        log.debug("sync (\(trigger.rawValue, privacy: .public))")
        let task = Task { await self.run() }
        running = task
        return await task.value
    }

    /// Starts watching the network and syncs whenever it comes back. Call once
    /// at launch; ``stop()`` ends it.
    public func start() {
        guard watching == nil, let reachability else { return }
        watching = Task { [weak self] in
            for await online in reachability.updates() {
                await self?.networkChanged(online: online)
            }
        }
    }

    /// Whether the network was up at the last report (true without
    /// reachability, or before its first report).
    public var isNetworkAvailable: Bool { isOnline }

    /// Stops watching the network. A sync already running finishes.
    public func stop() {
        watching?.cancel()
        watching = nil
    }

    private func networkChanged(online: Bool) {
        let regained = online && !isOnline
        isOnline = online
        if regained { requestSync(.reconnected) }
    }

    // MARK: - Running

    private func run() async -> SyncReport {
        var report = SyncReport()
        repeat {
            runAgain = false
            await runWithRetries(&report)
        } while runAgain && report.outcome == .finished
        running = nil
        return report
    }

    private func runWithRetries(_ report: inout SyncReport) async {
        var retries = 0
        while true {
            let acknowledgedBefore = report.acknowledged
            switch await drain(&report) {
            case .finished:
                report.outcome = .finished
                return
            case .stop(let outcome):
                report.outcome = outcome
                return
            case .retry:
                // Progress resets the count: the queue shrank, so this isn't
                // the same failure over and over.
                retries = report.acknowledged > acknowledgedBefore ? 1 : retries + 1
                guard isOnline else {
                    report.outcome = .offline
                    return
                }
                guard retries <= configuration.retry.maxRetries else {
                    log.error("sync: giving up after \(retries - 1) retries")
                    report.outcome = .gaveUp
                    return
                }
                do {
                    try await sleep(configuration.retry.delay(beforeRetry: retries, random: random()))
                } catch {
                    report.outcome = .gaveUp
                    return
                }
            }
        }
    }

    private enum Step {
        case finished
        case retry
        case stop(SyncReport.Outcome)
    }

    /// One pass over every eligible profile's queue.
    private func drain(_ report: inout SyncReport) async -> Step {
        guard await hasSession() else { return .stop(.noSession) }
        let profiles: [Profile]
        do {
            profiles = try await store.profiles()
        } catch {
            log.error("sync: couldn't read profiles: \(error)")
            return .retry
        }
        for profile in profiles where profile.kind == .child {
            guard let childID = profile.remoteID else { continue }
            let step = await drain(profile, childID: childID, &report)
            if case .finished = step { continue }
            return step
        }
        return .finished
    }

    private func drain(_ profile: Profile, childID: Int, _ report: inout SyncReport) async -> Step {
        let kinds = Set(mappings.keys)
        while true {
            let batch: [StoredEvent]
            do {
                batch = try await store.pendingEvents(for: profile.id, kinds: kinds, limit: configuration.batchSize)
            } catch {
                log.error("sync: couldn't read the queue: \(error)")
                return .retry
            }
            if batch.isEmpty { return .finished }

            var sending: [(event: StoredEvent, wire: Components.Schemas.SyncEvent)] = []
            for event in batch {
                do {
                    guard let mapping = mappings[event.kind] else { continue }
                    sending.append((event, try mapping.syncEvent(for: event, childID: childID)))
                } catch {
                    // Stays pending: a later app version may read it.
                    log.fault("sync: can't send event \(event.id) (\(event.kind)): \(error)")
                }
            }
            if sending.isEmpty { return .finished }

            report.requests += 1
            let results: [Components.Schemas.SyncEventResult]
            switch await upload(sending.map(\.wire)) {
            case .results(let r): results = r
            case .retry: return .retry
            case .stop(let outcome): return .stop(outcome)
            }

            var acknowledged: [StoredEvent.ID] = []
            var anyFailed = false
            for (index, sent) in sending.enumerated() {
                guard let result = results.first(where: { $0.index == index }),
                    result.id?.lowercased() == sent.wire.id.lowercased(), result.acknowledged
                else {
                    anyFailed = true
                    continue
                }
                acknowledged.append(sent.event.id)
                switch result.status {
                case "duplicate": report.duplicates += 1
                case "rejected":
                    report.rejected += 1
                    log.error(
                        "sync: event \(sent.event.id) rejected: \(result.reason ?? "", privacy: .public) \(result.message ?? "", privacy: .public)"
                    )
                default: break
                }
            }
            do {
                try await store.markUploaded(acknowledged)
            } catch {
                // Still pending, so it's sent again: a duplicate, harmless.
                log.error("sync: couldn't mark events uploaded: \(error)")
                return .retry
            }
            report.acknowledged += acknowledged.count
            if anyFailed { return .retry }
            if batch.count < configuration.batchSize { return .finished }
        }
    }

    private enum UploadResult {
        case results([Components.Schemas.SyncEventResult])
        case retry
        case stop(SyncReport.Outcome)
    }

    private func upload(_ events: [Components.Schemas.SyncEvent]) async -> UploadResult {
        let output: Operations.UploadSyncEvents.Output
        do {
            output = try await api.uploadSyncEvents(body: .json(.init(events: events)))
        } catch {
            log.info("sync: upload failed: \(error)")
            return isOnline ? .retry : .stop(.offline)
        }
        switch output {
        case .ok(let ok):
            do {
                return .results(try ok.body.json.results)
            } catch {
                return .retry
            }
        case .tooManyRequests:
            return .retry
        case .unauthorized:
            return .stop(.unauthorized)
        case .badRequest(let bad):
            let message = (try? bad.body.json.error) ?? ""
            log.fault("sync: batch refused: \(message, privacy: .public)")
            return .stop(.badRequest)
        case .undocumented(let status, _):
            log.info("sync: upload got HTTP \(status)")
            return .retry
        }
    }
}
