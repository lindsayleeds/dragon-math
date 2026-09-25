import Foundation
import GameRules
import Store
import Testing
@testable import DragonAcademy

@MainActor
struct TrialModelTests {
    let clock = TestClock()

    func makeModel(
        seed: UInt64 = 7, settings: TrialSettings = .defaults,
        onComplete: @escaping @MainActor (TrialOutcome) async -> Void = { _ in }
    ) -> TrialModel {
        TrialModel(settings: settings, rng: SeededRandom(seed: seed), clock: clock.battleClock, onComplete: onComplete)
    }

    /// Moves the clock to `time` and lets the pending tick, if it's due, run.
    func advance(_ model: TrialModel, by ms: Double) async {
        clock.now += ms
        while let at = model.session.nextTimerAt, at <= clock.now, let task = model.tickTask {
            clock.wakeDue()
            await task.value
        }
    }

    func answerCell(_ model: TrialModel) -> Int {
        model.session.grid.firstIndex(of: model.trial.problem.answer)!
    }

    /// Answers every problem right after `ms`, until the trial is done.
    func finish(_ model: TrialModel, answeringAfter ms: Double = 1_000) async {
        while model.outcome == nil {
            await advance(model, by: ms)
            model.tap(answerCell(model))
            await advance(model, by: trialGridBlankMs)
        }
    }

    @Test func startsTheFirstProblemsClock() {
        let model = makeModel()
        #expect(model.trial.problemStartedAt == nil)
        model.start()
        #expect(model.trial.problemStartedAt == 1_000)
        #expect(model.gridMode == .ready)
        #expect(model.progressText.number == 1)
        #expect(model.progressText.total == 12)
        // The growl is pending.
        #expect(model.tickTask != nil)
    }

    @Test func aTapBlanksThenTheNextProblemAppears() async {
        let model = makeModel()
        model.start()
        model.tap(answerCell(model))
        #expect(model.gridMode == .blank)
        await advance(model, by: trialGridBlankMs)
        #expect(model.gridMode == .ready)
        #expect(model.trial.index == 1)
    }

    @Test func skippingScoresZero() async {
        let model = makeModel()
        model.start()
        let op = model.trial.problem.op
        model.skip()
        #expect(model.trial.perOpPoints[op] == [0])
        #expect(model.gridMode == .blank)
    }

    @Test func aFluentKidIsPlacedAtTheLastWorldAndItIsRecordedOnce() async throws {
        let outcomes = Box<[TrialOutcome]>([])
        let model = makeModel(onComplete: { outcomes.value.append($0) })
        model.start()
        await finish(model)
        await model.recording?.value
        #expect(model.gridMode == .over)
        #expect(model.outcome?.targetNodeID == 34)
        #expect(outcomes.value.count == 1)
        await advance(model, by: 30_000)
        #expect(outcomes.value.count == 1)
    }

    @Test func thePlacementIsRecordedAndMovesTheMapFrontier() async throws {
        let store = try SQLiteStore.inMemory()
        let guest = store.guestProfile
        let syncs = Box(0)
        let model = makeModel(onComplete: TrialModel.recordingPlacement(
            in: store, for: guest.id, requestSync: { syncs.value += 1 }))
        model.start()
        // Fluent at nothing: every answer 20 s late is 120 points, 600/1000.
        await finish(model, answeringAfter: 20_000)
        await model.recording?.value

        let outcome = try #require(model.outcome)
        let events = try await store.events(for: guest.id)
        let recorded = try #require(try events.first?.decode(TrialCompleted.self))
        #expect(recorded.targetNodeID == outcome.targetNodeID)
        #expect(recorded.perOp["add"]?.band == outcome.add.band.rawValue)
        #expect(Set(recorded.perOp.keys) == ["add", "sub", "mul", "div"])
        let progress = try await store.progress(for: guest.id)
        #expect(progress.trialTaken)
        #expect(progress.frontier == outcome.targetNodeID)
        #expect(syncs.value == 1)
    }

    @Test func settingsDecodeFromTheSyncedRuleSettings() async throws {
        let store = try SQLiteStore.inMemory()
        #expect(await TrialSettings.synced(from: store) == .defaults)
        // golden/rule-settings.json wraps the served document: {fixture, version, document}.
        let fixture = try #require(
            try JSONSerialization.jsonObject(with: Data(contentsOf: RuleSettingsFixture.url)) as? [String: Any])
        var doc = try #require(fixture["document"] as? [String: Any])
        var trial = try #require(doc["trial"] as? [String: Any])
        trial["all_mastered_node"] = 35
        doc["trial"] = trial
        try await store.saveContent("rule_settings", version: "v", json: JSONSerialization.data(withJSONObject: doc))
        #expect(await TrialSettings.synced(from: store).allMasteredNode == 35)
    }

    @Test func theMapOffersTheTrialOnlyToANewKid() {
        #expect(TrialInvitation.offers(ProfileProgress(), style: .banner))
        #expect(!TrialInvitation.offers(ProfileProgress(nodesWon: [1]), style: .banner))
        #expect(!TrialInvitation.offers(ProfileProgress(trialTaken: true), style: .banner))
        // The lair offers it until it's taken.
        #expect(TrialInvitation.offers(ProfileProgress(nodesWon: [1, 2]), style: .card))
        #expect(!TrialInvitation.offers(ProfileProgress(trialTaken: true), style: .card))
    }
}

@MainActor
final class Box<Value> {
    var value: Value
    init(_ value: Value) { self.value = value }
}

/// golden/rule-settings.json, a full served GET /api/rule-settings document.
enum RuleSettingsFixture {
    static let url: URL = {
        var url = URL(filePath: #filePath)
        for _ in 0..<3 { url.deleteLastPathComponent() }
        return url.appending(path: "golden/rule-settings.json")
    }()
}
