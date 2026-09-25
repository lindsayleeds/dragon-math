import Foundation
import GameRules
import Store
import Testing
@testable import DragonAcademy

// Sound Hunt (`find-in-word`, driven by PhonicsModel) and Missing Sound
// (`missing-sound`, MissingSoundModel): each deals the golden round, and a
// finished round records one PhonicsAttempted per answer with its mode.

private func attempts(in store: SQLiteStore) async throws -> [PhonicsAttempted] {
    try await store.events(for: store.guestProfile.id).compactMap { try $0.decode(PhonicsAttempted.self) }
}

// MARK: - Sound Hunt

@MainActor @Test func soundHuntDealsTheGoldenRoundWithAWordPerItem() throws {
    let store = try SQLiteStore.inMemory()
    let model = PhonicsModel(
        mode: .findInWord, stages: .stage(3), store: store, profileID: store.guestProfile.id, sync: nil, seed: 42)
    var rng = SeededRandom(seed: 42)
    #expect(model.items == Phonics.buildRound(mode: .findInWord, stages: .stage(3), rng: &rng))
    // Stage 3 has fewer Sound Hunt sounds than a full round of 10.
    #expect(model.phase == .play && !model.items.isEmpty && model.total == model.items.count)
    for item in model.items {
        let word = try #require(item.word)
        #expect(item.element.words.contains(word))
        #expect(try #require(item.options).contains(item.element))
    }
}

@MainActor @Test func aSoundHuntRoundRecordsFindInWordAttempts() async throws {
    let store = try SQLiteStore.inMemory()
    let clock = ManualClock()
    let model = PhonicsModel(
        mode: .findInWord, stages: .all, store: store, profileID: store.guestProfile.id, sync: nil,
        clock: { clock.now }, seed: 7)
    var expected: [PhonicsAttempted] = []
    for i in 0..<model.total {
        let item = try #require(model.current)
        let options = try #require(item.options)
        let right = i % 2 == 0
        let tapped = try #require(options.first { ($0.key == item.element.key) == right })
        model.promptStarted()
        clock.now += 900
        model.promptFinished()
        clock.now += 2_000
        model.tap(tapped)
        #expect(model.phase == .feedback)
        #expect(model.lastResult?.correct == right)
        // The feedback shows the hunt's own word.
        #expect(PhonicsModel.example(for: item) == item.word)
        expected.append(PhonicsAttempted(
            elementKey: item.element.key, mode: "find-in-word", correct: right, chosen: right ? nil : tapped.key,
            responseMs: 2_000))
        #expect(try await attempts(in: store).isEmpty)
        model.next()
    }
    #expect(model.phase == .done && model.correctCount == 5)
    await model.lastWrite?.value
    #expect(try await attempts(in: store) == expected)
}

@MainActor @Test func theEntryOffersAllFourGames() {
    #expect(PhonicsEntry.modes.map(\.rawValue) + [PhonicsWords.missingSoundMode] == PhonicsMode.all.map(\.key))
}

// MARK: - Missing Sound

@MainActor
private struct MissingSoundHarness {
    let store: SQLiteStore
    let bests: UserDefaults
    let model: MissingSoundModel

    init(level: String = "vowels", seed: UInt64 = 42) throws {
        store = try .inMemory()
        let suite = "MissingSoundTests.\(UUID().uuidString)"
        bests = try #require(UserDefaults(suiteName: suite))
        let level = try #require(PhonicsLevel.all.first { $0.key == level })
        model = MissingSoundModel(
            level: level, store: store, profileID: store.guestProfile.id, sync: nil, bests: bests, seed: seed)
    }

