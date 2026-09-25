import Audio
import Foundation
import GameRules
import Store
import Testing
@testable import DragonAcademy

/// The words a test heard spoken.
@MainActor final class SpokenLog {
    var words: [String] = []

    var speak: @MainActor (String) async -> Void {
        { self.words.append($0) }
    }
}

@MainActor
private struct SpellingHarness {
    let store: SQLiteStore
    let sounds = SoundLog()
    let spoken = SpokenLog()
    let model: SpellingModel
    let seed: UInt64

    init(
        grade: Int = 1, difficulty: SpellingDifficulty = .easy, seed: UInt64 = 42,
        prizeContext: @escaping @MainActor () async -> PrizeContext = { PrizeContext() }
    ) throws {
        store = try .inMemory()
        self.seed = seed
        model = SpellingModel(
            grade: try #require(SpellingGrade.numbered(grade)), difficulty: difficulty,
            store: store, profileID: store.guestProfile.id, sync: nil,
            rng: SeededRandom(seed: seed), prizeRNG: SeededRandom(seed: 5), sleep: { _ in },
            speak: spoken.speak, playSound: sounds.play, prizeContext: prizeContext)
    }

    var guest: Profile.ID { store.guestProfile.id }

    /// Spells the current word, right or with its first letter changed.
    func spell(correctly: Bool) throws {
        let word = try #require(model.word)
        if model.difficulty.usesTiles {
            // A tile's id is its letter's place in the word, so ids in order
            // spell it; swapping the first letter with a different one doesn't.
            var ids = Array(0..<word.count)
            if !correctly {
                let letters = Array(word)
                let j = try #require(letters.firstIndex { $0 != letters[0] })
                ids.swapAt(0, j)
            }
            for id in ids { model.place(id) }
        } else {
            let answer = correctly ? word : (word.first == "z" ? "y" : "z") + word.dropFirst()
            for letter in answer { model.press(letter) }
        }
        model.submit()
    }

    /// Plays the rest of the round, `right` words correctly then the rest wrong.
    func finishRound(right: Int) async throws {
        var n = model.results.count
        while model.phase != .done {
            if model.phase == .flash { await model.beat?.value }
            try spell(correctly: n < right)
            n += 1
            model.advance()
        }
        await model.lastWrite?.value
    }

    func events<T: EventPayload>(_: T.Type) async throws -> [T] {
        try await store.events(for: guest).compactMap { try $0.decode(T.self) }
    }
}

/// The round and tile draws a seed makes, per GameRules' draw order.
private func expectedEasyGame(grade: Int, seed: UInt64, rounds: Int) throws -> [(words: [String], tiles: [[Int]])] {
    let grade = try #require(SpellingGrade.numbered(grade))
    var rng = SeededRandom(seed: seed)
    return (0..<rounds).map { _ in
        let words = Spelling.drawRound(grade.source, rng: &rng)
        return (words, words.map { word in Spelling.letterTiles(word, rng: &rng).map(\.id) })
    }
}

@MainActor @Test func easyDrawsTheRoundThenEachWordsTilesFromOneGenerator() async throws {
    let h = try SpellingHarness(grade: 2, seed: 42)
    let expected = try expectedEasyGame(grade: 2, seed: 42, rounds: 2)
    #expect(h.model.words == expected[0].words)
    #expect(h.model.words.count == Spelling.wordsPerRound)

    var seen: [[Int]] = []
    while h.model.phase != .done {
        seen.append(h.model.tiles.map(\.id))
        try h.spell(correctly: true)
        h.model.advance()
    }
    #expect(seen == expected[0].tiles)
    await h.model.lastWrite?.value

    // "Play again" draws on from the same generator.
    h.model.playAgain()
    #expect(h.model.words == expected[1].words)
    #expect(h.model.tiles.map(\.id) == expected[1].tiles[0])
    #expect(h.model.index == 0 && h.model.results.isEmpty && h.model.hintCount == 0)
}

@MainActor @Test func mediumAndHardDrawOnlyTheRound() async throws {
    for difficulty in [SpellingDifficulty.medium, .hard] {
        let h = try SpellingHarness(grade: 4, difficulty: difficulty, seed: 7)
        var rng = SeededRandom(seed: 7)
        let grade = try #require(SpellingGrade.numbered(4))
        let first = Spelling.drawRound(grade.source, rng: &rng)
        let second = Spelling.drawRound(grade.source, rng: &rng)
        #expect(h.model.words == first)
        #expect(h.model.tiles.isEmpty)
        for _ in first {
            if h.model.phase == .flash {
                h.model.press("a") // no typing while it flashes
                #expect(h.model.typed.isEmpty)
                await h.model.beat?.value
            }
            try h.spell(correctly: true)
            h.model.advance()
        }
        h.model.playAgain()
        #expect(h.model.words == second)
    }
}

@MainActor @Test func eachWordIsSpokenAsItComesUpAndOnRequest() async throws {
    let h = try SpellingHarness()
    let first = try #require(h.model.word)
    await h.model.speaking?.value
    h.model.sayWord()
    await h.model.speaking?.value
    try h.spell(correctly: true)
    h.model.advance()
    await h.model.speaking?.value
    #expect(h.spoken.words == [first, first, try #require(h.model.word)])
}

