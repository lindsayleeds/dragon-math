import Foundation
import GameRules
import Testing

/// golden/phonics.json, written by `npm run golden:generate` from
/// src/rules/phonicsGolden.js. The `mastery` section is the server's rule and
/// is ported with it (#164); rounds and Missing Sound words are here.
private struct PhonicsGolden: Decodable {
    struct Item: Decodable {
        let element: String
        let word: String?
        let options: [String]?
    }

    struct Round: Decodable, CustomTestStringConvertible {
        let seed: String
        let mode: PhonicsRoundMode
        let stages: Stages
        let count: Int?
        let mastery: [String: PhonicsMasteryState]?
        let only: [String]?
        let items: [Item]

        var testDescription: String {
            "\(mode.rawValue) \(stages) seed \(seed)\(mastery == nil ? "" : " weighted")\(only.map { " only \($0)" } ?? "")"
                + (count.map { " count \($0)" } ?? "")
        }
    }

    /// A number, an array of numbers, or "all".
    struct Stages: Decodable, CustomStringConvertible {
        let value: PhonicsStages
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let one = try? c.decode(Int.self) {
                value = .stage(one)
            } else if let many = try? c.decode([Int].self) {
                value = .stages(many)
            } else {
                let all = try c.decode(String.self)
                guard all == "all" else { throw DecodingError.dataCorruptedError(in: c, debugDescription: all) }
                value = .all
            }
        }
        var description: String { "\(value)" }
    }

    struct WordItem: Decodable {
        let graphemes: [String]
        let blank: Int
        let options: [String]
    }

    struct Words: Decodable, CustomTestStringConvertible {
        let seed: String
        let level: String
        let optionCount: Int
        let items: [WordItem]
        var testDescription: String { "\(level) seed \(seed)" }
    }

    let fixture: String
    let version: Int
    let rounds: [Round]
    let words: [Words]

    static let loaded: PhonicsGolden = {
        // swiftlint:disable:next force_try
        try! JSONDecoder().decode(PhonicsGolden.self, from: RepoPaths.goldenData("phonics"))
    }()
}

@Suite struct PhonicsGoldenTests {
    @Test func fixtureIsTheOneThisPortReads() {
        #expect(PhonicsGolden.loaded.fixture == "phonics")
        #expect(PhonicsGolden.loaded.version == 1)
        #expect(PhonicsGolden.loaded.rounds.count > 60)
    }

    @Test(arguments: PhonicsGolden.loaded.rounds)
    fileprivate func roundsMatchTheJavaScript(_ round: PhonicsGolden.Round) {
        var rng = SeededRandom(seed: UInt64(round.seed)!)
        let items = Phonics.buildRound(
            mode: round.mode, stages: round.stages.value, count: round.count ?? Phonics.questionsPerRound,
            mastery: round.mastery, only: round.only, rng: &rng)
        #expect(items.map(\.element.key) == round.items.map(\.element))
        #expect(items.map(\.word) == round.items.map(\.word))
        #expect(items.map { $0.options?.map(\.key) } == round.items.map(\.options))
    }

    @Test(arguments: PhonicsGolden.loaded.words)
    fileprivate func missingSoundWordsMatchTheJavaScript(_ words: PhonicsGolden.Words) {
        var rng = SeededRandom(seed: UInt64(words.seed)!)
        let picked = PhonicsWords.pickWords(level: words.level, rng: &rng)
        let options = picked.map { PhonicsWords.buildOptions($0, count: words.optionCount, rng: &rng) }
        #expect(picked.map(\.graphemes) == words.items.map(\.graphemes))
        #expect(picked.map(\.blank) == words.items.map(\.blank))
        #expect(options == words.items.map(\.options))
    }
}

@Suite struct PhonicsRuleTests {
    private func el(_ key: String) -> PhonicsElement { Phonics.elementByKey[key]! }

    @Test func theCurriculumHasEveryStageAndMode() {
        #expect(PhonicsElement.all.count == 102)
        #expect(Set(PhonicsElement.all.map(\.key)).count == 102)
        #expect(PhonicsStage.all.map(\.stage) == Array(1...8))
        #expect(PhonicsStage.all.allSatisfy { !$0.elements.isEmpty })
        #expect(PhonicsMode.all.prefix(2).map(\.key) == ["choose", "type-it"])
        #expect(Phonics.roundModes == PhonicsRoundMode.allCases.map(\.rawValue))
    }

    @Test func anyAcceptedSpellingCountsAsTypingTheSound() {
        #expect(Phonics.isAcceptedSpelling(el("long-a"), typed: " A_e "))
        #expect(Phonics.isAcceptedSpelling(el("long-a"), typed: "ae"))
        #expect(Phonics.isAcceptedSpelling(el("c"), typed: "K"))
        #expect(!Phonics.isAcceptedSpelling(el("sh"), typed: "ch"))
        #expect(!Phonics.isAcceptedSpelling(el("sh"), typed: " _ "))
    }

    @Test func anAttemptNamesTheConfusionOnlyWhenWrong() {
        let right = Phonics.attempt(element: el("sh"), mode: "type-it", correct: true, typed: "sh", responseMs: 900)
        #expect(right == PhonicsAttemptRecord(elementKey: "sh", mode: "type-it", correct: true, chosen: nil, responseMs: 900))
        // A typed spelling of another sound is recorded as that sound.
        let typed = Phonics.attempt(element: el("sh"), mode: "type-it", correct: false, typed: "CH")
        #expect(typed.chosen == "ch")
        #expect(Phonics.attempt(element: el("sh"), mode: "type-it", correct: false, typed: "zzz").chosen == nil)
        let tapped = Phonics.attempt(element: el("b"), mode: "choose", correct: false, chosenElement: el("d"))
        #expect(tapped.chosen == "d")
    }

    @Test func magicEIsFoundByItsFrame() {
        #expect(Phonics.spellingAppears(el("long-a"), in: "cake"))
        #expect(!Phonics.spellingAppears(el("long-a"), in: "cat"))
        #expect(Phonics.spellingAppears(el("ck"), in: "brick"))
    }

    @Test func reviewTargetsAreTheWeakestFirst() {
        #expect(Phonics.reviewTargets(nil) == nil)
        #expect(Phonics.reviewTargets(["m": .init(level: "mastered", stale: false)]) == nil)
        let targets = Phonics.reviewTargets([
            "sh": .init(level: "learning", stale: false, accuracy: 0.5),
            "b": .init(level: "learning", stale: false, accuracy: 0.5),
            "m": .init(level: "solid", stale: true, accuracy: 0.9),
            "t": .init(level: "learning", stale: false, accuracy: nil),
        ])
        #expect(targets == ["t", "b", "sh", "m"])
    }
}
