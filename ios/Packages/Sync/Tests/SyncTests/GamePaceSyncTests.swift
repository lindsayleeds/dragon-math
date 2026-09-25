import API
import Foundation
import Store
import Sync
import Testing

/// A parent's per-child game pace reaches every device of the child with the
/// progress pull, so a kid's own iPad plays at the pace set on the parent's.
@Suite struct GamePaceSyncTests {
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

    func engine() -> SyncEngine {
        SyncEngine(
            store: store,
            client: DragonAPIClient(baseURL: baseURL, transport: server) { "parent-token" },
            hasSession: { true },
            configuration: .init(batchSize: 100, retry: RetryPolicy(maxRetries: 2)),
            content: [],
            sleep: { _ in },
            random: { 0.5 })
    }

    func pace(_ profile: Profile) async throws -> String? {
        try await store.profiles().first { $0.id == profile.id }?.gamePace
    }

    @Test func learnsEachChildsPaceFromTheServersProgress() async throws {
        server.gamePaces = [42: "off"]
        try await store.record(NodeWon(nodeID: 1, stars: 3), for: ada.id)
        try await store.record(NodeWon(nodeID: 1, stars: 1), for: bo.id)

        #expect(await engine().syncNow().outcome == .finished)
        #expect(try await pace(ada) == "off")
        #expect(try await pace(bo) == "normal")

        // Changed again elsewhere: slow for Ada, and Bo's set too.
        server.gamePaces = [42: "slow", 43: "slow"]
        try await store.record(NodeWon(nodeID: 2, stars: 3), for: ada.id)
        try await store.record(NodeWon(nodeID: 2, stars: 3), for: bo.id)
        await engine().syncNow()
        #expect(try await pace(ada) == "slow")
        #expect(try await pace(bo) == "slow")

        server.gamePaces = [:]
        try await store.record(NodeWon(nodeID: 3, stars: 3), for: ada.id)
        await engine().syncNow()
        #expect(try await pace(ada) == "normal")
    }
}