@MainActor @Test func tilesBuildTheWordAndComeBackOut() throws {
    let h = try SpellingHarness()
    let word = try #require(h.model.word)
    #expect(!h.model.canSubmit)
    let tiles = h.model.tiles
    h.model.place(tiles[0].id)
    h.model.place(tiles[0].id) // already placed
    h.model.place(tiles[1].id)
    #expect(h.model.builtFromTiles == tiles[0].letter + tiles[1].letter)
    #expect(h.model.trayTiles.count == word.count - 2)
    h.model.remove(tiles[0].id)
    #expect(h.model.builtFromTiles == tiles[1].letter)
    h.model.undoTile()
    #expect(h.model.placed.isEmpty)
    // Every tile placed: "Check it" is on, right or wrong.
    for tile in tiles { h.model.place(tile.id) }
    #expect(h.model.canSubmit)
    h.model.submit()
    #expect(h.model.phase == .feedback)
    #expect(h.model.lastCorrect == (h.model.builtFromTiles == word))
}

@MainActor @Test func rightAndWrongAnswersScoreAndSound() throws {
    let h = try SpellingHarness(difficulty: .hard)
    let word = try #require(h.model.word)
    try h.spell(correctly: true)
    #expect(h.model.phase == .feedback && h.model.lastCorrect)
    h.model.advance()
    let second = try #require(h.model.word)
    try h.spell(correctly: false)
    #expect(!h.model.lastCorrect)
    #expect(h.model.results == [.init(word: word, correct: true), .init(word: second, correct: false)])
    #expect(h.model.correctCount == 1)
    #expect(h.sounds.played == [.correct, .wrong])
}

@MainActor @Test func typingIsCappedAndBackspaces() throws {
    let h = try SpellingHarness(difficulty: .hard)
    let word = try #require(h.model.word)
    #expect(!h.model.canSubmit)
    for _ in 0..<(word.count + 10) { h.model.press("Q") }
    #expect(h.model.typed == String(repeating: "q", count: word.count + SpellingModel.typingSlack))
    h.model.backspace()
    #expect(h.model.typed.count == word.count + SpellingModel.typingSlack - 1)
}

@MainActor @Test func mediumFlashesTheWordThenHidesIt() async throws {
    let h = try SpellingHarness(difficulty: .medium)
    #expect(h.model.phase == .flash)
    #expect(!h.model.canSubmit)
    await h.model.beat?.value
    #expect(h.model.phase == .spell)
}

@MainActor @Test func hintsCountOncePerWord() async throws {
    let easy = try SpellingHarness()
    easy.model.peek()
    #expect(easy.model.peeking)
    easy.model.peek()
    await easy.model.beat?.value
    #expect(!easy.model.peeking)
    #expect(easy.model.hintCount == 1)
    try easy.spell(correctly: true)
    easy.model.advance()
    easy.model.peek()
    easy.model.endPeek()
    #expect(!easy.model.peeking && easy.model.hintCount == 2)

    let hard = try SpellingHarness(difficulty: .hard)
    hard.model.toggleHint()
    #expect(hard.model.showHint)
    hard.model.toggleHint()
    hard.model.toggleHint()
    #expect(hard.model.hintCount == 1)
    // A new word hides it again.
    try hard.spell(correctly: true)
    hard.model.advance()
    #expect(!hard.model.showHint)
}

@MainActor @Test func aFinishedRoundRecordsItsScoreAndPrize() async throws {
    let context = PrizeContext(
        catalog: [PrizeDragon(dragonID: 9, name: "Moss", rarity: "common")], settings: .defaults, owned: [:])
    let h = try SpellingHarness(grade: 3, difficulty: .hard, prizeContext: { context })
    try await h.finishRound(right: 10)

    #expect(h.model.phase == .done)
    #expect(h.model.correctCount == 10)
    #expect(try await h.events(SpellingRoundFinished.self) == [
        SpellingRoundFinished(sourceKey: "grade:3", difficulty: "hard", correct: 10, total: 10, hints: 0),
    ])
    guard case .revealed(let cards) = h.model.prize else {
        Issue.record("no prize after the round"); return
    }
    #expect(!cards.isEmpty && cards.allSatisfy { $0.dragon.dragonID == 9 })
    #expect(try await h.events(DragonsCollected.self) == [DragonsCollected(dragonIDs: cards.map(\.dragon.dragonID))])
    // A perfect round plays correct once more at the end.
    #expect(h.sounds.played.suffix(2) == [.correct, .correct])
}

@MainActor @Test func theBestScoreIsPerGradeAndDifficulty() async throws {
    let h = try SpellingHarness(grade: 1, difficulty: .easy)
    // Another difficulty and another grade don't count.
    try await h.store.record(
        SpellingRoundFinished(sourceKey: "grade:1", difficulty: "hard", correct: 10, total: 10, hints: 0), for: h.guest)
    try await h.store.record(
        SpellingRoundFinished(sourceKey: "grade:2", difficulty: "easy", correct: 10, total: 10, hints: 0), for: h.guest)
    try await h.finishRound(right: 6)
    #expect(h.model.best == .init(best: 6, isNew: false))

    h.model.playAgain()
    try await h.finishRound(right: 8)
    #expect(h.model.best == .init(best: 8, isNew: true))

    h.model.playAgain()
    try await h.finishRound(right: 3)
    #expect(h.model.best == .init(best: 8, isNew: false))
}

@Test func bestFollowsTheWeb() {
    #expect(SpellingModel.best(correct: 4, prior: nil) == .init(best: 4, isNew: false))
    #expect(SpellingModel.best(correct: 5, prior: 4) == .init(best: 5, isNew: true))
    #expect(SpellingModel.best(correct: 4, prior: 4) == .init(best: 4, isNew: false))
}
