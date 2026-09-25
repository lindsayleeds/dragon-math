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
                id: UUID(), kind: .guest, remoteID: nil, displayName: "Guest", createdAt: .milliseconds(now()),
                telemetryOptOut: false)
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
                createdAt: createdAt, telemetryOptOut: false)
            try child.insert(db)
            return child.profile
        }
    }

    public func setTelemetryOptOut(_ optOut: Bool, for profileID: Profile.ID) async throws {
        try await writer.write { db in
            _ = try ProfileRecord.filter(key: profileID)
                .updateAll(db, Column("telemetryOptOut").set(to: optOut))
        }
    }

    @discardableResult
    public func saveChildProfile(remoteID: Int, displayName: String, avatar: String?) async throws -> Profile {
        let createdAt = Int64.milliseconds(now())
        return try await writer.write { db in
            if var existing = try ProfileRecord.filter(Column("remoteID") == remoteID).fetchOne(db) {
                if existing.displayName != displayName || existing.avatar != avatar {
                    existing.displayName = displayName
                    existing.avatar = avatar
                    try existing.update(db)
                }
                return existing.profile
            }
            let child = ProfileRecord(
                id: UUID(), kind: .child, remoteID: remoteID, displayName: displayName, avatar: avatar,
                createdAt: createdAt, telemetryOptOut: false)
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

    public func uploadedEventsNotInServerProgress(for profileID: Profile.ID) async throws -> [StoredEvent.ID] {
        try await writer.read { db in
            try UUID.fetchAll(
                db,
                sql: """
                    SELECT id FROM events
                    WHERE profileID = ? AND uploadState = ? AND NOT inServerProgress
                    ORDER BY occurredAt, rowid
                    """,
                arguments: [profileID, UploadState.uploaded.rawValue])
        }
    }

    public func saveServerProgress(
        _ progress: ServerProgress, for profileID: Profile.ID, covering eventIDs: [StoredEvent.ID]
    ) async throws {
        let fetchedAt = Int64.milliseconds(now())
        try await writer.write { db in
            try db.execute(
                sql: """
                    INSERT INTO serverProgress (profileID, currentNodeID, playMinutes, fetchedAt) VALUES (?, ?, ?, ?)
                    ON CONFLICT (profileID) DO UPDATE SET
                        currentNodeID = excluded.currentNodeID,
                        playMinutes = excluded.playMinutes,
                        fetchedAt = excluded.fetchedAt
                    """,
                arguments: [profileID, progress.currentNodeID, progress.playMinutes, fetchedAt])
            try db.execute(sql: "DELETE FROM serverNodes WHERE profileID = ?", arguments: [profileID])
            for (node, stars) in progress.stars {
                try db.execute(
                    sql: "INSERT INTO serverNodes (profileID, nodeID, stars) VALUES (?, ?, ?)",
                    arguments: [profileID, node, stars])
            }
            try db.execute(sql: "DELETE FROM serverDragons WHERE profileID = ?", arguments: [profileID])
            for (dragon, count) in progress.dragons {
                try db.execute(
                    sql: "INSERT INTO serverDragons (profileID, dragonID, count) VALUES (?, ?, ?)",
                    arguments: [profileID, dragon, count])
            }
            if !eventIDs.isEmpty {
                // Only this profile's events, and only ones already uploaded: a
                // pending event can't be in what the server sent.
                _ = try EventRecord.filter(keys: eventIDs)
                    .filter(Column("profileID") == profileID)
                    .filter(Column("uploadState") == UploadState.uploaded.rawValue)
                    .updateAll(db, Column("inServerProgress").set(to: true))
            }
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

    public func cachedContent(_ name: ContentName) async throws -> CachedContent? {
        try await writer.read { db in try ContentRecord.fetchOne(db, key: name.rawValue)?.content }
    }

    public func saveContent(_ name: ContentName, version: String, json: Data) async throws {
        let record = ContentRecord(name: name.rawValue, version: version, json: json, syncedAt: .milliseconds(now()))
        try await writer.write { db in try record.save(db) }
    }

    /// Progress is computed on every read rather than stored, so it can never
    /// disagree with the queue or the saved server progress.
    ///
    /// Wins, stars and the frontier come out the same however often an event
    /// is counted, so every local event counts, merged with the server's by
    /// union and max. Dragons add up, so a local catch counts only while the
    /// saved server progress doesn't include it (`inServerProgress`); once it
    /// does, it's in the server's total instead.
    private static func fetchProgress(_ db: Database, _ profileID: Profile.ID) throws -> ProfileProgress {
        var progress = ProfileProgress()
        var frontier = 1

        let wins = try Row.fetchAll(
            db,
            sql: """
                SELECT json_extract(payload, '$.nodeId') AS node, MAX(json_extract(payload, '$.stars')) AS stars
                FROM events
                WHERE profileID = ? AND kind = ?
                GROUP BY node
                """,
            arguments: [profileID, NodeWon.kind.rawValue])
        for row in wins {
            let node: Int = row["node"]
            progress.nodesWon.insert(node)
            if let stars: Int = row["stars"] { progress.stars[node] = stars }
            frontier = max(frontier, node + 1)
        }

        let serverNodes = try Row.fetchAll(
            db, sql: "SELECT nodeID, stars FROM serverNodes WHERE profileID = ?", arguments: [profileID])
        for row in serverNodes {
            let node: Int = row["nodeID"]
            let stars: Int = row["stars"]
            progress.nodesWon.insert(node)
            progress.stars[node] = max(progress.stars[node] ?? stars, stars)
            frontier = max(frontier, node + 1)
        }

        if let server = try Row.fetchOne(
            db, sql: "SELECT currentNodeID, playMinutes FROM serverProgress WHERE profileID = ?",
            arguments: [profileID])
        {
            frontier = max(frontier, server["currentNodeID"])
            progress.playMinutes = server["playMinutes"]
        }
        progress.frontier = frontier

        let serverDragons = try Row.fetchAll(
            db, sql: "SELECT dragonID, count FROM serverDragons WHERE profileID = ?", arguments: [profileID])
        for row in serverDragons {
            progress.dragons[row["dragonID"], default: 0] += row["count"] as Int
        }
        let localDragons = try Row.fetchAll(
            db,
            sql: """
                SELECT dragon.value AS dragonID, COUNT(*) AS count
                FROM events, json_each(events.payload, '$.dragonIds') AS dragon
                WHERE events.profileID = ? AND events.kind = ? AND NOT events.inServerProgress
                GROUP BY dragon.value
                """,
            arguments: [profileID, DragonsCollected.kind.rawValue])
        for row in localDragons {
            progress.dragons[row["dragonID"], default: 0] += row["count"] as Int
        }
        let runs = try String.fetchAll(
            db, sql: "SELECT payload FROM events WHERE profileID = ? AND kind = ?",
            arguments: [profileID, ProvingMedalEarned.kind.rawValue]
        ).compactMap { try? EventCoding.decoder.decode(ProvingMedalEarned.self, from: Data($0.utf8)) }
        progress.provingBests = ProvingBest.bests(from: runs)
        return progress
    }
}

// MARK: - Records

private struct ProfileRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "profiles"

    var id: UUID
    var kind: Profile.Kind
    var remoteID: Int?
    var displayName: String
    var avatar: String? = nil
    var createdAt: Int64
    var telemetryOptOut: Bool

    var profile: Profile {
        Profile(
            id: id, kind: kind, remoteID: remoteID, displayName: displayName, avatar: avatar,
            createdAt: .init(milliseconds: createdAt), telemetryOptOut: telemetryOptOut)
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

private struct ContentRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "content_cache"

    var name: String
    var version: String
    var json: Data
    var syncedAt: Int64

    var content: CachedContent {
        CachedContent(
            name: ContentName(rawValue: name), version: version, json: json,
            syncedAt: .init(milliseconds: syncedAt))
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
