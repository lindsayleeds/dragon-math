import Foundation
import GameRules
import Testing

/// golden/egg-hatchery.json, written by `npm run golden:generate` from
/// src/rules/eggHatchery.js. Settings decode with the rule's own
/// `EggHatcherySettings` — the type the app decodes GET /api/rule-settings with.
private struct EggGolden: Decodable {
    struct Document: Decodable {
        let schemaVersion: Int
        let eggHatchery: EggHatcherySettings

        enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case eggHatchery = "egg_hatchery"
        }
    }

    struct Problem: Decodable {
        let id: Int
        let multiplier: Int
        let operand1: Int
        let operand2: Int
        let correctAnswer: Int
        let isHatched: Bool

        var swift: HatcheryProblem {
            HatcheryProblem(id: id, multiplier: multiplier, operand1: operand1, operand2: operand2, correctAnswer: correctAnswer)
        }
    }

    struct Hatch: Decodable {
        let id: Int
        let choices: [Int]
        let hintDelayMs: Double
        let dragonId: Int
    }

    struct Round: Decodable, CustomTestStringConvertible {
        let operation: BattleOp
        let baseNumber: Int
        let pool: [Int]?
        let seed: String
        let problems: [Problem]
        let hatches: [Hatch]
        var testDescription: String { "\(operation.rawValue) \(baseNumber) pool \(pool == nil ? "none" : "set") seed \(seed)" }
    }

    struct Buttons: Decodable, CustomTestStringConvertible {
        let correctAnswer: Int
        let seed: String
        let buttons: [Int]
        var testDescription: String { "\(correctAnswer) seed \(seed)" }
    }

    struct Hint: Decodable, CustomTestStringConvertible {
        let operation: BattleOp
        let baseNumber: Int
        let multiplier: Int
        let hintLevel: Int
        let seed: String
        let text: String?
        var testDescription: String { "\(operation.rawValue) \(baseNumber)×\(multiplier) level \(hintLevel) seed \(seed)" }
    }

    struct Tier: Decodable {
        let elapsedSeconds: Double
        let tier: HatcheryTier
        let timeDisplay: String?
    }

    struct Tuned: Decodable {
        let settings: EggHatcherySettings
        let seed: String
        let hintDelaysMs: [Double]
        let tiers: [Tier]
    }

    let fixture: String
    let settings: Document
    let fallbackDragonCount: Int
    let rounds: [Round]
    let buttons: [Buttons]
    let hints: [Hint]
    let tiers: [Tier]
    let tuned: Tuned

    static func load() throws -> EggGolden {
        try JSONDecoder().decode(EggGolden.self, from: RepoPaths.goldenData("egg-hatchery"))
    }
}

