import Foundation

/// Where MetricKit reports wait to be uploaded: one JSON file per report,
/// holding the request body exactly as it will be sent, in a directory of their
/// own.
///
/// Bounded three ways, because a report is only worth something while it's
/// recent and the upload is best effort: at most ``maxReports`` files (the
/// oldest go first), none older than ``maxAge``, and none bigger than
/// ``maxBytes`` (the server refuses more, so it's never written).
///
/// Order and age come from the file NAME (`<ms since 1970>-<id>.json`), never
/// from file-system timestamps, so this reads no required-reason API (see
/// DragonAcademy/PrivacyInfo.xcprivacy).
public struct DiagnosticsQueue: Sendable {
    /// One queued report.
    public struct Item: Sendable, Equatable {
        public let url: URL
        public let queuedAt: Date
    }

    public let directory: URL
    public var maxReports: Int
    public var maxAge: TimeInterval
    /// The largest request body kept; the server takes 256 KB.
    public var maxBytes: Int

    public init(
        directory: URL, maxReports: Int = 20, maxAge: TimeInterval = 30 * 24 * 60 * 60, maxBytes: Int = 250 * 1024
    ) {
        self.directory = directory
        self.maxReports = maxReports
        self.maxAge = maxAge
        self.maxBytes = maxBytes
    }

    /// `Application Support/Diagnostics/MetricKit`, excluded from backups.
    public static func applicationDefault() throws -> DiagnosticsQueue {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return DiagnosticsQueue(directory: support.appending(path: "Diagnostics/MetricKit", directoryHint: .isDirectory))
    }

    /// Queues `body` (a request body) and trims the queue to ``maxReports``.
    /// Returns false, writing nothing, when it's over ``maxBytes``.
    @discardableResult
    func add(_ body: Data, id: UUID, at date: Date) throws -> Bool {
        guard body.count <= maxBytes else { return false }
        try prepareDirectory()
        let millis = Int64((date.timeIntervalSince1970 * 1000).rounded(.down))
        let name = String(format: "%015lld-%@.json", millis, id.uuidString)
        try body.write(to: directory.appending(path: name), options: .atomic)
        let items = try list()
        for item in items.dropLast(maxReports) { remove(item) }
        return true
    }

    /// The queued reports, oldest first, after dropping any older than
    /// ``maxAge``.
    func pending(now: Date) throws -> [Item] {
        let (fresh, stale) = try list().reduce(into: ([Item](), [Item]())) { split, item in
            if now.timeIntervalSince(item.queuedAt) > maxAge { split.1.append(item) } else { split.0.append(item) }
        }
        stale.forEach(remove)
        return fresh
    }

    func data(for item: Item) throws -> Data { try Data(contentsOf: item.url) }

    func remove(_ item: Item) { try? FileManager.default.removeItem(at: item.url) }

    private func list() throws -> [Item] {
        guard FileManager.default.fileExists(atPath: directory.path(percentEncoded: false)) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .compactMap { url -> Item? in
                guard url.pathExtension == "json",
                      let millis = url.lastPathComponent.split(separator: "-").first.flatMap({ Int64($0) })
                else { return nil }
                return Item(url: url, queuedAt: Date(timeIntervalSince1970: Double(millis) / 1000))
            }
            .sorted { $0.url.lastPathComponent < $1.url.lastPathComponent }
    }

    private func prepareDirectory() throws {
        guard !FileManager.default.fileExists(atPath: directory.path(percentEncoded: false)) else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Crash reports have no business in an iCloud or computer backup.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var url = directory
        try? url.setResourceValues(values)
    }
}
