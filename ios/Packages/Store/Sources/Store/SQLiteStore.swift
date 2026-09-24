import Foundation
import GRDB

/// The GRDB-backed `Store`. Open it once at launch and share it; it's safe to
/// use from any task.
public final class SQLiteStore: Store {
    public let guestProfile: Profile
    private let writer: any DatabaseWriter
    private let now: @Sendable () -> Date

    /// A store in a file, created with its directory if missing. Reopening the
    /// same file sees everything recorded before.
    public static func onDisk(at url: URL, now: @escaping @Sendable () -> Date = Date.init) throws -> SQLiteStore {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        return try SQLiteStore(writer: DatabasePool(path: url.path), now: now)
    }

    /// The app's store, in Application Support (backed up, never purged).
    public static func applicationDefault() throws -> SQLiteStore {
        let directory = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return try onDisk(at: directory.appending(path: "Store/store.sqlite"))
    }

    /// A throwaway store that lives only as long as this object; for tests
    /// and previews.
    public static func inMemory(now: @escaping @Sendable () -> Date = Date.init) throws -> SQLiteStore {
        try SQLiteStore(writer: DatabaseQueue(), now: now)
    }

    private init(writer: any DatabaseWriter, now: @escaping @Sendable () -> Date) throws {
        try Schema.migrator.migrate(writer)
        self.writer = writer
        self.now = now
        guestProfile = try writer.write { db in
            if let guest = try ProfileRecord.filter(Column("kind") == Profile.Kind.guest.rawValue)
                .order(Column("createdAt")).fetchOne(db)
            {
                return guest.profile
            }
            let guest = ProfileRecord(
                id: UUID(), kind: .guest, remoteID: nil, displayName: "Guest", createdAt: .milliseconds(now()))
            try guest.insert(db)
            return guest.profile
        }
    }

    public func profiles() async throws -> [Profile] {
        try await writer.read { db in
            try ProfileRecord.order(
                sql: "CASE kind WHEN 'guest' THEN 0 ELSE 1 END, createdAt, rowid"
            ).fetchAll(db).map(\.profile)
        }
    }

    public func addChildProfile(remoteID: Int, displayName: String) async throws -> Profile {
        let createdAt = Int64.milliseconds(now())
        return try await writer.write { db in
            if let existing = try ProfileRecord.filter(Column("remoteID") == remoteID).fetchOne(db) {
                return existing.profile
            }
            let child = ProfileRecord(
                id: UUID(), kind: .child, remoteID: remoteID, displayName: displayName,
                createdAt: createdAt)
            try child.insert(db)
            return child.profile
        }
    }

    @discardableResult
    public func record<Payload: EventPayload>(_ payload: Payload, for profileID: Profile.ID) async throws
        -> StoredEvent
    {
        let json = try EventCoding.encoder.encode(payload)
        let event = EventRecord(
            id: UUID(), profileID: profileID, kind: Payload.kind.rawValue,
            payload: String(decoding: json, as: UTF8.self), occurredAt: .milliseconds(now()),
            uploadState: .pending)
        try await writer.write { db in try event.insert(db) }
        return event.event
    }

    public func events(for profileID: Profile.ID) async throws -> [StoredEvent] {
        try await writer.read { db in
            try EventRecord.filter(Column("profileID") == profileID)
                .order(Column("occurredAt"), Column.rowID)
                .fetchAll(db).map(\.event)
        }
    }

    public func pendingEvents(limit: Int) async throws -> [StoredEvent] {
        try await writer.read { db in
            try EventRecord.filter(Column("uploadState") == UploadState.pending.rawValue)
                .order(Column("occurredAt"), Column.rowID)
                .limit(limit)
                .fetchAll(db).map(\.event)
        }
    }

    public func pendingEvents(for profileID: Profile.ID, kinds: Set<EventKind>, limit: Int) async throws
        -> [StoredEvent]
    {
        guard !kinds.isEmpty else { return [] }
        return try await writer.read { db in
            try EventRecord.filter(Column("uploadState") == UploadState.pending.rawValue)
                .filter(Column("profileID") == profileID)
                .filter(kinds.map(\.rawValue).contains(Column("kind")))
                .order(Column("occurredAt"), Column.rowID)
                .limit(limit)
                .fetchAll(db).map(\.event)
        }
    }

    public func markUploaded(_ eventIDs: [StoredEvent.ID]) async throws {
        guard !eventIDs.isEmpty else { return }
        try await writer.write { db in
            _ = try EventRecord.filter(keys: eventIDs)
                .updateAll(db, Column("uploadState").set(to: UploadState.uploaded.rawValue))
        }
    }

    public func progress(for profileID: Profile.ID) async throws -> ProfileProgress {
        try await writer.read { db in try Self.fetchProgress(db, profileID) }
    }

    public func observeProgress(for profileID: Profile.ID) -> AsyncThrowingStream<ProfileProgress, any Error> {
        let values = ValueObservation
            .tracking { db in try Self.fetchProgress(db, profileID) }
            .removeDuplicates()
            .values(in: writer)
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await value in values {
                        continuation.yield(value)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Progress is computed from events on every read rather than stored, so
    /// it can never disagree with the queue.
    private static func fetchProgress(_ db: Database, _ profileID: Profile.ID) throws -> ProfileProgress {
        let nodes = try Int.fetchSet(
            db,
            sql: """
                SELECT DISTINCT json_extract(payload, '$.nodeId') FROM events
                WHERE profileID = ? AND kind = ?
                """,
            arguments: [profileID, NodeWon.kind.rawValue])
        return ProfileProgress(nodesWon: nodes)
    }
}

// MARK: - Records

private struct ProfileRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "profiles"

    var id: UUID
    var kind: Profile.Kind
    var remoteID: Int?
    var displayName: String
    var createdAt: Int64

    var profile: Profile {
        Profile(id: id, kind: kind, remoteID: remoteID, displayName: displayName, createdAt: .init(milliseconds: createdAt))
    }
}

private struct EventRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "events"

    var id: UUID
    var profileID: UUID
    var kind: String
    var payload: String
    var occurredAt: Int64
    var uploadState: UploadState

    var event: StoredEvent {
        StoredEvent(
            id: id, profileID: profileID, kind: EventKind(rawValue: kind), payload: Data(payload.utf8),
            occurredAt: .init(milliseconds: occurredAt), uploadState: uploadState)
    }
}

// Timestamps are stored as whole milliseconds since 1970, so a `Date` read
// back equals the one handed out when it was recorded.
extension Int64 {
    fileprivate static func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded(.down))
    }
}

extension Date {
    fileprivate init(milliseconds: Int64) {
        self.init(timeIntervalSince1970: Double(milliseconds) / 1000)
    }
}
