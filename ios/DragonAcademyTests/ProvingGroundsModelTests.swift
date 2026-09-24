import Foundation
import GameRules
import Store
import Testing
@testable import DragonAcademy

/// A millisecond clock the test moves by hand.
@MainActor final class ManualClock {
    var now: Double = 10_000
}

@MainActor
private struct Harness {
    let clock = ManualClock()
    let store: SQLiteStore
    let model: ProvingGroundsModel

    init() throws {
        store = try .inMemory()
        let clock = clock
        model = ProvingGroundsModel(
            store: store, profileID: store.guestProfile.id, sync: nil,
            clock: { clock.now }, sleep: { _ in }, seed: 3)
    }

    func type(_ value: Int) {
        for ch in String(value) { model.press(.digit(Int(String(ch))!)) }
        model.press(.ok)
    }

    /// Answers every remaining problem correctly, `stepMs` apart.
    func answerAll(stepMs: Double) throws {
        while model.screen == .play, let fact = model.drill?.current {
            clock.now += stepMs
            type(fact.answer)
        }
    }

    /// Lets the (instant) correction pause end.
    func endCorrection() async {
        for _ in 0..<100 where model.correction != nil { await Task.yield() }
    }

    func storedMedals() async throws -> [ProvingMedalEarned] {
        await model.lastWrite?.value
        return try await store.events(for: store.guestProfile.id).compactMap { try $0.decode(ProvingMedalEarned.self) }
    }
}

@MainActor @Test func aFastPerfectRunIsGoldAndIsRecorded() async throws {
    let h = try Harness()
    h.model.choose(.div)
    h.model.start(6)
    try h.answerAll(stepMs: 1500)

    #expect(h.model.screen == .result)
    let run = try #require(h.model.lastRun)
    #expect(run.result == ProvingResult(elapsedSec: 36, wrongCount: 0, medal: .gold))
    #expect(run.isBestMedal && run.isBestTime)
    #expect(try await h.storedMedals() == [
        ProvingMedalEarned(mode: "div", digit: 6, medal: "gold", elapsedMs: 36_000, wrongCount: 0),
    ])
    #expect(h.model.best(.div, 6) == ProvingBest(medal: "gold", bestMs: 36_000))
}

@MainActor @Test func bestsComeFromTheStoreAndOnlyImprove() async throws {
    let h = try Harness()
    try await h.store.record(
        ProvingMedalEarned(mode: "mul", digit: 4, medal: "gold", elapsedMs: 40_000, wrongCount: 0),
        for: h.store.guestProfile.id)
    await h.model.load()
    #expect(h.model.bestMedal(.mul, 4) == .gold)

    // A slower silver: not a best medal nor a best time; the gold stays.
    h.model.choose(.mul)
    h.model.start(4)
    try h.answerAll(stepMs: 2200)
    let run = try #require(h.model.lastRun)
    #expect(run.result.medal == .silver)
    #expect(!run.isBestMedal && !run.isBestTime)
    #expect(h.model.best(.mul, 4) == ProvingBest(medal: "gold", bestMs: 40_000))

    // A faster gold: a best time, not a better medal.
    h.model.retry()
    try h.answerAll(stepMs: 1000)
    #expect(h.model.lastRun?.isBestTime == true)
    #expect(h.model.lastRun?.isBestMedal == false)
    #expect(h.model.best(.mul, 4) == ProvingBest(medal: "gold", bestMs: 24_000))
    #expect(try await h.storedMedals().count == 3)
}

@MainActor @Test func aMissFreezesInputUntilTheCorrectionEnds() async throws {
    let h = try Harness()
    h.model.start(3)
    let fact = try #require(h.model.drill?.current)
    h.type(fact.answer + 1)
    #expect(h.model.correction == fact)
    h.model.press(.digit(5))
    #expect(h.model.input.isEmpty)

    await h.endCorrection()
    #expect(h.model.correction == nil)
    #expect(h.model.drill?.index == 1)
    #expect(h.model.drill?.wrongCount == 1)
}

@MainActor @Test func theSecondMissEndsTheRunWithNoMedalAndNothingRecorded() async throws {
    let h = try Harness()
    h.model.start(9)
    for _ in 0..<2 {
        h.clock.now += 1000
        h.type(try #require(h.model.drill?.current).answer + 1)
        await h.endCorrection()
    }
    #expect(h.model.screen == .result)
    #expect(h.model.lastRun?.result.medal == nil)
    #expect(h.model.lastRun?.result.wrongCount == 2)
    #expect(try await h.storedMedals().isEmpty)
    #expect(h.model.best(.mul, 9) == nil)
}

@MainActor @Test func inputIsCappedAndEditable() throws {
    let h = try Harness()
    h.model.start(2)
    for d in [1, 4, 4, 9] { h.model.press(.digit(d)) }
    #expect(h.model.input == "144")
    h.model.press(.delete)
    #expect(h.model.input == "14")
    // OK with nothing typed does nothing.
    h.model.press(.delete)
    h.model.press(.delete)
    h.model.press(.ok)
    #expect(h.model.drill?.answered.isEmpty == true)
}

@MainActor @Test func givingUpRecordsNothing() async throws {
    let h = try Harness()
    h.model.choose(.mul)
    h.model.start(5)
    h.type(try #require(h.model.drill?.current).answer)
    h.model.back()
    #expect(h.model.screen == .level)
    #expect(h.model.drill == nil)
    h.model.back()
    #expect(h.model.screen == .mode)
    #expect(try await h.storedMedals().isEmpty)
}
