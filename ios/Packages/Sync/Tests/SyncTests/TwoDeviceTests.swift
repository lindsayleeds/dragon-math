import API
import Foundation
import Store
import Sync
import Testing

/// One child on an iPhone and an iPad (issue #130): each device has its own
/// Store and SyncEngine, both talk to one server. They play offline, then come
/// online in some order; once each has synced after the other's last upload,
/// both show the same progress — everything played on either, nothing counted
/// twice.
@Suite struct TwoDeviceTests {
    /// The child's server id; both devices have a profile for it.
    static let childID = 42

    /// A device: its own store and engine. The iPhone uses the kid's session,
    /// the iPad (a family iPad) the parent's.
    struct Device {
        let store: SQLiteStore
        let profile: Profile
        let sync: SyncEngine

        init(server: FakeSyncServer, token: String) async throws {
            let clock = TickingClock()
            store = try .inMemory(now: { clock.now() })
            profile = try await store.addChildProfile(remoteID: TwoDeviceTests.childID, displayName: "Ada")
            sync = SyncEngine(
                store: store,
                client: DragonAPIClient(baseURL: baseURL, transport: server) { token },
                hasSession: { true },
                // Two retries, then give up until the next trigger: an offline
                // try is three failed requests.
                configuration: .init(retry: RetryPolicy(maxRetries: 2)),
                sleep: { _ in },
                random: { 0.5 })
        }

        func record(_ payload: some EventPayload) async throws {
            try await store.record(payload, for: profile.id)
        }

        var progress: ProfileProgress {
            get async throws { try await store.progress(for: profile.id) }
        }
    }

    enum Name: String, Sendable { case iPhone, iPad }

    /// One step of a scenario.
    enum Step: Sendable, CustomStringConvertible {
        /// Play the first or second half of that device's session, offline.
        case play(Name, half: Int)
        /// Sync with the network up.
        case sync(Name)
        /// Try to sync with the network down: nothing reaches the server.
        case syncOffline(Name)
        /// The upload lands but its response is lost; the device resends.
        case syncLosingResponse(Name)
        /// The upload lands but every progress pull fails.
        case syncFailingPull(Name)

        var description: String {
            switch self {
            case .play(let d, let half): "\(d) plays (\(half))"
            case .sync(let d): "\(d) syncs"
            case .syncOffline(let d): "\(d) is offline"
            case .syncLosingResponse(let d): "\(d) loses a response"
            case .syncFailingPull(let d): "\(d) can't pull"
            }
        }
    }

    struct Scenario: Sendable, CustomTestStringConvertible {
        let name: String
        let steps: [Step]
        var testDescription: String { name }
    }

    /// What each device plays. They overlap: node 1 and node 2 are won on
    /// both, the better stars on a different device each time; dragon 1 is
    /// caught on both.
    static func session(_ device: Name, half: Int) -> [any EventPayload] {
        switch (device, half) {
        case (.iPhone, 1): [NodeWon(nodeID: 1, stars: 2), DragonsCollected(dragonIDs: [1])]
        case (.iPhone, _): [NodeWon(nodeID: 2, stars: 3), DragonsCollected(dragonIDs: [2])]
        case (.iPad, 1): [NodeWon(nodeID: 1, stars: 3), DragonsCollected(dragonIDs: [1, 1])]
        case (.iPad, _): [NodeWon(nodeID: 3, stars: 2), NodeWon(nodeID: 2, stars: 1), DragonsCollected(dragonIDs: [3])]
        }
    }

    /// Both devices' play, as one device would show it.
    static let everything = ProfileProgress(
        nodesWon: [1, 2, 3], stars: [1: 3, 2: 3, 3: 2], frontier: 4, dragons: [1: 3, 2: 1, 3: 1])

    static let offlineAll: [Step] = [
        .play(.iPhone, half: 1), .play(.iPhone, half: 2), .play(.iPad, half: 1), .play(.iPad, half: 2),
        .syncOffline(.iPhone), .syncOffline(.iPad),
    ]

    static let scenarios: [Scenario] = [
        Scenario(name: "the iPhone comes online first", steps: offlineAll + [.sync(.iPhone), .sync(.iPad), .sync(.iPhone)]),
        Scenario(name: "the iPad comes online first", steps: offlineAll + [.sync(.iPad), .sync(.iPhone), .sync(.iPad)]),
        Scenario(name: "they take turns, syncing between sessions", steps: [
            .play(.iPhone, half: 1), .sync(.iPhone),
            .play(.iPad, half: 1), .sync(.iPad),
            .play(.iPhone, half: 2), .syncOffline(.iPhone),
            .play(.iPad, half: 2), .sync(.iPad),
            .sync(.iPhone), .sync(.iPad),
        ]),
        Scenario(name: "the iPhone's response is lost and it resends", steps: offlineAll + [
            .syncLosingResponse(.iPhone), .sync(.iPad), .sync(.iPhone),
        ]),
        Scenario(name: "the iPad uploads but can't pull, then syncs again", steps: offlineAll + [
            .sync(.iPhone), .syncFailingPull(.iPad), .sync(.iPhone), .sync(.iPad),
        ]),
        Scenario(name: "each syncs twice in a row", steps: offlineAll + [
            .sync(.iPad), .sync(.iPad), .sync(.iPhone), .sync(.iPhone), .sync(.iPad),
        ]),
    ]

