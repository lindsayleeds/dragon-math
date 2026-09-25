import Foundation
import GameRules
import Store
import Sync
import Testing
@testable import DragonAcademy

/// A millisecond clock the test moves by hand.
@MainActor private final class HatcheryClock {
    var now: Double = 50_000
}

@MainActor
private struct Harness {
    let clock = HatcheryClock()
    let store: SQLiteStore
    let model: EggHatcheryModel

    /// Timers never fire on their own: the test moves the clock and ticks.
    init(_ op: BattleOp = .mul, number: Int = 7, seed: UInt64 = 11) throws {
        store = try .inMemory()
        let clock = clock
        model = EggHatcheryModel(
            facts: LairFacts(operation: op, number: number), store: store, profileID: store.guestProfile.id, sync: nil,
            clock: { clock.now }, sleep: { _ in try await Task.sleep(for: .seconds(3_600)) }, seed: seed)
    }

    func advance(_ ms: Double) {
        clock.now += ms
        model.tick()
    }

    func tapRight() throws {
        let problem = try #require(model.current)
        model.tap(try #require(model.choices.firstIndex(of: problem.correctAnswer)))
    }

    /// Solves every egg, `thinkMs` per problem, letting each hatch.
    func solveAll(thinkMs: Double) throws {
        while model.current != nil {
            advance(thinkMs)
            try tapRight()
            advance(hatcheryHatchMs)
        }
        advance(hatcheryFinishMs)
    }

    func stored<P: EventPayload>(_: P.Type) async throws -> [P] {
        await model.lastWrite?.value
        return try await store.events(for: store.guestProfile.id).compactMap { try $0.decode(P.self) }
    }
}

@MainActor @Test func aFullRoundIsRecordedAsAttemptsAndDragons() async throws {
    let h = try Harness(.div, number: 3)
    await h.model.load()
    let round = try #require(h.model.round)
    #expect(round.problems.count == hatcherySize)
    #expect(h.model.baseNumber == 3)

    try h.solveAll(thinkMs: 600)

    // 12 × (0.6 s + 0.8 s) + 0.3 s.
    #expect(h.model.result == HatcheryResult(elapsedSeconds: 17.1, tier: .gold))
    #expect(h.model.hatchedCount == hatcherySize)
    let attempts = try await h.stored(ProblemAttempted.self)
    let problems = try #require(h.model.round).problems
    #expect(attempts == problems.map {
        ProblemAttempted(
            nodeID: 0, operandA: $0.operand1, operandB: $0.operand2, op: "div", answer: $0.correctAnswer,
            outcome: "child", timeMs: 600)
    })
    #expect(attempts.allSatisfy { $0.operandA == $0.operandB * $0.answer && $0.operandB == 3 })
    let dragons = try await h.stored(DragonsCollected.self)
    #expect(dragons.count == 1)
    #expect(dragons.first?.dragonIDs == h.model.round?.dragons.map(\.dragonID))
    // No catalog synced: the fallback art range.
    #expect(dragons.first?.dragonIDs.allSatisfy { (1...hatcheryFallbackDragonCount).contains($0) } == true)

    // Later ticks don't record the round again.
    h.advance(5_000)
    await h.model.lastWrite?.value
    #expect(try await h.stored(ProblemAttempted.self).count == hatcherySize)
}

@MainActor @Test func theSameSeedPlaysTheSameRound() throws {
    let a = try Harness(seed: 5), b = try Harness(seed: 5)
    a.model.start(.init())
    b.model.start(.init())
    #expect(a.model.round?.problems == b.model.round?.problems)
    #expect(a.model.choices == b.model.choices)
}

@MainActor @Test func aWrongTapIsMarkedThenClearsAndCountsTowardTheTime() throws {
    let h = try Harness()
    h.model.start(.init())
    let problem = try #require(h.model.current)
    let wrong = try #require(h.model.choices.firstIndex { $0 != problem.correctAnswer })

    h.advance(1_000)
    h.model.tap(wrong)
    #expect(h.model.wrongButton == wrong)
    h.advance(hatcheryWrongMs - 1)
    #expect(h.model.wrongButton == wrong)
    h.advance(1)
    #expect(h.model.wrongButton == nil)

    h.advance(500)
    try h.tapRight()
    #expect(h.model.hatchingButton != nil)
    // Taps while the egg cracks are ignored.
    h.model.tap(wrong)
    #expect(h.model.wrongButton == nil)
    #expect(h.model.round?.attempts == [HatcheryAttempt(problem: problem, timeMs: 2_000, wrongTaps: 1)])
    h.advance(hatcheryHatchMs)
    #expect(h.model.hatchedCount == 1)
    #expect(h.model.current != problem)
}

