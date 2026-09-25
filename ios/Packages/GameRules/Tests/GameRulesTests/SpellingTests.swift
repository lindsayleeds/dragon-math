import Foundation
import GameRules
import Testing

/// golden/spelling.json, written by `npm run golden:generate` from
/// src/rules/spelling.js (see spellingGolden.js for the four parts).
private struct SpellingGolden: Decodable {
    struct Round: Decodable, CustomTestStringConvertible {
        let grade: Int
        let seed: String
        let words: [String]
        var testDescription: String { "grade \(grade) seed \(seed)" }
    }

    struct Game: Decodable, CustomTestStringConvertible {
        struct Played: Decodable {
            let words: [String]
            let tiles: [[Int]]
        }

        let grade: Int
        let seed: String
        let rounds: [Played]
        var testDescription: String { "Easy game, grade \(grade) seed \(seed)" }
    }

    struct Sourced: Decodable, CustomTestStringConvertible {
        let name: String
        let input: [String]
        let perRound: Int
        let seed: String
        let words: [String]
        var testDescription: String { "\(name) seed \(seed)" }
    }

    struct List: Decodable {
        let list: String
        let input: [String]
        let seed: String
        let words: [String]
    }

    struct Source: Decodable {
        let source: String
        let input: [String]
        let perRound: Int
        let seed: String
        let words: [String]
    }

    let fixture: String
    let wordsPerRound: Int
    let catalogs: [String: [String]]
    let rounds: [Round]
    let games: [Game]
    let lists: [List]
    let sources: [Source]

    static func load() throws -> SpellingGolden {
        try JSONDecoder().decode(SpellingGolden.self, from: RepoPaths.goldenData("spelling"))
    }

    /// Custom lists (played in full) and the hand-built perRound edges, as one
    /// kind of case: a source and what drawRound makes of it.
    static func sourcedCases() throws -> [Sourced] {
        let golden = try load()
        return golden.lists.map {
            Sourced(name: "list \($0.list)", input: $0.input, perRound: $0.input.count, seed: $0.seed, words: $0.words)
        } + golden.sources.map {
            Sourced(name: $0.source, input: $0.input, perRound: $0.perRound, seed: $0.seed, words: $0.words)
        }
    }
}

private func rng(_ seed: String) -> SeededRandom {
    SeededRandom(seed: UInt64(seed)!)
}

@Test func goldenIsTheSpellingFixture() throws {
    let golden = try SpellingGolden.load()
    #expect(golden.fixture == "spelling")
    #expect(golden.wordsPerRound == Spelling.wordsPerRound)
    #expect(!golden.rounds.isEmpty && !golden.games.isEmpty && !golden.lists.isEmpty && !golden.sources.isEmpty)
}

@Test func theBundledCatalogsAreTheGoldenOnes() throws {
    let golden = try SpellingGolden.load()
    #expect(SpellingGrade.all.map(\.grade) == golden.catalogs.keys.compactMap(Int.init).sorted())
    for grade in SpellingGrade.all {
        #expect(grade.words == golden.catalogs[String(grade.grade)], "grade \(grade.grade)")
        #expect(grade.label == "Grade \(grade.grade)")
    }
}

@Test(arguments: try SpellingGolden.load().rounds)
private func gradeRoundsMatchTheGolden(_ round: SpellingGolden.Round) throws {
    let grade = try #require(SpellingGrade.numbered(round.grade))
    var r = rng(round.seed)
    #expect(Spelling.drawRound(grade.source, rng: &r) == round.words)
}

@Test(arguments: try SpellingGolden.load().games)
private func easyGamesMatchTheGolden(_ game: SpellingGolden.Game) throws {
    // One generator for the whole game: a round, each word's tiles as it
    // comes up, then "play again".
    let grade = try #require(SpellingGrade.numbered(game.grade))
    var r = rng(game.seed)
    for played in game.rounds {
        let words = Spelling.drawRound(grade.source, rng: &r)
        #expect(words == played.words)
        let tiles = words.map { word in Spelling.letterTiles(word, rng: &r) }
        #expect(tiles.map { $0.map(\.id) } == played.tiles)
        for (word, wordTiles) in zip(words, tiles) {
            // Each tile carries its own letter.
            let letters = Array(word).map(String.init)
            #expect(wordTiles.allSatisfy { letters[$0.id] == $0.letter })
        }
    }
}

@Test(arguments: try SpellingGolden.sourcedCases())
private func listsAndEdgeSourcesMatchTheGolden(_ c: SpellingGolden.Sourced) {
    var r = rng(c.seed)
    #expect(Spelling.drawRound(SpellingSource(words: c.input, perRound: c.perRound), rng: &r) == c.words)
}

@Test func aRoundTakesOneDrawPerStepOfTheWholePool() {
    var counted = CountingRandom()
    let round = Spelling.drawRound(SpellingGrade.all[0].source, rng: &counted)
    #expect(round.count == Spelling.wordsPerRound)
    #expect(counted.draws == SpellingGrade.all[0].words.count - 1)
    var tiles = CountingRandom()
    _ = Spelling.letterTiles("dragon", rng: &tiles)
    #expect(tiles.draws == 5)
    _ = Spelling.letterTiles("a", rng: &tiles)
    #expect(tiles.draws == 5)
}

@Test func answersAreTrimmedAndCaseInsensitive() {
    #expect(Spelling.isCorrect(" Dragon ", for: "dragon"))
    #expect(!Spelling.isCorrect("dragn", for: "dragon"))
    #expect(!Spelling.isCorrect("   ", for: "dragon"))
}

@Test func starsAndPrizeFollowTheScore() {
    #expect(Spelling.stars(correct: 10, total: 10) == 5)
    #expect(Spelling.stars(correct: 1, total: 10) == 1) // 0.5 rounds up
    #expect(Spelling.stars(correct: 0, total: 10) == 0)
    #expect(Spelling.prizePerformance(correct: 8, total: 10) == .high)
    #expect(Spelling.prizePerformance(correct: 4, total: 10) == .normal)
    #expect(Spelling.prizePerformance(correct: 3, total: 10) == .low)
}

/// Every grade word has its clip in public/audio/spelling — the files the app
/// bundles (project.yml), so a word never plays silent offline.
@Test func everyGradeWordHasAClip() {
    let clips = RepoPaths.root.appending(path: "public/audio/spelling")
    for grade in SpellingGrade.all {
        for word in grade.words {
            let file = Spelling.promptWords.contains(word) ? "prompts/\(word).mp3" : "\(word).mp3"
            #expect(FileManager.default.fileExists(atPath: clips.appending(path: file).path), "grade \(grade.grade): \(file)")
        }
    }
}

private struct CountingRandom: RandomSource {
    var draws = 0
    mutating func next() -> Double {
        draws += 1
        return 0.5
    }
}
