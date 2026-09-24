import Foundation
import Testing
@testable import GameRules

/// golden/memorize.json, written by src/rules/memorizeGolden.js.
private struct MemorizeGolden: Decodable, Sendable {
    struct Segment: Decodable, Sendable {
        let type: String
        let value: String
        let wordIndex: Int?
    }

    struct Sentence: Decodable, Sendable {
        let text: String
        let words: [String]
        let segments: [Segment]
        let hidden: [Int]
        let firstLetters: [String]
    }

    struct Passage: Decodable, Sendable, CustomTestStringConvertible {
        var testDescription: String { name }
        let name: String
        let body: String
        let unsupported: [String]
        let sentences: [Sentence]
    }

    struct Run: Decodable, Sendable, CustomTestStringConvertible {
        var testDescription: String { "\(passage) \(difficulty) seed \(seed)" }
        let passage: String
        let difficulty: String
        let seed: String
        let tiles: [[Int]]
    }

    struct Normalize: Decodable, Sendable {
        let input: String
        let normalized: String
        let firstLetter: String
    }

    /// A served `memorize` section, decoded with the live document's field
    /// names and types (`MemorizeSettings` in server/openapi.json).
    struct ServedMemorize: Decodable, Sendable {
        let easy_hide_every: Int
        let easy_hide_offset: Int

        var swift: MemorizeSettings {
            MemorizeSettings(servedEasyHideEvery: easy_hide_every, easyHideOffset: easy_hide_offset)
        }
    }

    struct Settings: Decodable, Sendable {
        let schema_version: Int
        let memorize: ServedMemorize
    }

    struct Tuned: Decodable, Sendable {
        struct Hidden: Decodable, Sendable {
            let passage: String
            let hidden: [[Int]]
        }

        let settings: ServedMemorize
        let hidden: [Hidden]
    }

    let fixture: String
    let version: Int
    let settings: Settings
    let passages: [Passage]
    let runs: [Run]
    let normalize: [Normalize]
    let tuned: Tuned

    static func load() throws -> MemorizeGolden {
        try JSONDecoder().decode(MemorizeGolden.self, from: RepoPaths.goldenData("memorize"))
    }

    func passage(_ name: String) throws -> Passage {
        try #require(passages.first { $0.name == name }, "no passage \(name)")
    }
}

private let golden = Result { try MemorizeGolden.load() }
private func passages() throws -> [MemorizeGolden.Passage] { try golden.get().passages }
private func runs() throws -> [MemorizeGolden.Run] { try golden.get().runs }

/// Foundation's NFKD, standing in for the app's `TextNormalization.nfkd` (the
/// TextNormalization package tests that one against the same table).
private let nfkd: CompatibilityDecomposition = { $0.decomposedStringWithCompatibilityMapping }

/// Swift's `==` on strings is canonical equivalence; golden parity is code
/// point for code point.
private func scalars(_ s: String) -> [UInt32] { s.unicodeScalars.map(\.value) }

private func scalars(_ list: [String]) -> [[UInt32]] { list.map(scalars) }

@Test func goldenIsTheMemorizeFixture() throws {
    let file = try golden.get()
    #expect(file.fixture == "memorize")
    #expect(file.version == 2)
    #expect(file.settings.schema_version == 1)
    // The fixture was built with the served defaults, which must be ours.
    #expect(file.settings.memorize.swift == .defaults)
    #expect(file.runs.count == file.passages.count * 3 * 4)
}

