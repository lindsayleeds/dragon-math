import API
import Foundation
import Store
import Sync
import Testing

/// A clock that moves one second per read, so events have distinct times.
final class TickingClock: @unchecked Sendable {
    private let lock = NSLock()
    private var next = Date(timeIntervalSince1970: 1_800_000_000)
    func now() -> Date {
        lock.withLock {
            defer { next += 1 }
            return next
        }
    }
}

@Suite struct SyncEngineTests {
    let store: SQLiteStore
    let server = FakeSyncServer()
    let sleeper = SleepRecorder()
    let session = SessionFlag(signedIn: true)
    let child: Profile

    init() async throws {
        let clock = TickingClock()
        store = try .inMemory(now: { clock.now() })
        child = try await store.addChildProfile(remoteID: 42, displayName: "Ada")
    }

    func engine(
        batchSize: Int = 100, maxRetries: Int = 5, reachability: (any NetworkReachability)? = nil
    ) -> SyncEngine {
        let session = session
        let sleeper = sleeper
        return SyncEngine(
            store: store,
            client: DragonAPIClient(baseURL: baseURL, transport: server) { "kid-token" },
            hasSession: { session.signedIn },
            reachability: reachability,
            configuration: .init(batchSize: batchSize, retry: RetryPolicy(maxRetries: maxRetries)),
            sleep: { try await sleeper.sleep($0) },
            random: { 0.5 })
    }

    @discardableResult
    func win(_ nodes: ClosedRange<Int>, stars: Int? = 3, for profile: Profile? = nil) async throws -> [StoredEvent] {
        var events: [StoredEvent] = []
        for node in nodes {
            events.append(try await store.record(NodeWon(nodeID: node, stars: stars), for: (profile ?? child).id))
        }
        return events
    }

    func pending(_ profile: Profile? = nil) async throws -> [StoredEvent] {
        try await store.events(for: (profile ?? child).id).filter { $0.uploadState == .pending }
    }

    // MARK: - Uploading

