import Foundation
import Store
import Testing

/// A clock the test advances by hand, one second per read.
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

/// A payload kind the Store has never heard of, to prove kinds are open.
struct HintUsed: EventPayload, Equatable {
    static let kind: EventKind = "test.hint-used"
    let problem: String
    let hintsLeft: Int
}

@Test func moduleIsLinked() {
    #expect(StoreModule.name == "Store")
}

@Suite struct InMemoryStore {
    let clock = TickingClock()
    let store: SQLiteStore

    init() throws {
        let clock = clock
        store = try .inMemory(now: { clock.now() })
    }

    @Test func createsOneGuestProfile() async throws {
        #expect(store.guestProfile.kind == .guest)
        #expect(store.guestProfile.remoteID == nil)
        #expect(try await store.profiles() == [store.guestProfile])
    }

    @Test func addsChildProfilesOncePerRemoteID() async throws {
        let child = try await store.addChildProfile(remoteID: 42, displayName: "Ada")
        let again = try await store.addChildProfile(remoteID: 42, displayName: "Ada")
        #expect(child.kind == .child)
        #expect(child.remoteID == 42)
        #expect(again == child)
        #expect(try await store.profiles() == [store.guestProfile, child])
    }

    @Test func keepsEachChildsTelemetrySetting() async throws {
        let ada = try await store.addChildProfile(remoteID: 42, displayName: "Ada")
        let bo = try await store.addChildProfile(remoteID: 43, displayName: "Bo")
        #expect(!ada.telemetryOptOut)

        try await store.setTelemetryOptOut(true, for: ada.id)
        var profiles = try await store.profiles()
        #expect(profiles.first { $0.id == ada.id }?.telemetryOptOut == true)
        #expect(profiles.first { $0.id == bo.id }?.telemetryOptOut == false)
        // Adding the child again (the parent view reloading) keeps the setting.
        #expect(try await store.addChildProfile(remoteID: 42, displayName: "Ada").telemetryOptOut)

        try await store.setTelemetryOptOut(false, for: ada.id)
        profiles = try await store.profiles()
        #expect(profiles.first { $0.id == ada.id }?.telemetryOptOut == false)
    }

    @Test func savingAChildProfileUpdatesItsNameAndAvatarButNotItsIdentity() async throws {
        let added = try await store.addChildProfile(remoteID: 42, displayName: "New adventurer")
        let won = try await store.record(NodeWon(nodeID: 3), for: added.id)

        let renamed = try await store.saveChildProfile(remoteID: 42, displayName: "sparky", avatar: "🐉")
        #expect(renamed.id == added.id)
        #expect(renamed.createdAt == added.createdAt)
        #expect(renamed.displayName == "sparky")
        #expect(renamed.avatar == "🐉")
        #expect(try await store.profiles() == [store.guestProfile, renamed])
        #expect(try await store.events(for: renamed.id) == [won])
        // A parent's telemetry setting survives a rename.
        try await store.setTelemetryOptOut(true, for: added.id)
        #expect(try await store.saveChildProfile(remoteID: 42, displayName: "blaze", avatar: "🐉").telemetryOptOut)

        let fresh = try await store.saveChildProfile(remoteID: 43, displayName: "ember", avatar: nil)
        #expect(fresh.kind == .child)
        #expect(fresh.avatar == nil)
        #expect(try await store.profiles().map(\.id) == [store.guestProfile.id, renamed.id, fresh.id])
    }

    /// A family iPad: siblings take turns, and each keeps their own events,
    /// queue and progress.
    @Test func siblingsOnOneDeviceKeepSeparateEventsQueuesAndProgress() async throws {
        let ada = try await store.saveChildProfile(remoteID: 1, displayName: "sparky", avatar: "🐉")
        let bo = try await store.saveChildProfile(remoteID: 2, displayName: "ember", avatar: "🦊")
        let adaWin = try await store.record(NodeWon(nodeID: 1, stars: 3), for: ada.id)
        let boWin = try await store.record(NodeWon(nodeID: 5, stars: 1), for: bo.id)
        let adaDragons = try await store.record(DragonsCollected(dragonIDs: [7]), for: ada.id)

        #expect(try await store.events(for: ada.id) == [adaWin, adaDragons])
        #expect(try await store.events(for: bo.id) == [boWin])
        let kinds: Set<EventKind> = [NodeWon.kind, DragonsCollected.kind]
        #expect(try await store.pendingEvents(for: bo.id, kinds: kinds, limit: 10) == [boWin])
        #expect(try await store.progress(for: ada.id) == ProfileProgress(nodesWon: [1], stars: [1: 3], dragons: [7: 1]))
        #expect(try await store.progress(for: bo.id) == ProfileProgress(nodesWon: [5], stars: [5: 1]))
        #expect(try await store.progress(for: store.guestProfile.id) == ProfileProgress())
    }