@Test(arguments: try passages())
private func passageSplitsLikeTheWeb(_ passage: MemorizeGolden.Passage) throws {
    let sentences = Memorize.sentences(passage.body)
    #expect(scalars(sentences) == scalars(passage.sentences.map(\.text)))
    for (index, expected) in passage.sentences.enumerated() where index < sentences.count {
        let words = Memorize.words(sentences[index])
        #expect(scalars(words) == scalars(expected.words), "sentence \(index)")
        let segments: [(type: String, value: [UInt32], wordIndex: Int?)] = Memorize.segments(sentences[index])
            .map { segment in
                switch segment {
                case .word(let value, let wordIndex): ("word", scalars(value), wordIndex)
                case .separator(let value): ("separator", scalars(value), nil)
                }
            }
        #expect(segments.map(\.type) == expected.segments.map(\.type), "sentence \(index)")
        #expect(segments.map(\.value) == expected.segments.map { scalars($0.value) }, "sentence \(index)")
        #expect(segments.map(\.wordIndex) == expected.segments.map(\.wordIndex), "sentence \(index)")
        #expect(Memorize.hiddenWordIndexes(words, sentenceIndex: index) == expected.hidden, "sentence \(index)")
        #expect(scalars(words.map { Memorize.firstLetter($0, decompose: nfkd) }) == scalars(expected.firstLetters))
    }
    #expect(scalars(Memorize.unsupportedWords(passage.body, decompose: nfkd)) == scalars(passage.unsupported))
}