private func seeded(_ seed: String) throws -> SeededRandom {
    SeededRandom(seed: try #require(UInt64(seed)))
}

@Test func goldenIsTheEggHatcheryFixture() throws {
    let golden = try EggGolden.load()
    #expect(golden.fixture == "egg-hatchery")
    #expect(!golden.rounds.isEmpty && !golden.buttons.isEmpty && !golden.hints.isEmpty && !golden.tiers.isEmpty)
    // The served defaults are what the app plays before settings load.
    #expect(golden.settings.eggHatchery == .defaults)
    #expect(golden.tuned.settings != .defaults)
    #expect(golden.fallbackDragonCount == hatcheryFallbackDragonCount)
}

/// The pure functions, called in the round's draw order on one generator.
@Test(arguments: try EggGolden.load().rounds)
private func roundMatchesGolden(_ round: EggGolden.Round) throws {
    let settings = try EggGolden.load().settings.eggHatchery
    var rng = try seeded(round.seed)
    let problems = hatcheryProblems(round.operation, base: round.baseNumber, rng: &rng)
    #expect(problems == round.problems.map(\.swift))
    #expect(round.problems.allSatisfy { !$0.isHatched })
    for (problem, hatch) in zip(problems, round.hatches) {
        #expect(problem.id == hatch.id)
        #expect(hatcheryAnswerChoices(correct: problem.correctAnswer, rng: &rng) == hatch.choices)
        #expect(hatcheryHintOfferDelayMs(rng: &rng, settings: settings) == hatch.hintDelayMs)
        #expect(hatcheryPickDragonID(pool: round.pool, rng: &rng) == hatch.dragonId)
    }
}

/// `HatcheryRound` played straight through draws exactly what the golden round
/// does: its buttons, hint timers and dragons match.
@Test(arguments: try EggGolden.load().rounds)
private func aPlayedRoundDrawsLikeTheGolden(_ round: EggGolden.Round) throws {
    var rng = try seeded(round.seed)
    var now = 1_000.0
    var play = HatcheryRound(
        operation: round.operation, baseNumber: round.baseNumber, pool: round.pool, now: now, rng: &rng)
    #expect(play.problems == round.problems.map(\.swift))
    for hatch in round.hatches {
        let problem = try #require(play.current)
        #expect(problem.id == hatch.id)
        #expect(play.choices == hatch.choices)
        #expect(play.hintOfferAt == now + hatch.hintDelayMs)
        now += 1_000
        let button = try #require(play.choices.firstIndex(of: problem.correctAnswer))
        #expect(play.answer(button, now: now) == .correct)
        now += hatcheryHatchMs
        play.tick(now: now, rng: &rng)
        #expect(play.dragons.last == HatchedDragon(problemID: hatch.id, dragonID: hatch.dragonId))
    }
    #expect(play.current == nil)
    play.tick(now: now + hatcheryFinishMs, rng: &rng)
    // 12 × (1 s thinking + 0.8 s hatching) + the 0.3 s beat.
    #expect(play.result == HatcheryResult(elapsedSeconds: 21.9, tier: .gold))
    #expect(play.attempts.map(\.problem) == play.problems)
    #expect(play.attempts.allSatisfy { $0.timeMs == 1_000 && $0.wrongTaps == 0 })
}

@Test(arguments: try EggGolden.load().buttons)
private func answerButtonsMatchGolden(_ c: EggGolden.Buttons) throws {
    var rng = try seeded(c.seed)
    #expect(hatcheryAnswerButtons(correct: c.correctAnswer, rng: &rng) == c.buttons)
}

@Test(arguments: try EggGolden.load().hints)
private func hintTextMatchesGolden(_ c: EggGolden.Hint) throws {
    var rng = try seeded(c.seed)
    let text = hatcheryHintText(c.operation, base: c.baseNumber, multiplier: c.multiplier, hintLevel: c.hintLevel, rng: &rng)
    #expect(text == c.text)
}

@Test func tiersMatchGolden() throws {
    let golden = try EggGolden.load()
    for c in golden.tiers {
        #expect(hatcheryTier(elapsedSeconds: c.elapsedSeconds, settings: golden.settings.eggHatchery) == c.tier, "\(c.elapsedSeconds)s")
        #expect(hatcheryFormatTime(c.elapsedSeconds) == c.timeDisplay, "\(c.elapsedSeconds)s")
    }
    for c in golden.tuned.tiers {
        #expect(hatcheryTier(elapsedSeconds: c.elapsedSeconds, settings: golden.tuned.settings) == c.tier, "tuned \(c.elapsedSeconds)s")
    }
}

@Test func tunedHintDelaysMatchGolden() throws {
    let tuned = try EggGolden.load().tuned
    var rng = try seeded(tuned.seed)
    let delays = tuned.hintDelaysMs.map { _ in hatcheryHintOfferDelayMs(rng: &rng, settings: tuned.settings) }
    #expect(delays == tuned.hintDelaysMs)
}

@Test func settingsFallBackWhereTheWebConverterDoes() {
    var s = EggHatcherySettings.defaults
    s.hintDelayMinMs = -1
    s.tierSeconds.gold = -5
    s.hintDelaySpreadMs = 0
    let v = s.validated()
    #expect(v.hintDelayMinMs == 5000 && v.tierSeconds.gold == 25 && v.hintDelaySpreadMs == 0)
}

// MARK: - The round (DragonEggHatchery.jsx's timers)

private func freshRound(_ op: BattleOp = .mul, base: Int = 3, seed: UInt64 = 7) -> (HatcheryRound, SeededRandom) {
    var rng = SeededRandom(seed: seed)
    let round = HatcheryRound(operation: op, baseNumber: base, pool: [9], now: 0, rng: &rng)
    return (round, rng)
}

@Test func aWrongTapMarksTheButtonForHalfASecondAndCancelsTheHintOffer() throws {
    var (round, rng) = freshRound()
    let problem = try #require(round.current)
    let wrong = try #require(round.choices.firstIndex { $0 != problem.correctAnswer })
    #expect(round.answer(wrong, now: 100) == .wrong)
    #expect(round.phase == .asking(wrongButton: wrong, until: 100 + hatcheryWrongMs))
    #expect(round.hintOfferAt == nil)
    #expect(round.nextTimerAt == 100 + hatcheryWrongMs)
    round.tick(now: 10_000, rng: &rng)
    #expect(round.phase == .asking(wrongButton: nil, until: nil))
    // The offer was cancelled by the tap, as on the web.
    #expect(!round.hintOffered)
    #expect(round.nextTimerAt == nil)

    let right = try #require(round.choices.firstIndex(of: problem.correctAnswer))
    #expect(round.answer(right, now: 10_500) == .correct)
    #expect(round.attempts == [HatcheryAttempt(problem: problem, timeMs: 10_500, wrongTaps: 1)])
    // Taps while the egg cracks do nothing.
    #expect(round.answer(right, now: 10_600) == .ignored)
}

@Test func theHintIsOfferedAfterTheDelayAndOnlyMultiplicationHasOne() throws {
    var (round, rng) = freshRound()
    let at = try #require(round.hintOfferAt)
    #expect((5_000..<7_000).contains(at))
    round.tick(now: at - 1, rng: &rng)
    #expect(!round.hintOffered)
    round.tick(now: at, rng: &rng)
    #expect(round.hintOffered)
    round.toggleHint(rng: &rng)
    #expect(round.hintShown)
    #expect(round.hintText?.hasPrefix("Skip-count: 3, 6") == true)
    round.toggleHint(rng: &rng)
    #expect(!round.hintShown && round.hintText == nil)

    var (sums, sumsRNG) = freshRound(.add)
    sums.toggleHint(rng: &sumsRNG)
    #expect(sums.hintShown && sums.hintText == nil)
}

@Test func aSlowRoundIsBronzeAndHatchesFromThePool() throws {
    var (round, rng) = freshRound(.sub, base: 5)
    var now = 0.0
    while let problem = round.current {
        now += 4_000
        round.tick(now: now, rng: &rng)
        #expect(round.answer(try #require(round.choices.firstIndex(of: problem.correctAnswer)), now: now) == .correct)
        now += hatcheryHatchMs
        round.tick(now: now, rng: &rng)
    }
    #expect(round.result == nil)
    round.tick(now: now + hatcheryFinishMs, rng: &rng)
    #expect(round.result?.tier == .bronze)
    #expect(round.dragons.count == hatcherySize)
    #expect(round.dragons.allSatisfy { $0.dragonID == 9 })
    #expect(round.nextTimerAt == nil)
}

@Test func subtractionNeverGoesNegativeAndDivisionIsWhole() {
    for base in 1...12 {
        for i in 1...12 {
            let sub = hatcheryProblem(base: base, multiplier: i, op: .sub)
            #expect(sub.operand1 - sub.operand2 == sub.correctAnswer && sub.correctAnswer >= 0)
            let div = hatcheryProblem(base: base, multiplier: i, op: .div)
            #expect(div.operand1 == div.operand2 * div.correctAnswer)
        }
    }
}
