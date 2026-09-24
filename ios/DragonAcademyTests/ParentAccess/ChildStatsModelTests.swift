import API
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Store
import Testing
@testable import DragonAcademy

/// Answers `GET /api/parent/children/{id}/summary` from a queue (the last
/// reply repeating; none = no connection) and keeps what was sent.
private final class StubTransport: ClientTransport, @unchecked Sendable {
    struct Reply: Sendable {
        var status: HTTPResponse.Status = .ok
        var json: String
    }

    private let lock = NSLock()
    private var replies: [Reply]
    private var sent: [HTTPRequest] = []

    init(_ replies: [Reply]) { self.replies = replies }

    var requests: [HTTPRequest] { lock.withLock { sent } }

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let reply: Reply? = lock.withLock {
            sent.append(request)
            guard !replies.isEmpty else { return nil }
            return replies.count > 1 ? replies.removeFirst() : replies[0]
        }
        guard let reply else { throw URLError(.cannotConnectToHost) }
        var response = HTTPResponse(status: reply.status)
        response.headerFields[.contentType] = "application/json; charset=utf-8"
        return (response, HTTPBody(reply.json))
    }
}

private let summary = StubTransport.Reply(json: """
    {"child_id": 101,
     "play": {"minutes_today": 12, "minutes_7d": 45, "minutes_total": 300,
              "last_played_at": "2026-09-20T08:30:00.123Z"},
     "progress": {"current_node_id": 4, "nodes_won": 3, "stars": 8, "three_star_nodes": 2},
     "dragons": {"kinds": 2, "total": 4},
     "mastery": {"window_days": 30, "min_attempts": 5,
       "operators": [
         {"operator": "add", "total": 20, "child_wins": 18, "accuracy": 0.9, "avg_child_ms": 2100.5},
         {"operator": "mul", "total": 10, "child_wins": 6, "accuracy": 0.6, "avg_child_ms": null}],
       "strongest": "add", "weakest": "mul"}}
    """)

private let neverPlayed = StubTransport.Reply(json: """
    {"child_id": 101,
     "play": {"minutes_today": 0, "minutes_7d": 0, "minutes_total": 0, "last_played_at": null},
     "progress": {"current_node_id": 1, "nodes_won": 0, "stars": 0, "three_star_nodes": 0},
     "dragons": {"kinds": 0, "total": 0},
     "mastery": {"window_days": 30, "min_attempts": 5, "operators": [], "strongest": null, "weakest": null}}
    """)

private let expected = ChildStats(
    minutesToday: 12, minutesThisWeek: 45, minutesTotal: 300,
    lastPlayedAt: Date(timeIntervalSince1970: 1_789_893_000.123),
    frontierNode: 4, nodesWon: 3, stars: 8, threeStarNodes: 2, dragonKinds: 2, dragonsTotal: 4,
    masteryWindowDays: 30,
    operations: [
        .init(code: "add", answered: 20, solved: 18, accuracy: 0.9, averageSolveMs: 2100.5),
        .init(code: "mul", answered: 10, solved: 6, accuracy: 0.6, averageSolveMs: nil),
    ],
    strongest: "add", weakest: "mul")

@MainActor
private struct Harness {
    let transport: StubTransport
    let store: SQLiteStore
    let child: Profile
    let model: ChildStatsModel

    init(_ replies: [StubTransport.Reply], remoteID: Int? = 101) async throws {
        transport = StubTransport(replies)
        store = try SQLiteStore.inMemory()
        if let remoteID {
            child = try await store.addChildProfile(remoteID: remoteID, displayName: "Ada")
        } else {
            child = Profile(id: UUID(), kind: .child, remoteID: nil, displayName: "Ada", createdAt: .now)
        }
        let api = DragonAPIClient(baseURL: URL(string: "http://localhost:3001")!, transport: transport) { "parent.jwt" }.api
        model = ChildStatsModel(
            child: child, store: store, service: APIChildStatsService(api: api), uploadKinds: [NodeWon.kind])
    }
}

