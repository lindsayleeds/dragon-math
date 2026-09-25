import Foundation
import GameRules
import Testing

/// The `missingSoundKeys` section of golden/phonics.json
/// (src/rules/phonicsGolden.js): which element each Missing Sound word — and
/// each tile tapped in its blank — records against.
private struct MissingSoundGolden: Decodable {
    struct KeyCase: Decodable, CustomTestStringConvertible {
        let level: String
        let graphemes: [String]
        let blank: Int
        let elementKey: String?
        /// Tile → the key it records as; JSON null = no element.
        let chosen: [String: String?]

        var entry: PhonicsWordEntry { PhonicsWordEntry(graphemes: graphemes, blank: blank) }
        var testDescription: String { "\(level) \(graphemes.joined(separator: "·")) blank \(blank)" }
    }

    let missingSoundKeys: [KeyCase]

    static let loaded: MissingSoundGolden = {
        // swiftlint:disable:next force_try
        try! JSONDecoder().decode(MissingSoundGolden.self, from: RepoPaths.goldenData("phonics"))
    }()
}

@Suite struct MissingSoundTests {
    @Test func everyWordOfEveryLevelIsPinned() {
        let cases = MissingSoundGolden.loaded.missingSoundKeys
        #expect(cases.map(\.entry) == PhonicsLevel.all.flatMap(\.words))
        #expect(cases.map(\.level) == PhonicsLevel.all.flatMap { level in level.words.map { _ in level.key } })
    }

    @Test(arguments: MissingSoundGolden.loaded.missingSoundKeys)
    fileprivate func curriculumKeysMatchTheJavaScript(_ golden: MissingSoundGolden.KeyCase) {
        #expect(PhonicsWords.curriculumKey(for: golden.entry) == golden.elementKey)
        let pool = PhonicsWords.pool(for: golden.entry.answer)
        #expect(Set(golden.chosen.keys) == Set(pool))
        for option in pool {
            #expect(PhonicsWords.curriculumKey(for: golden.entry, option: option) == golden.chosen[option] ?? nil)
        }
    }

    @Test func positionPicksTheEndingElement() {
        let nest = PhonicsWordEntry(graphemes: ["ne", "st"], blank: 1)
        #expect(PhonicsWords.curriculumKey(for: nest) == "end-st")
        let stem = PhonicsWordEntry(graphemes: ["st", "em"], blank: 0)
        #expect(PhonicsWords.curriculumKey(for: stem) == "st")
        #expect(PhonicsWords.curriculumKey(for: PhonicsWordEntry(graphemes: ["c", "a", "t"], blank: 1)) == "short-a")
    }

    @Test func attemptsRecordTheMissingSoundMode() throws {
        let cat = PhonicsWordEntry(graphemes: ["c", "a", "t"], blank: 1)
        let right = try #require(PhonicsWords.attempt(for: cat, option: "a"))
        #expect(right == PhonicsAttemptRecord(
            elementKey: "short-a", mode: "missing-sound", correct: true, chosen: nil, responseMs: nil))
        let wrong = try #require(PhonicsWords.attempt(for: cat, option: "o"))
        #expect(wrong == PhonicsAttemptRecord(
            elementKey: "short-a", mode: "missing-sound", correct: false, chosen: "short-o", responseMs: nil))
    }

    @Test func aBlankOutsideTheCurriculumRecordsNothing() {
        let bell = PhonicsWordEntry(graphemes: ["b", "e", "ll"], blank: 2)
        #expect(PhonicsWords.curriculumKey(for: bell) == nil)
        #expect(PhonicsWords.attempt(for: bell, option: "ll") == nil)
    }

    @Test func everyTileHasAnExampleWord() {
        let graphemes = PhonicsWords.vowels + PhonicsWords.consonants + PhonicsWords.blends
            + PhonicsLevel.all.flatMap { $0.words.map(\.answer) }
        #expect(graphemes.filter { PhonicsWords.cueWord(for: $0).isEmpty } == [])
        #expect(PhonicsWords.cueWord(for: "sh") == "ship")
        #expect(PhonicsWords.cueWord(for: "qq") == "")
    }
}
