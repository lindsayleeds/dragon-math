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

    @Test func sendsTheChosenCompanion() async throws {
        let chosen = try await store.record(CompanionChosen(companionID: "sunfire_dragon"), for: child.id)
        let unknown = try await store.record(CompanionChosen(companionID: "future_dragon"), for: child.id)

        let report = await engine().syncNow()

        #expect(report.outcome == .finished)
        let sent = server.requests.flatMap(\.events)
        #expect(sent.count == 1)
        #expect(sent[0]["id"] as? String == chosen.id.uuidString)
        #expect(sent[0]["kind"] as? String == "companion_chosen")
        #expect(sent[0]["payload"] as? [String: String] == ["companion_id": "sunfire_dragon"])
        // An id the contract doesn't know yet waits for an app that does.
        #expect(try await pending().map(\.id) == [unknown.id])
    }

    @Test func sendsMemorizeProgressButNeverSamples() async throws {
        let done = try await store.record(
            MemorizePassageCompleted(
                passageID: 3, difficulty: "hard", body: "Be still.", revision: "2026-09-10T12:00:00.123Z"),
            for: child.id)
        try await store.record(MemorizeSampleCompleted(sampleID: "twinkle", difficulty: "easy"), for: child.id)
        // Not a difficulty the contract knows: stays pending rather than going up.
        try await store.record(
            MemorizePassageCompleted(passageID: 3, difficulty: "expert", body: "Be still.", revision: "x"), for: child.id)

        let report = await engine().syncNow()

        #expect(report.acknowledged == 1)
        let sent = try #require(server.requests.first).events
        #expect(sent.count == 1)
        #expect(sent[0]["id"] as? String == done.id.uuidString)
        #expect(sent[0]["kind"] as? String == "memorize_progress")
        #expect(sent[0]["payload"] as? [String: AnyHashable] == [
            "passage_id": 3, "difficulty": "hard", "body": "Be still.", "updated_at": "2026-09-10T12:00:00.123Z",
        ])
        #expect(try await pending().map(\.kind) == [MemorizeSampleCompleted.kind, MemorizePassageCompleted.kind])
    }

    @Test func sendsTrialPlacementsAsTrialCompleted() async throws {
        let result = { (score: Int, band: String) in TrialCompleted.OpResult(score: score, band: band, problemsAsked: 5) }
        let trial = try await store.record(
            TrialCompleted(targetNodeID: 26, perOp: [
                "add": result(1000, "fluent"), "sub": result(900, "fluent"),
                "mul": result(469, "emerging"), "div": result(0, "not_ready"),
            ]),
            for: child.id)
        // A band the server doesn't know, or a missing op, stays pending.
        let odd = try await store.record(
            TrialCompleted(targetNodeID: 1, perOp: ["add": result(0, "hopeless")]), for: child.id)

        await engine().syncNow()

        let sent = try #require(server.requests.first).events
        #expect(sent.count == 1)
        #expect(sent[0]["id"] as? String == trial.id.uuidString)
        #expect(sent[0]["kind"] as? String == "trial_completed")
        let payload = try #require(sent[0]["payload"] as? [String: Any])
        #expect(payload["target_node_id"] as? Int == 26)
        let perOp = try #require(payload["per_op"] as? [String: [String: Any]])
        #expect(Set(perOp.keys) == ["add", "sub", "mul", "div"])
        #expect(perOp["mul"]?["score"] as? Int == 469)
        #expect(perOp["mul"]?["band"] as? String == "emerging")
        #expect(perOp["mul"]?["problems_asked"] as? Int == 5)
        #expect(perOp["div"]?["band"] as? String == "not_ready")
        #expect(try await pending().map(\.id) == [odd.id])
    }

    @Test func sendsProblemAttemptsAsAttempt() async throws {
        let attempt = try await store.record(
            ProblemAttempted(nodeID: 0, operandA: 21, operandB: 3, op: "div", answer: 7, outcome: "child", timeMs: 1_840),
            for: child.id)
        // Not an operator the contract knows: stays pending rather than going up.
        try await store.record(
            ProblemAttempted(nodeID: 0, operandA: 2, operandB: 3, op: "pow", answer: 8, outcome: "child", timeMs: nil),
            for: child.id)

        let report = await engine().syncNow()

        #expect(report.acknowledged == 1)
        let sent = try #require(server.requests.first).events
        #expect(sent.count == 1)
        #expect(sent[0]["id"] as? String == attempt.id.uuidString)
        #expect(sent[0]["kind"] as? String == "attempt")
        #expect(sent[0]["payload"] as? [String: AnyHashable] == [
            "node_id": 0, "operand_a": 21, "operand_b": 3, "operator": "div", "answer": 7, "outcome": "child",
            "time_ms": 1840,
        ])
        #expect(try await pending().map(\.kind) == [ProblemAttempted.kind])
    }

    @Test func sendsPhonicsAttemptsAsPhonicsAttempt() async throws {
        let right = try await store.record(
            PhonicsAttempted(elementKey: "sh", mode: "choose", correct: true, chosen: nil, responseMs: 1_250), for: child.id)
        let wrong = try await store.record(
            PhonicsAttempted(elementKey: "short-a", mode: "type-it", correct: false, chosen: "short-e", responseMs: nil),
            for: child.id)
        // Not a mode the contract knows: stays pending rather than going up.
        try await store.record(
            PhonicsAttempted(elementKey: "sh", mode: "sing-it", correct: true, chosen: nil, responseMs: nil), for: child.id)

        let report = await engine().syncNow()

        #expect(report.acknowledged == 2)
        let sent = try #require(server.requests.first).events
        #expect(sent.map { $0["id"] as? String } == [right.id.uuidString, wrong.id.uuidString])
        #expect(sent.map { $0["kind"] as? String } == ["phonics_attempt", "phonics_attempt"])
        #expect(sent[0]["payload"] as? [String: AnyHashable] == [
            "element_key": "sh", "mode": "choose", "correct": true, "response_ms": 1250,
        ])
        #expect(sent[1]["payload"] as? [String: AnyHashable] == [
            "element_key": "short-a", "mode": "type-it", "correct": false, "chosen": "short-e",
        ])
        #expect(try await pending().map(\.kind) == [PhonicsAttempted.kind])
        // Progress: it uploads for a child opted out of telemetry too.
        #expect(!SyncKinds.isTelemetry("phonics_attempt"))
    }

    @Test func sendsTheChosenFont() async throws {
        let chosen = try await store.record(FontChosen(fontThemeID: "bubbly"), for: child.id)
        let unknown = try await store.record(FontChosen(fontThemeID: "future_font"), for: child.id)

        let report = await engine().syncNow()

        #expect(report.outcome == .finished)
        let sent = server.requests.flatMap(\.events)
        #expect(sent.count == 1)
        #expect(sent[0]["id"] as? String == chosen.id.uuidString)
        #expect(sent[0]["kind"] as? String == "font_chosen")
        #expect(sent[0]["payload"] as? [String: String] == ["font": "bubbly"])
        #expect(try await pending().map(\.id) == [unknown.id])
    }

    @Test func sendsWrongTapsButNeverCrossings() async throws {
        let slip = try await store.record(
            WrongAnswerTapped(nodeID: 0, operandA: 3, operandB: 5, op: "mul", correctAnswer: 15, tappedValue: 16,
                              timeMs: nil),
            for: child.id)
        // The crossing itself stays on the device; an unknown operator stays pending.
        try await store.record(SteppingStonesCrossed(baseNumber: 3, elapsedMs: 9_000, restarts: 1), for: child.id)
        try await store.record(
            WrongAnswerTapped(nodeID: 0, operandA: 3, operandB: 4, op: "pow", correctAnswer: 81, tappedValue: 80,
                              timeMs: 1),
            for: child.id)

        let report = await engine().syncNow()

        #expect(report.acknowledged == 1)
        let sent = try #require(server.requests.first).events
        #expect(sent.map { $0["id"] as? String } == [slip.id.uuidString])
        #expect(sent[0]["kind"] as? String == "wrong_tap")
        #expect(sent[0]["payload"] as? [String: AnyHashable] == [
            "node_id": 0, "operand_a": 3, "operand_b": 5, "operator": "mul", "correct_answer": 15, "tapped_value": 16,
        ])
        #expect(try await pending().map(\.kind) == [SteppingStonesCrossed.kind, WrongAnswerTapped.kind])
    }

    @Test func sendsMunchersScoresForTheLeaderboard() async throws {
        let game = try await store.record(MunchersGameEnded(score: 145, won: true, progression: false, level: 1), for: child.id)

        let report = await engine().syncNow()

        #expect(report.acknowledged == 1)
        let sent = try #require(server.requests.first).events
        #expect(sent.map { $0["id"] as? String } == [game.id.uuidString])
        #expect(sent[0]["kind"] as? String == "game_score")
        #expect(sent[0]["payload"] as? [String: AnyHashable] == ["game": "dragon-munchers", "score": 145])
        #expect(try await pending().isEmpty)
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

    @Test func everyRunsReportReachesEachReportsReader() async throws {
        try await win(1...2)
        let sync = engine()
        let first = await sync.reports()
        let second = await sync.reports()

        let report = await sync.syncNow()

        var firstReader = first.makeAsyncIterator()
        var secondReader = second.makeAsyncIterator()
        #expect(await firstReader.next() == report)
        #expect(await secondReader.next() == report)
        #expect(report.acknowledged == 2)
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