@Test(arguments: try runs())
private func practiceTilesMatchGolden(_ run: MemorizeGolden.Run) throws {
    let body = try golden.get().passage(run.passage).body
    let difficulty = try #require(MemorizeDifficulty(rawValue: run.difficulty))
    var rng = SeededRandom(seed: try #require(UInt64(run.seed)))
    let tiles = Memorize.sentences(body).enumerated().map { index, sentence in
        let words = Memorize.words(sentence)
        let hidden = Memorize.hiddenWordIndexes(words, sentenceIndex: index)
        return Memorize.practiceTiles(difficulty, words: words, hidden: hidden, rng: &rng).map(\.id)
    }
    #expect(tiles == run.tiles)
}

/// The practice session draws the same banks as the bare rule, sentence by
/// sentence, from its one generator.
@Test(arguments: try runs())
private func practiceSessionDrawsLikeGolden(_ run: MemorizeGolden.Run) throws {
    let body = try golden.get().passage(run.passage).body
    let difficulty = try #require(MemorizeDifficulty(rawValue: run.difficulty))
    var practice = MemorizePractice(
        body: body, difficulty: difficulty, rng: SeededRandom(seed: try #require(UInt64(run.seed))), decompose: nfkd)
    guard !run.tiles.isEmpty else {
        #expect(practice.sentences.isEmpty)
        return
    }
    var drawn: [[Int]] = []
    while true {
        drawn.append(practice.tiles.map(\.id))
        solve(&practice)
        #expect(practice.sentenceDone)
        if !practice.advance() { break }
    }
    #expect(practice.isComplete)
    #expect(drawn == run.tiles)
}

/// Plays the current sentence perfectly.
private func solve<R: RandomSource>(_ practice: inout MemorizePractice<R>) {
    switch practice.difficulty {
    case .easy:
        for index in practice.hidden {
            let word = practice.words[index]
            let tile = practice.tiles.first { !practice.usedTiles.contains($0.id) && $0.word == word }!
            #expect(practice.pickEasy(tile) == .correct)
        }
    case .medium:
        var used: Set<Int> = []
        for (index, word) in practice.words.enumerated() {
            let tile = practice.tiles.first { !used.contains($0.id) && $0.word == word }!
            used.insert(tile.id)
            #expect(practice.pickMedium(tile) == (index == practice.words.count - 1 ? .correct : .placed))
        }
    case .hard:
        for word in practice.words {
            let key = Memorize.firstLetter(word, decompose: nfkd).uppercased()
            #expect(practice.pressLetter(key) == .correct)
        }
    }
}

@Test func normalizeTableMatchesGoldenWithFoundationNFKD() throws {
    for row in try golden.get().normalize {
        #expect(scalars(Memorize.normalizeWord(row.input, decompose: nfkd)) == scalars(row.normalized), "\(row.input)")
        #expect(scalars(Memorize.firstLetter(row.input, decompose: nfkd)) == scalars(row.firstLetter), "\(row.input)")
    }
}

@Test func tunedSettingsHideLikeGolden() throws {
    let file = try golden.get()
    let settings = file.tuned.settings.swift
    #expect(settings == MemorizeSettings(easyHideEvery: 3, easyHideOffset: 0))
    for entry in file.tuned.hidden {
        let body = try file.passage(entry.passage).body
        let hidden = Memorize.sentences(body).enumerated().map { index, sentence in
            Memorize.hiddenWordIndexes(Memorize.words(sentence), sentenceIndex: index, settings: settings)
        }
        #expect(hidden == entry.hidden, "\(entry.passage)")
    }
}

// MARK: - Beyond the golden file

@Test func servedSettingsAreRepairedLikeTheWeb() {
    // memorizeSettingsFromServer: bad values fall back; an unreachable offset
    // is replaced by the default offset modulo the period.
    #expect(MemorizeSettings(servedEasyHideEvery: nil, easyHideOffset: nil) == .defaults)
    #expect(MemorizeSettings(servedEasyHideEvery: 0, easyHideOffset: -1) == .defaults)
    #expect(MemorizeSettings(servedEasyHideEvery: 2, easyHideOffset: 5)
        == MemorizeSettings(easyHideEvery: 2, easyHideOffset: 1))
    #expect(MemorizeSettings(servedEasyHideEvery: 1, easyHideOffset: 3)
        == MemorizeSettings(easyHideEvery: 1, easyHideOffset: 0))
}

@Test func lowerCasingFollowsJavaScriptFinalSigma() {
    // "ΟΔΟΣ".toLowerCase() === "οδος" with a final ς; a lone Σ stays σ.
    #expect(scalars(Memorize.jsLowercased("ΟΔΟΣ")) == scalars("οδος"))
    #expect(scalars(Memorize.jsLowercased("ΣΑ")) == scalars("σα"))
    #expect(scalars(Memorize.jsLowercased("Σ")) == scalars("σ"))
    #expect(scalars(Memorize.jsLowercased("İ")) == [0x69, 0x307])
}

@Test func easyRejectsAWordForAnotherBlank() {
    // Sentence 0 hides every word i with i % 4 == 1: "two" and "six".
    var practice = MemorizePractice(
        body: "One two three four five six.", difficulty: .easy, rng: SeededRandom(seed: 0), decompose: nfkd)
    #expect(practice.hidden == [1, 5])
    let six = practice.tiles.first { $0.word == "six" }!
    #expect(practice.pickEasy(six) == .wrongBlank)
    let two = practice.tiles.first { $0.word == "two" }!
    #expect(practice.pickEasy(two) == .correct)
    #expect(practice.pickEasy(two) == .none)
    #expect(practice.pickEasy(six) == .correct)
    #expect(practice.isComplete)
    let advanced = practice.advance()
    #expect(!advanced)
}

@Test func mediumChecksOrderOnceFullAndCanUndo() {
    var practice = MemorizePractice(
        body: "Be still. Know that.", difficulty: .medium, rng: SeededRandom(seed: 1), decompose: nfkd)
    let be = practice.tiles.first { $0.word == "Be" }!
    let still = practice.tiles.first { $0.word == "still" }!
    #expect(practice.pickMedium(still) == .placed)
    #expect(practice.pickMedium(be) == .wrongOrder)
    #expect(practice.chosenWords == ["still", "Be"])
    practice.undoMedium()
    practice.undoMedium()
    #expect(practice.chosen.isEmpty)
    #expect(practice.pickMedium(be) == .placed)
    #expect(practice.pickMedium(still) == .correct)
    let advanced = practice.advance()
    #expect(advanced)
    #expect(practice.sentenceIndex == 1)
    #expect(practice.chosen.isEmpty && !practice.sentenceDone)
}

@Test func hardMatchesTheNormalizedFirstLetter() {
    var practice = MemorizePractice(
        body: "Émile ate ﬁne crème.", difficulty: .hard, rng: SeededRandom(seed: 0), decompose: nfkd)
    #expect(practice.tiles.isEmpty)
    #expect(practice.pressLetter("A") == .wrongLetter)
    #expect(practice.pressLetter("E") == .correct)
    #expect(practice.pressLetter("a") == .correct)
    #expect(practice.pressLetter("F") == .correct)
    #expect(practice.pressLetter("C") == .correct)
    #expect(practice.isComplete)
    #expect(practice.pressLetter("X") == .none)
}

@Test func difficultiesEarnTheServersMasteryLevels() {
    #expect(MemorizeDifficulty.allCases.map(\.masteryLevel) == [1, 2, 3])
    #expect(Memorize.keys.count == 36)
}