    func answer(right: Bool) throws {
        let item = try #require(model.current)
        model.tap(try #require(item.options.first { ($0 == item.entry.answer) == right }))
    }

    /// Plays the whole round, right or wrong per `right(index)`.
    func play(_ right: (Int) -> Bool) throws {
        for i in 0..<model.total {
            try answer(right: right(i))
            model.next()
        }
    }
}

@MainActor @Test func missingSoundDealsTheGoldenWordsAndTiles() throws {
    let h = try MissingSoundHarness(level: "blends", seed: 1)
    var rng = SeededRandom(seed: 1)
    let words = PhonicsWords.pickWords(level: "blends", rng: &rng)
    let options = words.map { PhonicsWords.buildOptions($0, count: h.model.level.options, rng: &rng) }
    #expect(h.model.items.map(\.entry) == words)
    #expect(h.model.items.map(\.options) == options)
    #expect(h.model.phase == .play && h.model.total == PhonicsLevel.wordsPerRound)
    #expect(h.model.items.allSatisfy { $0.options.count == h.model.level.options && $0.options.contains($0.entry.answer) })
}

@MainActor @Test func aMissingSoundRoundRecordsMissingSoundAttemptsWhenItEnds() async throws {
    let h = try MissingSoundHarness(level: "vowels")
    var expected: [PhonicsAttempted] = []
    for i in 0..<h.model.total {
        let item = try #require(h.model.current)
        let right = i % 3 != 0
        try h.answer(right: right)
        let result = try #require(h.model.lastResult)
        #expect(result.correct == right)
        // Every vowels-level blank is a curriculum element (golden-pinned).
        let key = try #require(PhonicsWords.curriculumKey(for: item.entry))
        #expect(result.attempt?.elementKey == key)
        expected.append(PhonicsAttempted(
            elementKey: key, mode: "missing-sound", correct: right,
            chosen: right ? nil : PhonicsWords.curriculumKey(for: item.entry, option: result.chosen),
            responseMs: nil))
        #expect(try await attempts(in: h.store).isEmpty)
        h.model.next()
    }
    #expect(h.model.phase == .done)
    #expect(h.model.correctCount == 6 && h.model.stars == 3)
    await h.model.lastWrite?.value
    #expect(try await attempts(in: h.store) == expected)
}

@MainActor @Test func aWordOutsideTheCurriculumIsPlayedButNotRecorded() async throws {
    // Find a blends deal with "bell" in it: its `ll` is no curriculum element.
    let seed = try #require((UInt64(1)...200).first { seed in
        var rng = SeededRandom(seed: seed)
        return PhonicsWords.pickWords(level: "blends", rng: &rng).contains { $0.word == "bell" }
    })
    let h = try MissingSoundHarness(level: "blends", seed: seed)
    try h.play { _ in true }
    #expect(h.model.results.count == h.model.total)
    #expect(h.model.results.contains { $0.item.entry.word == "bell" && $0.attempt == nil })
    await h.model.lastWrite?.value
    let recorded = try await attempts(in: h.store)
    #expect(recorded.count == h.model.total - 1)
    #expect(recorded.allSatisfy { $0.mode == "missing-sound" && $0.correct })
}

@MainActor @Test func aSecondTapOnOneWordIsDropped() throws {
    let h = try MissingSoundHarness()
    let item = try #require(h.model.current)
    for option in item.options { h.model.tap(option) }
    #expect(h.model.results.count == 1)
    #expect(h.model.results[0].chosen == item.options[0])
    #expect(h.model.index == 0 && h.model.phase == .feedback)
    // `next` only moves on from the feedback.
    h.model.next()
    #expect(h.model.index == 1 && h.model.phase == .play)
    h.model.next()
    #expect(h.model.index == 1)
}

@MainActor @Test func leavingMissingSoundEarlyRecordsNothingAndPlayAgainDealsAFreshRound() async throws {
    let h = try MissingSoundHarness(level: "edges")
    let first = h.model.items
    try h.play { _ in true }
    await h.model.lastWrite?.value
    let recorded = try await attempts(in: h.store).count
    #expect(recorded == h.model.results.compactMap(\.attempt).count)
    let round = h.model.round
    h.model.playAgain()
    #expect(h.model.round == round + 1 && h.model.phase == .play && h.model.index == 0)
    #expect(h.model.results.isEmpty && h.model.best == nil)
    #expect(h.model.items != first)
    try h.answer(right: true)
    #expect(try await attempts(in: h.store).count == recorded)
}

@MainActor @Test func theLevelsBestScoreIsKeptPerProfile() throws {
    let h = try MissingSoundHarness()
    try h.play { $0 < 4 }
    #expect(h.model.best == 4 && !h.model.isNewBest) // the first round sets it quietly
    h.model.playAgain()
    try h.play { $0 < 2 }
    #expect(h.model.best == 4 && !h.model.isNewBest)
    h.model.playAgain()
    try h.play { _ in true }
    #expect(h.model.best == 10 && h.model.isNewBest)
    let key = MissingSoundModel.bestKey(level: "vowels", profileID: h.store.guestProfile.id)
    #expect(h.bests.integer(forKey: key) == 10)
    #expect(key != MissingSoundModel.bestKey(level: "blends", profileID: h.store.guestProfile.id))
}
