import API
import Foundation
import Store
import Sync
import Testing

/// A family iPad (issue #124): two siblings take turns on one device, each with
/// their own profile and queue. The server drops (`not_your_child`) any event a
/// kid's session sends for a sibling, so the queues must go up with the
/// parent's session, and a kid's own session may only send that kid's.
@Suite struct FamilyDeviceTests {
    static let adaID = 1
    static let boID = 2

    let store: SQLiteStore
    let server = FakeSyncServer()
    let ada: Profile
    let bo: Profile

    init() async throws {
        let clock = TickingClock()
        store = try .inMemory(now: { clock.now() })
        ada = try await store.saveChildProfile(remoteID: Self.adaID, displayName: "sparky", avatar: "🐉")
        bo = try await store.saveChildProfile(remoteID: Self.boID, displayName: "ember", avatar: "🦊")
        server.kidTokens = ["kid-ada": Self.adaID, "kid-bo": Self.boID]
    }

    /// An engine whose client sends `token` and whose session is `session`.
    func engine(token: String, session: @escaping @Sendable () -> SyncSession) -> SyncEngine {
        SyncEngine(
            store: store,
            client: DragonAPIClient(baseURL: baseURL, transport: server) { token },
            session: { session() },
            configuration: .init(retry: RetryPolicy(maxRetries: 1)),
            sleep: { _ in },
            random: { 0.5 })
    }

    /// Each sibling plays in turn.
    func takeTurns() async throws -> (ada: [StoredEvent], bo: [StoredEvent]) {
        var adaEvents: [StoredEvent] = []
        var boEvents: [StoredEvent] = []
        adaEvents.append(try await store.record(NodeWon(nodeID: 1, stars: 3), for: ada.id))
        boEvents.append(try await store.record(NodeWon(nodeID: 1, stars: 1), for: bo.id))
        boEvents.append(try await store.record(NodeWon(nodeID: 2, stars: 2), for: bo.id))
        adaEvents.append(try await store.record(DragonsCollected(dragonIDs: [4]), for: ada.id))
        return (adaEvents, boEvents)
    }

    func pending(_ profile: Profile) async throws -> [StoredEvent] {
        try await store.events(for: profile.id).filter { $0.uploadState == .pending }
    }

    /// Which child each uploaded event was sent for, by event id.
    var sentChildByEvent: [String: Int] {
        Dictionary(
            server.requests.flatMap(\.events).map { ($0["id"] as! String, $0["child_id"] as! Int) },
            uniquingKeysWith: { first, _ in first })
    }

    @Test func theParentSessionUploadsEverySiblingsQueueUnderTheirOwnChild() async throws {
        let played = try await takeTurns()

        let report = await engine(token: "parent-jwt", session: { .parent }).syncNow()

        #expect(report.outcome == .finished)
        #expect(report.acknowledged == 4)
        #expect(report.rejected == 0)
        #expect(report.skippedProfiles == 0)
        #expect(server.requests.allSatisfy { $0.authorization == "Bearer parent-jwt" })
        // One child per request, and every event under the child who played it.
        #expect(server.requests.allSatisfy { Set($0.events.map { $0["child_id"] as! Int }).count == 1 })
        var expected: [String: Int] = [:]
        for event in played.ada { expected[event.id.uuidString] = Self.adaID }
        for event in played.bo { expected[event.id.uuidString] = Self.boID }
        #expect(sentChildByEvent == expected)
        #expect(Set(server.progressRequests.map(\.childID)) == [Self.adaID, Self.boID])
        #expect(server.progressRequests.allSatisfy { $0.authorization == "Bearer parent-jwt" })

        #expect(try await pending(ada).isEmpty)
        #expect(try await pending(bo).isEmpty)
        // Progress stays each kid's own after the pull.
        #expect(try await store.progress(for: ada.id) == ProfileProgress(
            nodesWon: [1], stars: [1: 3], frontier: 2, dragons: [4: 1]))
        #expect(try await store.progress(for: bo.id) == ProfileProgress(
            nodesWon: [1, 2], stars: [1: 1, 2: 2], frontier: 3))
    }

    @Test func aKidSessionNeverSendsASiblingsQueue() async throws {
        let played = try await takeTurns()

        let report = await engine(token: "kid-ada", session: { .child(Self.adaID) }).syncNow()

        #expect(report.outcome == .finished)
        #expect(report.acknowledged == 2)
        #expect(report.rejected == 0)
        #expect(report.skippedProfiles == 1)
        #expect(Set(sentChildByEvent.values) == [Self.adaID])
        #expect(server.progressRequests.map(\.childID) == [Self.adaID])
        #expect(try await pending(ada).isEmpty)
        // Bo's events wait on the device rather than being dropped.
        #expect(try await pending(bo) == played.bo)

        // Once the parent's session is back, Bo's go up under Bo.
        let later = await engine(token: "parent-jwt", session: { .parent }).syncNow()
        #expect(later.acknowledged == 2)
        #expect(later.rejected == 0)
        #expect(try await pending(bo).isEmpty)
        #expect(played.bo.allSatisfy { sentChildByEvent[$0.id.uuidString] == Self.boID })
        #expect(server.received.values.allSatisfy { $0 == 1 })
    }

    /// Why the rule exists: a kid's token sending for a sibling loses the
    /// sibling's play, since the server acknowledges and drops it.
    @Test func theServerDropsASiblingsEventsSentWithAKidsToken() async throws {
        _ = try await takeTurns()

        // An engine told the kid's token is a parent's.
        let report = await engine(token: "kid-ada", session: { .parent }).syncNow()

        #expect(report.rejected == 2)
        #expect(try await pending(bo).isEmpty)
        #expect(try await store.progress(for: bo.id).nodesWon == [1, 2])  // only on this device
        #expect(server.received.keys.count == 2)  // Ada's; Bo's never applied
    }

    @Test func signedOutNothingUploadsForAnyone() async throws {
        _ = try await takeTurns()

        let report = await engine(token: "parent-jwt", session: { .none }).syncNow()

        #expect(report.outcome == .noSession)
        #expect(server.requests.isEmpty)
        #expect(try await pending(ada).count == 2)
        #expect(try await pending(bo).count == 2)
    }
}
