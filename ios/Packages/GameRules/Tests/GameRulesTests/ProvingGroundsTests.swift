import Foundation
import GameRules
import Testing

/// golden/proving-grounds.json, written by `npm run golden:generate` from
/// src/rules/provingGrounds.js. Settings decode with the rule's own
/// `ProvingGroundsSettings` — the type the app decodes GET /api/rule-settings with.
private struct ProvingGolden: Decodable {
    struct Document: Decodable {
        let schemaVersion: Int
        let provingGrounds: ProvingGroundsSettings

        enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case provingGrounds = "proving_grounds"
        }
    }

    struct Fact: Decodable {
        let a: Int
        let b: Int
        let op: ProvingMode
        let answer: Int
        let prompt: String

        var swift: ProvingFact { ProvingFact(a: a, b: b, op: op, answer: answer, prompt: prompt) }
    }

    struct ProblemSet: Decodable, CustomTestStringConvertible {
        let seed: String
        let mode: ProvingMode
        let digit: Int
        let problems: [Fact]
        var testDescription: String { "\(mode.rawValue) \(digit) seed \(seed)" }
    }

    struct MedalCase: Decodable {
        let elapsedSec: Double
        let wrongCount: Int
        let medal: Medal?
    }

    struct Tuned: Decodable {
        let settings: ProvingGroundsSettings
        let medals: [MedalCase]
    }

    struct Elapsed: Decodable {
        let startMs: Double
        let nowMs: Double
        let elapsedSec: Double
    }

    let fixture: String
    let settings: Document
    let problemSets: [ProblemSet]
    let medals: [MedalCase]
    let tunedMedals: Tuned
    let elapsed: [Elapsed]

    static func load() throws -> ProvingGolden {
        try JSONDecoder().decode(ProvingGolden.self, from: RepoPaths.goldenData("proving-grounds"))
    }
}

@Test func goldenIsTheProvingGroundsFixture() throws {
    let golden = try ProvingGolden.load()
    #expect(golden.fixture == "proving-grounds")
    #expect(!golden.problemSets.isEmpty && !golden.medals.isEmpty && !golden.elapsed.isEmpty)
    // The served defaults are what the app plays before settings load.
    #expect(golden.settings.provingGrounds == .defaults)
    #expect(golden.tunedMedals.settings != .defaults)
}