@MainActor @Test func loadsTheChildsStatsWithTheParentSession() async throws {
    let h = try await Harness([summary])

    await h.model.load()

    let sent = try #require(h.transport.requests.first)
    #expect(sent.method == .get)
    #expect(sent.path == "/api/parent/children/101/summary")
    #expect(sent.headerFields[.authorization] == "Bearer parent.jwt")
    let stats = try #require(h.model.stats)
    #expect(stats == expected)
    #expect(abs(try #require(stats.lastPlayedAt).timeIntervalSince1970 - 1_789_893_000.123) < 0.001)
    #expect(h.model.notice == nil)
    #expect(h.model.isLoading == false)
}

@MainActor @Test func aChildWhoHasNeverPlayedHasEmptyStats() async throws {
    let h = try await Harness([neverPlayed])
    await h.model.load()
    let stats = try #require(h.model.stats)
    #expect(stats == ChildStats())
    #expect(stats.lastPlayedAt == nil)
}

@MainActor @Test(arguments: [
    (StubTransport.Reply(status: .unauthorized, json: #"{"error": "Invalid or expired token"}"#),
     ChildStatsModel.Notice.sessionExpired),
    (.init(status: .forbidden, json: #"{"error": "Not your child"}"#), .notFound),
    (.init(status: .notFound, json: #"{"error": "Child not found"}"#), .notFound),
    (.init(status: .badRequest, json: #"{"error": "Invalid child id"}"#), .unavailable),
    (.init(status: .internalServerError, json: #"{"error": "boom"}"#), .unavailable),
    (.init(json: #"{"unexpected": true}"#), .unavailable),
])
private func failuresBecomeNotices(reply: StubTransport.Reply, notice: ChildStatsModel.Notice) async throws {
    let h = try await Harness([reply])
    await h.model.load()
    #expect(h.model.notice == notice)
    #expect(h.model.stats == nil)
}

@MainActor @Test func noConnectionIsUnavailable() async throws {
    let h = try await Harness([])
    await h.model.load()
    #expect(h.model.notice == .unavailable)
}

@MainActor @Test func aFailedRefreshKeepsTheLastStats() async throws {
    let h = try await Harness([summary, .init(status: .internalServerError, json: #"{"error": "boom"}"#)])
    await h.model.load()
    await h.model.load()
    #expect(h.model.stats == expected)
    #expect(h.model.notice == .unavailable)
    #expect(h.transport.requests.count == 2)
}

@MainActor @Test func aRefreshShowsNewlySyncedPlay() async throws {
    let h = try await Harness([neverPlayed, summary])
    await h.model.load()
    #expect(h.model.stats?.nodesWon == 0)
    await h.model.load()
    #expect(h.model.stats == expected)
}

@MainActor @Test func playStillQueuedOnThisDeviceIsCalledOut() async throws {
    let h = try await Harness([summary])
    let event = try await h.store.record(NodeWon(nodeID: 1, stars: 3), for: h.child.id)

    await h.model.load()
    #expect(h.model.hasUnsyncedPlay)

    try await h.store.markUploaded([event.id])
    await h.model.load()
    #expect(h.model.hasUnsyncedPlay == false)
}

@MainActor @Test func onlyThisChildsQueueAndUploadableKindsCount() async throws {
    let h = try await Harness([summary])
    let sibling = try await h.store.addChildProfile(remoteID: 102, displayName: "Bea")
    _ = try await h.store.record(NodeWon(nodeID: 1), for: sibling.id)
    // A kind Sync doesn't upload yet stays queued forever; it isn't "not synced yet".
    _ = try await h.store.record(DragonsCollected(dragonIDs: [1]), for: h.child.id)

    await h.model.load()
    #expect(h.model.hasUnsyncedPlay == false)
}

@MainActor @Test func aChildTheServerDoesntKnowIsNotFetched() async throws {
    let h = try await Harness([summary], remoteID: nil)
    await h.model.load()
    #expect(h.model.notice == .notFound)
    #expect(h.transport.requests.isEmpty)
}

@Test func parsesTimestampsWithAndWithoutMilliseconds() {
    #expect(ChildStats.parseDate("2026-09-20T08:30:00.123Z")?.timeIntervalSince1970 == 1_789_893_000.123)
    #expect(ChildStats.parseDate("2026-09-20T08:30:00Z")?.timeIntervalSince1970 == 1_789_893_000)
    #expect(ChildStats.parseDate("yesterday") == nil)
}

@Test func operationsHaveParentFacingNames() {
    #expect(OperationName.name("add") == "Addition")
    #expect(OperationName.name("div") == "Division")
    #expect(OperationName.name("pow") == "pow")
}