    @Test func uploadsInBatchesOldestFirstAndMarksEventsUploaded() async throws {
        let events = try await win(1...5)

        let report = await engine(batchSize: 2).syncNow()

        #expect(report.outcome == .finished)
        #expect(report.acknowledged == 5)
        #expect(server.requests.map(\.ids) == [
            [events[0], events[1]], [events[2], events[3]], [events[4]],
        ].map { $0.map(\.id.uuidString) })
        #expect(try await pending().isEmpty)
        #expect(sleeper.sleeps.isEmpty)
    }

    @Test func sendsTheServerKindAndPayload() async throws {
        let won = try await store.record(NodeWon(nodeID: 7, stars: 2), for: child.id)
        let old = try await store.record(NodeWon(nodeID: 8), for: child.id)

        await engine().syncNow()

        let request = try #require(server.requests.first)
        #expect(request.authorization == "Bearer kid-token")
        let sent = request.events
        #expect(sent.count == 2)
        #expect(sent[0]["id"] as? String == won.id.uuidString)
        #expect(sent[0]["child_id"] as? Int == 42)
        #expect(sent[0]["kind"] as? String == "node_won")
        #expect(sent[0]["occurred_at"] as? String == ISO8601DateFormatter().string(from: won.occurredAt))
        #expect(sent[0]["payload"] as? [String: Int] == ["node_id": 7, "stars": 2])
        // Wins recorded before stars existed go up as 0; the server keeps the best.
        #expect(sent[1]["id"] as? String == old.id.uuidString)
        #expect(sent[1]["payload"] as? [String: Int] == ["node_id": 8, "stars": 0])
    }

    @Test func sendsProvingMedalsAsProvingMedal() async throws {
        let medal = try await store.record(
            ProvingMedalEarned(mode: "div", digit: 6, medal: "silver", elapsedMs: 57_310, wrongCount: 0), for: child.id)
        // A value the server's schema doesn't know stays pending rather than being sent.
        let odd = try await store.record(
            ProvingMedalEarned(mode: "add", digit: 6, medal: "gold", elapsedMs: 40_000, wrongCount: 0), for: child.id)

        await engine().syncNow()

        let sent = try #require(server.requests.first).events
        #expect(sent.count == 1)
        #expect(sent[0]["id"] as? String == medal.id.uuidString)
        #expect(sent[0]["kind"] as? String == "proving_medal")
        let payload = try #require(sent[0]["payload"] as? [String: Any])
        #expect(payload["mode"] as? String == "div")
        #expect(payload["medal"] as? String == "silver")
        #expect(payload["digit"] as? Int == 6)
        #expect(payload["elapsed_ms"] as? Int == 57_310)
        #expect(payload["wrong_count"] as? Int == 0)
        #expect(try await pending().map(\.id) == [odd.id])
    }

    @Test func guestEventsNeverUpload() async throws {
        let guest = store.guestProfile
        try await win(1...3, for: guest)
        try await win(4...4)

        let report = await engine().syncNow()

        #expect(report.acknowledged == 1)
        #expect(server.requests.flatMap(\.events).allSatisfy { $0["child_id"] as? Int == 42 })
        #expect(try await pending(guest).count == 3)
    }

    @Test func nothingUploadsWithoutASession() async throws {
        try await win(1...2)
        session.signedIn = false

        let report = await engine().syncNow()

        #expect(report.outcome == .noSession)
        #expect(server.requests.isEmpty)
        #expect(try await pending().count == 2)
    }

    @Test func kindsWithoutAMappingStayPendingAndDontBlockTheQueue() async throws {
        for i in 1...3 { try await store.record(Telemetry(name: "t\(i)"), for: child.id) }
        try await win(1...2)

        let report = await engine(batchSize: 2).syncNow()

        #expect(report.outcome == .finished)
        #expect(server.requests.flatMap(\.events).allSatisfy { $0["kind"] as? String == "node_won" })
        #expect(try await pending().map(\.kind) == Array(repeating: Telemetry.kind, count: 3))
    }

    // MARK: - Offline, retries, resends

    @Test func offlineThenReconnectUploadsOnItsOwn() async throws {
        try await win(1...3)
        let network = StubReachability(online: false)
        let sync = engine(reachability: network)
        await sync.start()
        #expect(await eventually { await !sync.isNetworkAvailable })
        server.script(.networkDown)

        // Offline: the upload fails and isn't retried until the network is back.
        let report = await sync.syncNow()
        #expect(report.outcome == .offline)
        #expect(sleeper.sleeps.isEmpty)
        #expect(try await pending().count == 3)

        network.set(online: true)

        #expect(try await eventually { try await pending().isEmpty })
        #expect(server.requests.count == 2)
        await sync.stop()
    }

    @Test func retriesWithExponentialBackoffAndJitter() async throws {
        try await win(1...2)
        server.script(.status(500), .networkDown, .status(429))

        let report = await engine().syncNow()

        #expect(report.outcome == .finished)
        #expect(report.requests == 4)
        #expect(try await pending().isEmpty)
        // base 2s doubling, times the jitter factor 0.5 + 0.5 × 0.5.
        #expect(sleeper.sleeps == [.milliseconds(1500), .seconds(3), .seconds(6)])
    }

    @Test func givesUpAfterTheLastRetryAndKeepsTheEvents() async throws {
        try await win(1...2)
        server.script(.status(503), .status(503), .status(503), .status(503))

        let report = await engine(maxRetries: 3).syncNow()

        #expect(report.outcome == .gaveUp)
        #expect(server.requests.count == 4)
        #expect(try await pending().count == 2)

        // The next trigger starts over.
        #expect(await engine().syncNow().outcome == .finished)
        #expect(try await pending().isEmpty)
    }

    @Test func aLostResponseIsResentAndAcknowledgedAsADuplicate() async throws {
        let events = try await win(1...3)
        server.script(.responseLost)

        let report = await engine().syncNow()

        #expect(report.outcome == .finished)
        #expect(report.duplicates == 3)
        #expect(server.requests.map(\.ids) == Array(repeating: events.map(\.id.uuidString), count: 2))
        #expect(server.received.values.allSatisfy { $0 == 1 })
        #expect(server.received.count == 3)
        #expect(try await pending().isEmpty)
    }

    @Test func syncingTwiceSendsNothingTheSecondTime() async throws {
        try await win(1...3)
        let sync = engine()
        await sync.syncNow()
        let second = await sync.syncNow()
        #expect(second.requests == 0)
        #expect(server.requests.count == 1)
    }

    @Test func failedEventsStayPendingAndAreRetriedAlone() async throws {
        let events = try await win(1...4)
        let failing = events[1].id.uuidString
        server.script(.fail([failing]))

        let report = await engine().syncNow()

        #expect(report.outcome == .finished)
        #expect(report.acknowledged == 4)
        #expect(server.requests.map(\.ids) == [events.map(\.id.uuidString), [failing]])
        #expect(sleeper.sleeps.count == 1)
        #expect(try await pending().isEmpty)
    }

    @Test func partialFailureKeepsOnlyTheFailedEventWhenRetriesRunOut() async throws {
        let events = try await win(1...3)
        let failing = events[2].id.uuidString
        server.script(.fail([failing]), .fail([failing]))

        let report = await engine(maxRetries: 1).syncNow()

        #expect(report.outcome == .gaveUp)
        #expect(try await pending().map(\.id) == [events[2].id])
    }

    @Test func rejectedEventsAreDroppedNotRetried() async throws {
        let events = try await win(1...2)
        server.script(.reject([events[0].id.uuidString]))

        let report = await engine().syncNow()

        #expect(report.outcome == .finished)
        #expect(report.rejected == 1)
        #expect(server.requests.count == 1)
        #expect(try await pending().isEmpty)
    }

    @Test func anExpiredSessionStopsWithoutRetrying() async throws {
        try await win(1...2)
        server.script(.status(401))

        let report = await engine().syncNow()

        #expect(report.outcome == .unauthorized)
        #expect(server.requests.count == 1)
        #expect(sleeper.sleeps.isEmpty)
        #expect(try await pending().count == 2)
    }

    // MARK: - Concurrency

    @Test func oneSyncAtATimeAndEventsRecordedMeanwhileStillGo() async throws {
        try await win(1...2)
        let gate = Gate()
        server.gate = gate
        let sync = engine()

        async let first = sync.syncNow()
        #expect(await eventually { server.requests.count == 1 })
        async let second = sync.syncNow(.foreground)
        try await win(3...3)
        sync.requestSync()
        try await Task.sleep(for: .milliseconds(20))
        #expect(server.requests.count == 1)
        gate.open()

        let (a, b) = await (first, second)
        #expect(a == b)
        #expect(a.acknowledged == 3)
        #expect(server.maxInFlight == 1)
        #expect(try await pending().isEmpty)
    }

    @MainActor @Test func theMainActorNeverWaitsOnTheNetwork() async throws {
        try await win(1...2)
        let gate = Gate()
        server.gate = gate
        let sync = engine()

        // Returns at once while the upload hangs, and play goes on meanwhile.
        sync.requestSync()
        #expect(await eventually { server.requests.count == 1 })
        try await win(3...3)
        #expect(try await store.progress(for: child.id).nodesWon == [1, 2, 3])
        // Another battle ends while the first upload is still hanging.
        sync.requestSync()

        gate.open()
        #expect(try await eventually { try await pending().isEmpty })
        #expect(server.requests.allSatisfy { !$0.onMainThread })
    }
}

@Test func backoffDoublesUpToTheCapWithJitter() {
    let policy = RetryPolicy(baseDelay: .seconds(1), maxDelay: .seconds(10), maxRetries: 9)
    #expect(policy.delay(beforeRetry: 1, random: 0) == .milliseconds(500))
    #expect(policy.delay(beforeRetry: 1, random: 1) == .seconds(1))
    #expect(policy.delay(beforeRetry: 3, random: 0) == .seconds(2))
    #expect(policy.delay(beforeRetry: 5, random: 1) == .seconds(10))
    #expect(policy.delay(beforeRetry: 50, random: 0.5) == .milliseconds(7500))
}

@Test func everyMappedKindIsDistinct() {
    let kinds = SyncKinds.all.map(\.storeKind)
    #expect(Set(kinds).count == kinds.count)
    #expect(SyncKinds.all.map(\.serverKind).allSatisfy { $0.range(of: "^[a-z][a-z0-9_]*$", options: .regularExpression) != nil })
}
