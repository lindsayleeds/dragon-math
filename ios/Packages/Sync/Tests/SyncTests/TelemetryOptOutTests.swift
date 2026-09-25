import API
import Foundation
import Store
import Sync
import Testing

/// A parent's per-child telemetry opt-out: telemetry kinds never leave the
/// device for that child, progress still does, and the queue doesn't grow.
@Suite struct TelemetryOptOutTests {
    let store: SQLiteStore
    let server = FakeSyncServer()
    let ada: Profile
    let bo: Profile

    init() async throws {
        let clock = TickingClock()
        store = try .inMemory(now: { clock.now() })
        ada = try await store.addChildProfile(remoteID: 42, displayName: "Ada")
        bo = try await store.addChildProfile(remoteID: 43, displayName: "Bo")
    }

    func engine(batchSize: Int = 100) -> SyncEngine {
        SyncEngine(
            store: store,
            client: DragonAPIClient(baseURL: baseURL, transport: server) { "parent-token" },
            hasSession: { true },
            configuration: .init(batchSize: batchSize, retry: RetryPolicy(maxRetries: 2)),
            kinds: SyncKinds.withTestAttempt,
            content: [],
            sleep: { _ in },
            random: { 0.5 })
    }

    /// Kinds sent to the server, per child id.
    func sentKinds(_ childID: Int) -> [String] {
        server.requests.flatMap(\.events).filter { $0["child_id"] as? Int == childID }.map { $0["kind"] as! String }
    }

    func pending(_ profile: Profile) async throws -> [StoredEvent] {
        try await store.events(for: profile.id).filter { $0.uploadState == .pending }
    }

    @Test func telemetryKindsAreTheServersList() {
        #expect(SyncKinds.telemetry == ["match_started", "match_ended", "attempt", "wrong_tap", "playtime"])
        #expect(SyncKinds.isTelemetry("telemetry.app_opened"))
        // Answered facts (attempts, wrong taps) are the app's telemetry kinds
        // today; everything else it uploads stays progress.
        let telemetryKinds: Set<EventKind> = [ProblemAttempted.kind, WrongAnswerTapped.kind]
        for mapping in SyncKinds.all {
            #expect(SyncKinds.isTelemetry(mapping.serverKind) == telemetryKinds.contains(mapping.storeKind), "\(mapping.serverKind)")
        }
    }

    @Test func optedOutChildUploadsProgressButNotTelemetry() async throws {
        try await store.setTelemetryOptOut(true, for: ada.id)
        try await store.record(TestAttempt(answer: 12), for: ada.id)
        let won = try await store.record(NodeWon(nodeID: 3, stars: 2), for: ada.id)
        try await store.record(TestAttempt(answer: 7), for: ada.id)
        let dragons = try await store.record(DragonsCollected(dragonIDs: [1]), for: ada.id)
        // Bo's parent left telemetry on.
        try await store.record(TestAttempt(answer: 5), for: bo.id)

        let report = await engine().syncNow()

        #expect(report.outcome == .finished)
        #expect(sentKinds(42) == ["node_won", "dragons_collected"])
        #expect(Set(server.appliedEvents.map { $0["id"] as! String }).isSuperset(of: [won.id.uuidString, dragons.id.uuidString]))
        #expect(sentKinds(43) == ["attempt"])
        #expect(report.withheld == 2)
        #expect(report.acknowledged == 3)
        // Dropped, not left to pile up.
        #expect(try await pending(ada).isEmpty)
        #expect(try await pending(bo).isEmpty)
        #expect(try await store.progress(for: ada.id).nodesWon == [3])
    }

    @Test func aQueueOfOnlyTelemetryDrainsWithoutARequest() async throws {
        try await store.setTelemetryOptOut(true, for: ada.id)
        for answer in 1...5 { try await store.record(TestAttempt(answer: answer), for: ada.id) }

        let report = await engine(batchSize: 2).syncNow()

        #expect(report.outcome == .finished)
        #expect(report.withheld == 5)
        #expect(sentKinds(42).isEmpty)
        #expect(try await pending(ada).isEmpty)
    }

    @Test func learnsTheSettingFromTheServersProgress() async throws {
        // Turned off on another device: this one hasn't heard yet.
        server.telemetryOptOut = [42]
        try await store.record(TestAttempt(answer: 1), for: ada.id)

        var report = await engine().syncNow()
        // Sent once, and the server dropped it.
        #expect(sentKinds(42) == ["attempt"])
        #expect(server.appliedEvents.isEmpty)
        #expect(report.acknowledged == 1)
        #expect(try await store.profiles().first { $0.id == ada.id }?.telemetryOptOut == true)

        // From now on it stays on the device.
        try await store.record(TestAttempt(answer: 2), for: ada.id)
        try await store.record(NodeWon(nodeID: 1, stars: 3), for: ada.id)
        report = await engine().syncNow()
        #expect(sentKinds(42) == ["attempt", "node_won"])
        #expect(report.withheld == 1)
        #expect(try await pending(ada).isEmpty)
    }

    @Test func uploadsTelemetryAgainOnceTurnedBackOn() async throws {
        try await store.setTelemetryOptOut(true, for: ada.id)
        server.telemetryOptOut = [42]
        try await store.record(TestAttempt(answer: 1), for: ada.id)
        await engine().syncNow()

        try await store.setTelemetryOptOut(false, for: ada.id)
        server.telemetryOptOut = []
        try await store.record(TestAttempt(answer: 2), for: ada.id)
        let report = await engine().syncNow()

        // Only what was recorded after: the dropped one is gone for good.
        #expect(sentKinds(42) == ["attempt"])
        #expect(report.withheld == 0)
        #expect(server.appliedEvents.map { ($0["payload"] as! [String: Any])["answer"] as! Int } == [2])
        #expect(try await store.profiles().first { $0.id == ada.id }?.telemetryOptOut == false)
    }
}