    @Test func removesChildProfilesAndTheirEvents() async throws {
        let ada = try await store.addChildProfile(remoteID: 42, displayName: "Ada")
        let bo = try await store.addChildProfile(remoteID: 43, displayName: "Bo")
        let cy = try await store.addChildProfile(remoteID: 44, displayName: "Cy")
        let uploaded = try await store.record(NodeWon(nodeID: 1), for: ada.id)
        try await store.markUploaded([uploaded.id])
        try await store.record(NodeWon(nodeID: 2), for: ada.id)
        try await store.record(NodeWon(nodeID: 3), for: bo.id)
        try await store.record(NodeWon(nodeID: 4), for: cy.id)
        try await store.record(NodeWon(nodeID: 5), for: store.guestProfile.id)

        let removed = try await store.removeChildProfiles(remoteIDs: [42, 43, 99])

        #expect(removed == 2)
        #expect(try await store.profiles() == [store.guestProfile, cy])
        #expect(try await store.events(for: ada.id).isEmpty)
        #expect(try await store.events(for: bo.id).isEmpty)
        #expect(try await store.pendingEvents(limit: 10).map(\.profileID) == [cy.id, store.guestProfile.id])
        #expect(try await store.removeChildProfiles(remoteIDs: []) == 0)
    }

    @Test func recordsEventsWithDeviceIDsAndTimestamps() async throws {
        let guest = store.guestProfile.id
        let first = try await store.record(NodeWon(nodeID: 3), for: guest)
        let second = try await store.record(NodeWon(nodeID: 4), for: guest)

        #expect(first.id != second.id)
        #expect(first.profileID == guest)
        #expect(first.kind == "node.won")
        #expect(first.uploadState == .pending)
        #expect(second.occurredAt > first.occurredAt)
        #expect(String(decoding: first.payload, as: UTF8.self) == #"{"nodeId":3}"#)
        #expect(try await store.events(for: guest) == [first, second])
    }

    @Test func eventsAreScopedToTheirProfile() async throws {
        let child = try await store.addChildProfile(remoteID: 7, displayName: "Bo")
        try await store.record(NodeWon(nodeID: 1), for: store.guestProfile.id)
        let childEvent = try await store.record(NodeWon(nodeID: 2), for: child.id)
        #expect(try await store.events(for: child.id) == [childEvent])
        #expect(try await store.progress(for: child.id).nodesWon == [2])
        #expect(try await store.progress(for: store.guestProfile.id).nodesWon == [1])
    }

    @Test func storesAndDecodesUnknownKinds() async throws {
        let hint = HintUsed(problem: "3 × 4", hintsLeft: 2)
        let event = try await store.record(hint, for: store.guestProfile.id)
        let fetched = try #require(try await store.events(for: store.guestProfile.id).first)
        #expect(fetched.kind == HintUsed.kind)
        #expect(try fetched.decode(HintUsed.self) == hint)
        #expect(try fetched.decode(NodeWon.self) == nil)
        #expect(fetched == event)
    }

    @Test func derivesNodesWon() async throws {
        let guest = store.guestProfile.id
        #expect(try await store.progress(for: guest) == ProfileProgress())
        try await store.record(NodeWon(nodeID: 1), for: guest)
        try await store.record(NodeWon(nodeID: 2), for: guest)
        try await store.record(NodeWon(nodeID: 1), for: guest)
        try await store.record(HintUsed(problem: "1 + 1", hintsLeft: 0), for: guest)
        #expect(try await store.progress(for: guest).nodesWon == [1, 2])
    }