@MainActor @Test func aHintIsOfferedAfterTheDelayAndShowsASkipCount() throws {
    let h = try Harness(.mul, number: 4)
    h.model.start(.init())
    let delay = try #require(h.model.round?.hintOfferAt) - h.clock.now
    #expect((5_000..<7_000).contains(delay))

    h.advance(delay - 1)
    #expect(!h.model.showsHintButton)
    h.advance(1)
    #expect(h.model.showsHintButton)
    h.model.toggleHint()
    #expect(h.model.round?.hintText?.hasPrefix("Skip-count: 4, 8") == true)
    // Answering keeps an open hint's button; the next problem starts closed.
    try h.tapRight()
    #expect(h.model.showsHintButton)
    h.advance(hatcheryHatchMs)
    #expect(!h.model.showsHintButton)
    #expect(h.model.round?.hintText == nil)
}

@MainActor @Test func tunedSettingsSetTheHintDelayAndTiers() throws {
    let h = try Harness()
    var settings = EggHatcherySettings.defaults
    settings.hintDelayMinMs = 100
    settings.hintDelaySpreadMs = 0
    settings.tierSeconds = HatcheryTierSeconds(legendary: 100, gold: 200, silver: 300)
    h.model.start(.init(pool: [42], settings: settings))
    #expect(h.model.round?.hintOfferAt == h.clock.now + 100)
    try h.solveAll(thinkMs: 2_000)
    #expect(h.model.result?.tier == .legendary)
    #expect(h.model.round?.dragons.allSatisfy { $0.dragonID == 42 } == true)
}

@MainActor @Test func quittingRecordsNothing() async throws {
    let h = try Harness()
    h.model.start(.init())
    h.advance(800)
    try h.tapRight()
    h.model.confirmingQuit = true
    h.model.quit()
    #expect(!h.model.confirmingQuit)
    h.advance(10_000)
    #expect(h.model.hatchedCount == 0)
    #expect(h.model.lastWrite == nil)
    #expect(try await h.store.events(for: h.store.guestProfile.id).isEmpty)
}

@MainActor @Test func theRoundDrawsFromTheSyncedCatalogAndSettings() async throws {
    let store = try SQLiteStore.inMemory()
    try await store.saveContent(
        ContentDocument.dragonCatalog.name, version: "c1",
        json: Data(#"{"dragons":[{"dragon_id":300,"name":"Ember","rarity":"mythic"},{"dragon_id":301,"name":null,"rarity":"common"}],"total":2}"#.utf8))
    try await store.saveContent(ContentDocument.ruleSettings.name, version: "r1", json: try ruleSettings(eggHatchery: [
        "tier_seconds": ["legendary": 10, "gold": 20.5, "silver": 30],
        "hint_delay_min_ms": 3000, "hint_delay_spread_ms": -1,
    ]))

    let context = await EggHatcheryModel.context(from: store)
    #expect(context.pool == [300, 301])
    // A negative spread falls back, as the web's converter does.
    #expect(context.settings == EggHatcherySettings(
        tierSeconds: HatcheryTierSeconds(legendary: 10, gold: 20.5, silver: 30), hintDelayMinMs: 3000,
        hintDelaySpreadMs: 2000))

    // Nothing synced: the built-in defaults and the fallback range.
    let empty = try SQLiteStore.inMemory()
    #expect(await EggHatcheryModel.context(from: empty) == .init())
}

/// golden/rule-settings.json's served document with its `egg_hatchery` swapped.
private func ruleSettings(eggHatchery: [String: Any]) throws -> Data {
    var root = URL(filePath: #filePath)
    for _ in 0..<4 { root.deleteLastPathComponent() }
    let file = try Data(contentsOf: root.appending(path: "golden/rule-settings.json"))
    let golden = try #require(try JSONSerialization.jsonObject(with: file) as? [String: Any])
    var document = try #require(golden["document"] as? [String: Any])
    document["egg_hatchery"] = eggHatchery
    return try JSONSerialization.data(withJSONObject: document)
}
