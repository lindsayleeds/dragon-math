import Foundation
import GameRules
import Store
import Testing
@testable import DragonAcademy

@MainActor
private struct PhonicsHarness {
    let clock = ManualClock()
    let store: SQLiteStore
    let model: PhonicsModel

    init(mode: PhonicsRoundMode, stages: PhonicsStages = .stage(3)) throws {
        store = try .inMemory()
        let clock = clock
        model = PhonicsModel(
            mode: mode, stages: stages, store: store, profileID: store.guestProfile.id, sync: nil,
            clock: { clock.now }, seed: 42)
    }

    /// Answers the current question, `afterMs` after its sound finished.
    func answer(right: Bool, afterMs: Double = 1_500) throws {
        let item = try #require(model.current)
        model.promptStarted()
        clock.now += 700
        model.promptFinished()
        clock.now += afterMs
        switch model.mode {
        case .typeIt:
            model.submit(typed: right ? item.element.accepts.last! : "zzz")
        default:
            let options = try #require(item.options)
            model.tap(try #require(options.first { ($0.key == item.element.key) == right }))
        }
    }

    func attempts() async throws -> [PhonicsAttempted] {
        try await store.events(for: store.guestProfile.id).compactMap { try $0.decode(PhonicsAttempted.self) }
    }
}

@MainActor @Test func theDealIsTheGoldenRound() throws {
    // The model deals exactly what GameRules deals from the same seed.
    let h = try PhonicsHarness(mode: .choose)
    var rng = SeededRandom(seed: 42)
    let expected = Phonics.buildRound(mode: .choose, stages: .stage(3), rng: &rng)
    #expect(h.model.items == expected)
    #expect(h.model.phase == .play && h.model.total == expected.count)
}

@MainActor @Test func aSoundMatchRoundRecordsEveryAnswerWhenItEnds() async throws {
    let h = try PhonicsHarness(mode: .choose, stages: .stage(1))
    #expect(h.model.total == 10)
    var expected: [PhonicsAttempted] = []
    for i in 0..<h.model.total {
        let right = i % 3 != 0
        let item = try #require(h.model.current)
        try h.answer(right: right)
        #expect(h.model.phase == .feedback)
        let result = try #require(h.model.lastResult)
        #expect(result.correct == right)
        expected.append(PhonicsAttempted(
            elementKey: item.element.key, mode: "choose", correct: right,
            chosen: right ? nil : result.chosen?.key, responseMs: 1_500))
        // Nothing is saved until the round ends.
        #expect(try await h.attempts().isEmpty)
        h.model.next()
    }
    #expect(h.model.phase == .done)
    #expect(h.model.correctCount == 6)
    #expect(h.model.stars == 3)
    await h.model.lastWrite?.value
    #expect(try await h.attempts() == expected)
    #expect(expected.filter { !$0.correct }.allSatisfy { $0.chosen != nil })
}

@MainActor @Test func aSecondAnswerToOneQuestionIsDropped() throws {
    let h = try PhonicsHarness(mode: .choose)
    try h.answer(right: false)
    let options = try #require(h.model.current?.options)
    for option in options { h.model.tap(option) }
    #expect(h.model.results.count == 1 && h.model.results[0].correct == false)
    #expect(h.model.index == 0)
}

@MainActor @Test func soundSpellTakesAnyAcceptedSpellingAndNamesATypedConfusion() async throws {
    let h = try PhonicsHarness(mode: .typeIt, stages: .stage(7))
    #expect(h.model.current?.options == nil)
    h.model.submit(typed: "   ")
    #expect(h.model.results.isEmpty)
    try h.answer(right: true)
    #expect(h.model.lastResult?.correct == true)
    h.model.next()

    // Typing another sound's spelling records that sound as the confusion.
    let item = try #require(h.model.current)
    let other = try #require(PhonicsElement.all.first { $0.key != item.element.key && $0.type == "consonant" })
    h.model.submit(typed: other.g)
    #expect(h.model.lastResult?.correct == false)
    #expect(h.model.lastResult?.attempt.chosen == other.key)
    #expect(h.model.lastResult?.said == other.g)
}

@MainActor @Test func noResponseTimeWhileTheSoundIsStillPlaying() throws {
    let h = try PhonicsHarness(mode: .choose)
    h.model.promptStarted()
    let item = try #require(h.model.current)
    h.model.tap(item.element)
    #expect(h.model.lastResult?.attempt.responseMs == nil)
}

@MainActor @Test func leavingEarlyRecordsNothingAndPlayAgainDealsAFreshRound() async throws {
    let h = try PhonicsHarness(mode: .choose, stages: .stages([2, 3]))
    let first = h.model.items
    for _ in 0..<h.model.total {
        try h.answer(right: true)
        h.model.next()
    }
    await h.model.lastWrite?.value
    #expect(try await h.attempts().count == first.count)
    let round = h.model.round
    h.model.playAgain()
    #expect(h.model.round == round + 1 && h.model.phase == .play && h.model.index == 0)
    #expect(h.model.results.isEmpty)
    #expect(h.model.items != first)
    // Half a round, then gone: nothing more is recorded.
    try h.answer(right: true)
    #expect(try await h.attempts().count == first.count)
}

@Test func theFeedbackPicksOutTheLettersInTheWord() throws {
    let sh = try #require(Phonics.elementByKey["sh"])
    let parts = try #require(PhonicsModel.highlight("Fish", element: sh))
    #expect(parts.before == "Fi" && parts.match == "sh" && parts.after == "")
    // A magic-e frame has no literal letters to pick out.
    #expect(PhonicsModel.highlight("cake", element: try #require(Phonics.elementByKey["long-a"])) == nil)
    let hunt = PhonicsItem(element: sh, word: "shell", options: nil)
    #expect(PhonicsModel.example(for: hunt) == "shell")
    #expect(PhonicsModel.example(for: PhonicsItem(element: sh, word: nil, options: nil)) == sh.words[0])
}