    @Test(arguments: scenarios)
    func bothDevicesEndWithEverything(_ scenario: Scenario) async throws {
        let server = FakeSyncServer()
        let devices: [Name: Device] = [
            .iPhone: try await Device(server: server, token: "kid-token"),
            .iPad: try await Device(server: server, token: "parent-token"),
        ]

        for step in scenario.steps {
            switch step {
            case .play(let name, let half):
                for event in Self.session(name, half: half) { try await devices[name]!.record(event) }
            case .sync(let name):
                #expect(await devices[name]!.sync.syncNow().outcome == .finished, "\(step)")
            case .syncOffline(let name):
                server.script(.networkDown, .networkDown, .networkDown)
                let before = server.received
                #expect(await devices[name]!.sync.syncNow().outcome == .gaveUp, "\(step)")
                #expect(server.received.count == before.count)
            case .syncLosingResponse(let name):
                server.script(.responseLost)
                let report = await devices[name]!.sync.syncNow()
                #expect(report.outcome == .finished, "\(step)")
                #expect(report.duplicates > 0)
            case .syncFailingPull(let name):
                server.scriptProgress(.networkDown, .networkDown, .networkDown)
                #expect(await devices[name]!.sync.syncNow().outcome == .gaveUp, "\(step)")
                // Uploaded but not pulled: its own play still shows in full.
                let own = try await devices[name]!.progress
                #expect(own.nodesWon.isSuperset(of: Self.ownNodes(name, scenario: scenario)))
            }
        }

        let iPhone = try await devices[.iPhone]!.progress
        let iPad = try await devices[.iPad]!.progress
        #expect(iPhone == Self.everything)
        #expect(iPad == Self.everything)
        // The server applied every event exactly once.
        #expect(server.received.count == 9)
        #expect(server.received.values.allSatisfy { $0 == 1 })
    }

    static func ownNodes(_ name: Name, scenario: Scenario) -> Set<Int> {
        var nodes: Set<Int> = []
        for case .play(let device, let half) in scenario.steps where device == name {
            for case let won as NodeWon in session(device, half: half) { nodes.insert(won.nodeID) }
        }
        return nodes
    }

    // MARK: - Pulling

    @Test func pullsAfterUploadingWithTheDevicesSessionForItsChild() async throws {
        let server = FakeSyncServer()
        let iPad = try await Device(server: server, token: "parent-token")
        try await iPad.record(NodeWon(nodeID: 1, stars: 1))

        let report = await iPad.sync.syncNow()

        #expect(report.pulled == 1)
        #expect(server.progressRequests.map(\.childID) == [Self.childID])
        #expect(server.progressRequests.map(\.authorization) == ["Bearer parent-token"])
    }

    @Test func aDeviceWithNothingToUploadStillLearnsTheOthersProgress() async throws {
        let server = FakeSyncServer()
        let iPhone = try await Device(server: server, token: "kid-token")
        let iPad = try await Device(server: server, token: "parent-token")
        try await iPhone.record(NodeWon(nodeID: 5, stars: 3))
        try await iPhone.record(DragonsCollected(dragonIDs: [8]))
        await iPhone.sync.syncNow()

        let report = await iPad.sync.syncNow()

        #expect(report.requests == 0)
        #expect(try await iPad.progress == ProfileProgress(nodesWon: [5], stars: [5: 3], frontier: 6, dragons: [8: 1]))
    }

    @Test func aDragonUploadedAndPulledCountsOnce() async throws {
        let server = FakeSyncServer()
        let iPhone = try await Device(server: server, token: "kid-token")
        try await iPhone.record(DragonsCollected(dragonIDs: [4, 4]))
        #expect(try await iPhone.progress.dragons == [4: 2])

        await iPhone.sync.syncNow()
        #expect(try await iPhone.progress.dragons == [4: 2])
        await iPhone.sync.syncNow()
        #expect(try await iPhone.progress.dragons == [4: 2])

        // Caught again, offline: counted on top of the server's total.
        try await iPhone.record(DragonsCollected(dragonIDs: [4]))
        #expect(try await iPhone.progress.dragons == [4: 3])
        await iPhone.sync.syncNow()
        #expect(try await iPhone.progress.dragons == [4: 3])
    }

    @Test func aRefusedPullSkipsThatChildWithoutRetrying() async throws {
        let server = FakeSyncServer()
        let iPhone = try await Device(server: server, token: "kid-token")
        try await iPhone.record(NodeWon(nodeID: 2, stars: 2))
        server.scriptProgress(.status(403))

        let report = await iPhone.sync.syncNow()

        #expect(report.outcome == .finished)
        #expect(report.pulled == 0)
        #expect(server.progressRequests.count == 1)
        #expect(try await iPhone.progress.nodesWon == [2])
    }

    @Test func anExpiredSessionOnThePullStops() async throws {
        let server = FakeSyncServer()
        let iPhone = try await Device(server: server, token: "kid-token")
        server.scriptProgress(.status(401))
        #expect(await iPhone.sync.syncNow().outcome == .unauthorized)
        #expect(server.progressRequests.count == 1)
    }
}