    @Test func queuesPendingEventsUntilUploaded() async throws {
        let guest = store.guestProfile.id
        var recorded: [StoredEvent] = []
        for node in 1...5 {
            recorded.append(try await store.record(NodeWon(nodeID: node), for: guest))
        }

        let batch = try await store.pendingEvents(limit: 3)
        #expect(batch.map(\.id) == recorded.prefix(3).map(\.id))

        try await store.markUploaded(batch.map(\.id) + [UUID()])
        let rest = try await store.pendingEvents(limit: 10)
        #expect(rest.map(\.id) == recorded.suffix(2).map(\.id))
        #expect(try await store.events(for: guest).map(\.uploadState) == [
            .uploaded, .uploaded, .uploaded, .pending, .pending,
        ])
        // Uploading doesn't change derived progress.
        #expect(try await store.progress(for: guest).nodesWon == [1, 2, 3, 4, 5])
    }

    @Test func pendingEventsForOneProfileAndSomeKinds() async throws {
        let guest = store.guestProfile.id
        let child = try await store.addChildProfile(remoteID: 8, displayName: "Di")
        let hint = try await store.record(HintUsed(problem: "1 + 2", hintsLeft: 1), for: child.id)
        try await store.record(NodeWon(nodeID: 1), for: guest)
        let first = try await store.record(NodeWon(nodeID: 2), for: child.id)
        let second = try await store.record(NodeWon(nodeID: 3, stars: 2), for: child.id)
        let third = try await store.record(NodeWon(nodeID: 4), for: child.id)

        let wins = try await store.pendingEvents(for: child.id, kinds: [NodeWon.kind], limit: 2)
        #expect(wins.map(\.id) == [first.id, second.id])
        try await store.markUploaded([first.id])
        #expect(try await store.pendingEvents(for: child.id, kinds: [NodeWon.kind], limit: 5).map(\.id)
            == [second.id, third.id])
        #expect(try await store.pendingEvents(for: child.id, kinds: [NodeWon.kind, HintUsed.kind], limit: 5)
            .map(\.id) == [hint.id, second.id, third.id])
        #expect(try await store.pendingEvents(for: child.id, kinds: [], limit: 5).isEmpty)
    }

    @Test func nodeWonStarsAreOptional() async throws {
        let event = try await store.record(NodeWon(nodeID: 5, stars: 3), for: store.guestProfile.id)
        #expect(String(decoding: event.payload, as: UTF8.self) == #"{"nodeId":5,"stars":3}"#)
        #expect(try event.decode(NodeWon.self) == NodeWon(nodeID: 5, stars: 3))
        // Events recorded before stars existed still decode.
        let old = StoredEvent(
            id: UUID(), profileID: store.guestProfile.id, kind: NodeWon.kind, payload: Data(#"{"nodeId":6}"#.utf8),
            occurredAt: .now, uploadState: .pending)
        #expect(try old.decode(NodeWon.self) == NodeWon(nodeID: 6))
    }

    @Test func derivesProvingBestsPerLevel() async throws {
        let guest = store.guestProfile.id
        let run = { (mode: String, digit: Int, medal: String, ms: Int) in
            ProvingMedalEarned(mode: mode, digit: digit, medal: medal, elapsedMs: ms, wrongCount: 0)
        }
        try await store.record(run("mul", 7, "silver", 52_000), for: guest)
        try await store.record(run("mul", 7, "bronze", 48_500), for: guest)
        try await store.record(run("mul", 7, "gold", 44_000), for: guest)
        try await store.record(run("mul", 7, "bronze", 70_000), for: guest)
        try await store.record(run("div", 3, "bronze", 81_000), for: guest)
        try await store.record(NodeWon(nodeID: 2), for: guest)

        let progress = try await store.progress(for: guest)
        #expect(progress.provingBests == [
            "mul-7": ProvingBest(medal: "gold", bestMs: 44_000),
            "div-3": ProvingBest(medal: "bronze", bestMs: 81_000),
        ])
        #expect(progress.nodesWon == [2])
    }

    @Test func provingMedalPayloadIsStable() async throws {
        let event = try await store.record(
            ProvingMedalEarned(mode: "div", digit: 4, medal: "silver", elapsedMs: 55_120, wrongCount: 0),
            for: store.guestProfile.id)
        #expect(event.kind == "proving.medal")
        #expect(String(decoding: event.payload, as: UTF8.self)
            == #"{"digit":4,"elapsedMs":55120,"medal":"silver","mode":"div","wrongCount":0}"#)
    }

    @Test func problemAttemptedPayloadIsStableAndDerivesNothing() async throws {
        let guest = store.guestProfile.id
        let event = try await store.record(
            ProblemAttempted(nodeID: 0, operandA: 21, operandB: 3, op: "div", answer: 7, outcome: "child", timeMs: 1_840),
            for: guest)
        #expect(event.kind == "problem.attempted")
        #expect(String(decoding: event.payload, as: UTF8.self)
            == #"{"answer":7,"nodeId":0,"op":"div","operandA":21,"operandB":3,"outcome":"child","timeMs":1840}"#)
        #expect(try await store.progress(for: guest) == ProfileProgress())
    }

    @Test func theLatestChosenCompanionIsTheProfiles() async throws {
        let guest = store.guestProfile.id
        let child = try await store.addChildProfile(remoteID: 3, displayName: "Bo")
        #expect(try await store.progress(for: guest).companionID == nil)

        let first = try await store.record(CompanionChosen(companionID: "forest_dragon"), for: guest)
        #expect(String(decoding: first.payload, as: UTF8.self) == #"{"companionId":"forest_dragon"}"#)
        #expect(try first.decode(CompanionChosen.self) == CompanionChosen(companionID: "forest_dragon"))
        try await store.record(CompanionChosen(companionID: "storm_dragon"), for: child.id)
        try await store.record(CompanionChosen(companionID: "pip"), for: guest)
        try await store.record(NodeWon(nodeID: 1), for: guest)

        #expect(try await store.progress(for: guest).companionID == "pip")
        #expect(try await store.progress(for: child.id).companionID == "storm_dragon")
        // Queued for upload like any event.
        #expect(try await store.pendingEvents(for: guest, kinds: [CompanionChosen.kind], limit: 5).count == 2)
    }

    @Test func theLatestChosenFontIsTheProfiles() async throws {
        let guest = store.guestProfile.id
        let child = try await store.addChildProfile(remoteID: 3, displayName: "Bo")
        #expect(try await store.progress(for: guest).fontThemeID == nil)

        let first = try await store.record(FontChosen(fontThemeID: "bubbly"), for: guest)
        #expect(String(decoding: first.payload, as: UTF8.self) == #"{"fontThemeId":"bubbly"}"#)
        #expect(try first.decode(FontChosen.self) == FontChosen(fontThemeID: "bubbly"))
        try await store.record(FontChosen(fontThemeID: "storybook"), for: child.id)
        try await store.record(FontChosen(fontThemeID: "handwritten"), for: guest)
        try await store.record(CompanionChosen(companionID: "pip"), for: guest)

        let progress = try await store.progress(for: guest)
        #expect(progress.fontThemeID == "handwritten")
        #expect(progress.companionID == "pip")
        #expect(try await store.progress(for: child.id).fontThemeID == "storybook")
        #expect(try await store.pendingEvents(for: guest, kinds: [FontChosen.kind], limit: 5).count == 2)
    }

    @Test func theChosenFontSurvivesUploadAndRelaunch() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "StoreTests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "store.sqlite")

        let guest: Profile.ID
        do {
            let store = try SQLiteStore.onDisk(at: url)
            guest = store.guestProfile.id
            let event = try await store.record(FontChosen(fontThemeID: "storybook"), for: guest)
            try await store.markUploaded([event.id])
        }
        #expect(try await SQLiteStore.onDisk(at: url).progress(for: guest).fontThemeID == "storybook")
    }

    @Test func observesTheChosenCompanion() async throws {
        let guest = store.guestProfile.id
        var updates = store.observeProgress(for: guest).makeAsyncIterator()
        #expect(try await updates.next()?.companionID == nil)
        try await store.record(CompanionChosen(companionID: "sakura_dragon"), for: guest)
        #expect(try await updates.next() == ProfileProgress(companionID: "sakura_dragon"))
    }

    @Test func derivesMemorizeMasteryPerRevisionAndSample() async throws {
        let child = try await store.addChildProfile(remoteID: 7, displayName: "Ada")
        let first = "2026-09-10T12:00:00.123Z"
        let edited = "2026-09-11T08:00:00.000Z"
        try await store.record(
            MemorizePassageCompleted(passageID: 3, difficulty: "hard", body: "Be still.", revision: first), for: child.id)
        try await store.record(
            MemorizePassageCompleted(passageID: 3, difficulty: "easy", body: "Be still.", revision: first), for: child.id)
        try await store.record(
            MemorizePassageCompleted(passageID: 3, difficulty: "medium", body: "Be still now.", revision: edited),
            for: child.id)
        try await store.record(MemorizeSampleCompleted(sampleID: "twinkle", difficulty: "medium"), for: child.id)
        try await store.record(MemorizeSampleCompleted(sampleID: "twinkle", difficulty: "easy"), for: child.id)

        let progress = try await store.progress(for: child.id)
        // The hardest level is kept; an edited passage is a new revision.
        #expect(progress.memorizeLevel(passageID: 3, revision: first) == 3)
        #expect(progress.memorizeLevel(passageID: 3, revision: edited) == 2)
        #expect(progress.memorizeLevel(passageID: 4, revision: first) == 0)
        #expect(progress.memorizedSamples == ["twinkle": 2])
        #expect(try await store.progress(for: store.guestProfile.id) == ProfileProgress())

        let event = try #require(try await store.events(for: child.id).first)
        #expect(String(decoding: event.payload, as: UTF8.self)
            == #"{"body":"Be still.","difficulty":"hard","passageId":3,"revision":"2026-09-10T12:00:00.123Z"}"#)
    }

    static func placement(_ node: Int) -> TrialCompleted {
        let result = TrialCompleted.OpResult(score: 1000, band: "fluent", problemsAsked: 5)
        return TrialCompleted(
            targetNodeID: node, perOp: ["add": result, "sub": result, "mul": result, "div": result])
    }

    @Test func trialPlacementMovesTheFrontier() async throws {
        let guest = store.guestProfile.id
        #expect(try await store.progress(for: guest).trialTaken == false)
        try await store.record(NodeWon(nodeID: 2, stars: 1), for: guest)
        try await store.record(Self.placement(17), for: guest)

        let progress = try await store.progress(for: guest)
        #expect(progress.trialTaken)
        #expect(progress.frontier == 17)
        // Every node before the target counts as won with 3 stars, as the
        // server records it; a better or worse local win keeps the best.
        #expect(progress.nodesWon == Set(1...16))
        #expect(progress.stars[2] == 3)
        #expect(progress.stars[16] == 3)
        #expect(progress.stars[17] == nil)
    }

    @Test func trialPlacementAtTheStartChangesNothingButTheFlag() async throws {
        let guest = store.guestProfile.id
        try await store.record(Self.placement(1), for: guest)
        let progress = try await store.progress(for: guest)
        #expect(progress.trialTaken)
        #expect(progress.frontier == 1)
        #expect(progress.nodesWon.isEmpty)
    }

    @Test func winsPastThePlacementStillMoveTheFrontier() async throws {
        let guest = store.guestProfile.id
        try await store.record(Self.placement(26), for: guest)
        try await store.record(NodeWon(nodeID: 26, stars: 2), for: guest)
        let progress = try await store.progress(for: guest)
        #expect(progress.frontier == 27)
        #expect(progress.stars[26] == 2)
    }

    @Test func trialPayloadIsStable() async throws {
        let event = try await store.record(
            TrialCompleted(targetNodeID: 26, perOp: [
                "add": .init(score: 980, band: "fluent", problemsAsked: 5),
                "div": .init(score: 0, band: "not_ready", problemsAsked: 3),
            ]),
            for: store.guestProfile.id)
        #expect(event.kind == "trial.completed")
        #expect(String(decoding: event.payload, as: UTF8.self)
            == #"{"perOp":{"add":{"band":"fluent","problemsAsked":5,"score":980},"#
            + #""div":{"band":"not_ready","problemsAsked":3,"score":0}},"targetNodeId":26}"#)
    }

    @Test func storesAnsweredFactsAndCrossingsWithStableFields() async throws {
        let guest = store.guestProfile.id
        try await store.record(
            ProblemAttempted(nodeID: 0, operandA: 3, operandB: 4, op: "mul", answer: 12, outcome: "child", timeMs: 820),
            for: guest)
        try await store.record(
            WrongAnswerTapped(nodeID: 0, operandA: 3, operandB: 5, op: "mul", correctAnswer: 15, tappedValue: 16,
                              timeMs: nil),
            for: guest)
        try await store.record(SteppingStonesCrossed(baseNumber: 3, elapsedMs: 9_000, restarts: 1), for: guest)

        let events = try await store.events(for: guest)
        #expect(events.map(\.kind) == ["problem.attempted", "problem.wrong_tap", "stepping_stones.crossed"])
        #expect(events.map { String(decoding: $0.payload, as: UTF8.self) } == [
            #"{"answer":12,"nodeId":0,"op":"mul","operandA":3,"operandB":4,"outcome":"child","timeMs":820}"#,
            #"{"correctAnswer":15,"nodeId":0,"op":"mul","operandA":3,"operandB":5,"tappedValue":16}"#,
            #"{"baseNumber":3,"elapsedMs":9000,"restarts":1}"#,
        ])
        #expect(try events[2].decode(SteppingStonesCrossed.self)?.elapsedMs == 9_000)
        // None of them is progress.
        #expect(try await store.progress(for: guest) == ProfileProgress())
    }

    @Test func observesProgress() async throws {
        let guest = store.guestProfile.id
        var updates = store.observeProgress(for: guest).makeAsyncIterator()

        #expect(try await updates.next() == ProfileProgress())
        try await store.record(NodeWon(nodeID: 9), for: guest)
        #expect(try await updates.next() == ProfileProgress(nodesWon: [9]))
        // Events that don't change progress don't emit.
        try await store.record(NodeWon(nodeID: 9), for: guest)
        try await store.record(NodeWon(nodeID: 10), for: guest)
        #expect(try await updates.next() == ProfileProgress(nodesWon: [9, 10]))
    }

    @Test func cachesContentByNameReplacingOlderCopies() async throws {
        #expect(try await store.cachedContent("rule_settings") == nil)

        try await store.saveContent("rule_settings", version: "v1", json: Data(#"{"a":1}"#.utf8))
        try await store.saveContent("dragon_catalog", version: "c1", json: Data(#"{"dragons":[]}"#.utf8))
        let first = try #require(try await store.cachedContent("rule_settings"))
        #expect(first.name == "rule_settings")
        #expect(first.version == "v1")
        #expect(first.json == Data(#"{"a":1}"#.utf8))

        try await store.saveContent("rule_settings", version: "v2", json: Data(#"{"a":2}"#.utf8))
        let second = try #require(try await store.cachedContent("rule_settings"))
        #expect(second.version == "v2")
        #expect(second.json == Data(#"{"a":2}"#.utf8))
        #expect(second.syncedAt > first.syncedAt)
        #expect(try await store.cachedContent("dragon_catalog")?.version == "c1")
    }
}

@Suite struct OnDiskStore {
    @Test func persistsAcrossReopen() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "StoreTests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "nested/store.sqlite")

        let guest: Profile
        let child: Profile
        let events: [StoredEvent]
        do {
            let store = try SQLiteStore.onDisk(at: url)
            guest = store.guestProfile
            child = try await store.addChildProfile(remoteID: 5, displayName: "Cy")
            let won = try await store.record(NodeWon(nodeID: 12), for: guest.id)
            let hint = try await store.record(HintUsed(problem: "2 + 2", hintsLeft: 1), for: guest.id)
            try await store.markUploaded([won.id])
            events = try await store.events(for: guest.id)
            #expect(events.map(\.id) == [won.id, hint.id])
            try await store.saveContent("node_config", version: "n1", json: Data(#"{"configs":[]}"#.utf8))
        }

        let reopened = try SQLiteStore.onDisk(at: url)
        #expect(reopened.guestProfile == guest)
        #expect(try await reopened.profiles() == [guest, child])
        #expect(try await reopened.events(for: guest.id) == events)
        #expect(try await reopened.pendingEvents(limit: 10).map(\.id) == [events[1].id])
        #expect(try await reopened.progress(for: guest.id).nodesWon == [12])
        // An offline launch plays from the content synced last time.
        #expect(try await reopened.cachedContent("node_config")?.json == Data(#"{"configs":[]}"#.utf8))
    }

    @Test func theChosenCompanionSurvivesRelaunch() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "StoreTests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "store.sqlite")

        let guest: Profile.ID
        do {
            let store = try SQLiteStore.onDisk(at: url)
            guest = store.guestProfile.id
            try await store.record(CompanionChosen(companionID: "crystal_dragon"), for: guest)
        }
        #expect(try await SQLiteStore.onDisk(at: url).progress(for: guest).companionID == "crystal_dragon")
    }
}