@Test(arguments: try ProvingGolden.load().problemSets)
private func problemSetMatchesGolden(_ set: ProvingGolden.ProblemSet) throws {
    var rng = SeededRandom(seed: try #require(UInt64(set.seed)))
    let problems = provingProblemSet(mode: set.mode, digit: set.digit, rng: &rng)
    #expect(problems == set.problems.map(\.swift))
    #expect(problems.count == provingProblemCount)
}

@Test func medalsMatchGolden() throws {
    let golden = try ProvingGolden.load()
    for c in golden.medals {
        let medal = provingMedal(elapsedSec: c.elapsedSec, wrongCount: c.wrongCount, settings: golden.settings.provingGrounds)
        #expect(medal == c.medal, "\(c.elapsedSec)s \(c.wrongCount) wrong")
    }
    for c in golden.tunedMedals.medals {
        let medal = provingMedal(elapsedSec: c.elapsedSec, wrongCount: c.wrongCount, settings: golden.tunedMedals.settings)
        #expect(medal == c.medal, "tuned \(c.elapsedSec)s \(c.wrongCount) wrong")
    }
}

@Test func elapsedMatchesGolden() throws {
    for c in try ProvingGolden.load().elapsed {
        #expect(provingElapsedSeconds(startMs: c.startMs, nowMs: c.nowMs) == c.elapsedSec)
    }
}

@Test func setsNeverRepeatAFactBackToBack() {
    for mode in ProvingMode.allCases {
        for digit in provingDigits {
            for seed in UInt64(0)..<50 {
                var rng = SeededRandom(seed: seed)
                let problems = provingProblemSet(mode: mode, digit: digit, rng: &rng)
                #expect(zip(problems, problems.dropFirst()).allSatisfy { $0.prompt != $1.prompt })
                #expect(Dictionary(grouping: problems, by: \.prompt).values.allSatisfy { $0.count == 2 })
            }
        }
    }
}

@Test func medalsRankBronzeSilverGold() {
    #expect(Medal.bronze < .silver && Medal.silver < .gold)
    #expect([Medal.silver, .gold, .bronze].max() == .gold)
}

// MARK: - The run (ProvingGroundsPage.jsx's rules)

private func drill(settings: ProvingGroundsSettings = .defaults) -> ProvingDrill {
    var rng = SeededRandom(seed: 7)
    return ProvingDrill(mode: .mul, digit: 3, settings: settings, now: 1000, rng: &rng)
}

@Test func aPerfectQuickRunIsGold() throws {
    var d = drill()
    var now = 1000.0
    for _ in 0..<provingProblemCount {
        now += 1500
        #expect(d.answer(try #require(d.current).answer, now: now) == .correct)
    }
    let result = try #require(d.result)
    #expect(result == ProvingResult(elapsedSec: 36, wrongCount: 0, medal: .gold))
    #expect(d.current == nil)
    #expect(d.answered.count == provingProblemCount && d.answered.allSatisfy(\.correct))
}

@Test func aMissHoldsTheCorrectionForTwoSecondsThenMovesOn() throws {
    var d = drill()
    let first = try #require(d.current)
    #expect(d.answer(first.answer + 1, now: 2000) == .wrong)
    #expect(d.phase == .correcting(fact: first, until: 4000))
    #expect(d.nextTimerAt == 4000)
    // Input is frozen while the correction shows.
    #expect(d.answer(first.answer, now: 3000) == .ignored)
    d.tick(now: 3999)
    #expect(d.index == 0)
    d.tick(now: 4000)
    #expect(d.phase == .asking && d.index == 1 && d.wrongCount == 1)
    #expect(d.nextTimerAt == nil)
}

@Test func theSecondMissEndsTheRunAfterItsCorrection() throws {
    var d = drill()
    d.answer(try #require(d.current).answer + 1, now: 2000)
    d.tick(now: 4000)
    d.answer(try #require(d.current).answer, now: 5000)
    d.answer(try #require(d.current).answer + 1, now: 6000)
    #expect(d.result == nil)
    d.tick(now: 8000)
    // The clock ran through the correction: 1000 → 8000.
    #expect(d.result == ProvingResult(elapsedSec: 7, wrongCount: 2, medal: nil))
}

@Test func oneSlipCanStillEarnBronze() throws {
    var d = drill()
    var now = 1000.0
    d.answer(try #require(d.current).answer + 1, now: now)
    now += provingCorrectionMs
    d.tick(now: now)
    while let fact = d.current {
        now += 2000
        d.answer(fact.answer, now: now)
    }
    #expect(d.result?.medal == .bronze)
    #expect(d.result?.wrongCount == 1)
}

@Test func theRunEndsAtTheSettingsWrongLimit() throws {
    let lenient = ProvingGroundsSettings(medalSeconds: MedalSeconds(gold: 45, silver: 60, bronze: 90), maxWrongForBronze: 2)
    var d = drill(settings: lenient)
    var now = 1000.0
    for _ in 0..<2 {
        d.answer(try #require(d.current).answer + 1, now: now)
        now += provingCorrectionMs
        d.tick(now: now)
    }
    #expect(d.result == nil && d.index == 2)
    d.answer(try #require(d.current).answer + 1, now: now)
    d.tick(now: now + provingCorrectionMs)
    #expect(d.result?.wrongCount == 3)
}

@Test func aMissOnTheLastProblemFinishesAfterItsCorrection() throws {
    var d = drill()
    var now = 1000.0
    while d.index < provingProblemCount - 1 {
        now += 1000
        d.answer(try #require(d.current).answer, now: now)
    }
    d.answer(try #require(d.current).answer + 1, now: now + 1000)
    #expect(d.result == nil)
    d.tick(now: now + 1000 + provingCorrectionMs)
    #expect(d.result == ProvingResult(elapsedSec: 26, wrongCount: 1, medal: .bronze))
}
