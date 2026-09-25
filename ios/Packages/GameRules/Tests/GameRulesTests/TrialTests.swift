import Foundation
import GameRules
import Testing

/// golden/trial.json, written by `npm run golden:generate` from
/// src/rules/dragonTrial.js. Settings decode with the rule's own
/// `TrialSettings` — the type the app decodes GET /api/rule-settings with.
private struct TrialGolden: Decodable {
    struct Document: Decodable {
        let schemaVersion: Int
        let trial: TrialSettings

        enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case trial
        }
    }

    struct Answer: Decodable {
        let skip: Bool?
        let wrong: Int?
        let elapsedMs: Double?
    }

    struct Question: Decodable, Equatable {
        let index: Int
        let phase: String
        let op: BattleOp
        let a: Int
        let b: Int
        let answer: Int
        let points: Int
    }

    struct Points: Decodable {
        let add: [Int]
        let sub: [Int]
        let mul: [Int]
        let div: [Int]

        var swift: TrialPoints { TrialPoints(add: add, sub: sub, mul: mul, div: div) }
    }

    struct OpResult: Decodable {
        let score: Int
        let band: TrialBand
        let bandLabel: String
        let stars: Int
        let problemsAsked: Int
    }

    struct Outcome: Decodable {
        struct PerOp: Decodable {
            let add: OpResult
            let sub: OpResult
            let mul: OpResult
            let div: OpResult

            subscript(op: BattleOp) -> OpResult {
                switch op {
                case .add: add
                case .sub: sub
                case .mul: mul
                case .div: div
                }
            }
        }

        let perOp: PerOp
        let highestMasteredOp: BattleOp?
        let placementOp: BattleOp?
        let targetNodeId: Int
    }

    struct Run: Decodable, CustomTestStringConvertible {
        let name: String
        let seed: String
        /// Replaces the fixture's settings for this run.
        let settings: TrialSettings?
        let answers: [Answer]
        let questions: [Question]
        let sequence: [BattleOp]
        let perOpPoints: Points
        let outcome: Outcome
        var testDescription: String { name }
    }

    let fixture: String
    let settings: Document
    let runs: [Run]

    static func load() throws -> TrialGolden {
        try JSONDecoder().decode(TrialGolden.self, from: RepoPaths.goldenData("trial"))
    }
}

@Test func goldenIsTheTrialFixture() throws {
    let golden = try TrialGolden.load()
    #expect(golden.fixture == "trial")
    #expect(!golden.runs.isEmpty)
    // The served defaults are what the app plays before settings load.
    #expect(golden.settings.trial == .defaults)
    #expect(golden.runs.contains { $0.settings != nil && $0.settings != .defaults })
}

/// Each run replayed by the fixture's protocol: a fake clock from 0, wrong taps
/// at the unchanged clock, the correct tap after `elapsedMs`, then 400 ms and
/// nextProblem, until the trial completes.
@Test(arguments: try TrialGolden.load().runs)
private func runMatchesGolden(_ run: TrialGolden.Run) throws {
    let settings = try run.settings ?? TrialGolden.load().settings.trial
    var rng = SeededRandom(seed: try #require(UInt64(run.seed)))
    var clock: Double = 0
    var state = TrialState(settings: settings, rng: &rng)
    state.startProblemClock(now: clock)

    var questions: [TrialGolden.Question] = []
    var answers = run.answers.makeIterator()
    while state.status == .playing {
        let next = answers.next()
        let answer = try #require(next, "ran out of answers at problem \(state.index)")
        let posed = state.problem
        let before = state.perOpPoints[posed.op].count
        if answer.skip == true {
            state.skipProblem()
        } else {
            for _ in 0..<(answer.wrong ?? 0) { state.tapAnswer(isCorrect: false, now: clock) }
            if !state.resolved {
                clock += answer.elapsedMs ?? 0
                state.tapAnswer(isCorrect: true, now: clock)
            }
        }
        #expect(state.resolved)
        let points = state.perOpPoints[posed.op]
        #expect(points.count == before + 1)
        questions.append(TrialGolden.Question(
            index: state.index, phase: state.phase.rawValue, op: posed.op, a: posed.a, b: posed.b,
            answer: posed.answer, points: points.last ?? -1))
        clock += 400
        state.nextProblem(now: clock, rng: &rng)
    }
    #expect(answers.next() == nil)

    #expect(questions == run.questions)
    #expect(state.sequence == run.sequence)
    #expect(state.perOpPoints == run.perOpPoints.swift)

    let outcome = state.outcome
    #expect(outcome.targetNodeID == run.outcome.targetNodeId)
    #expect(outcome.placementOp == run.outcome.placementOp)
    #expect(outcome.highestMasteredOp == run.outcome.highestMasteredOp)
    for op in trialOps {
        let want = run.outcome.perOp[op]
        let got = outcome[op]
        #expect(got.score == want.score, "\(op) score")
        #expect(got.band == want.band, "\(op) band")
        #expect(got.band.label == want.bandLabel)
        #expect(got.stars == want.stars)
        #expect(got.problemsAsked == want.problemsAsked)
    }
}

@Test func goldenRunsReachEveryPlacementNode() throws {
    let golden = try TrialGolden.load()
    let s = TrialSettings.defaults
    let targets = Set(golden.runs.filter { $0.settings == nil }.map(\.outcome.targetNodeId))
    #expect(targets == [s.opStartNode.add, s.opStartNode.sub, s.opStartNode.mul, s.allMasteredNode])
}

@Test func speedAndPointsMatchTheDocTable() {
    // docs/TRIAL.md "Examples".
    #expect(trialPointsForCorrect(wrongTapsBefore: 0, elapsedMs: 3000) == 200)
    #expect(trialPointsForCorrect(wrongTapsBefore: 0, elapsedMs: 7000) == 180)
    #expect(trialPointsForCorrect(wrongTapsBefore: 0, elapsedMs: 11000) == 150)
    #expect(trialPointsForCorrect(wrongTapsBefore: 0, elapsedMs: 15000) == 120)
    #expect(trialPointsForCorrect(wrongTapsBefore: 1, elapsedMs: 5000) == 135)
    #expect(trialPointsForCorrect(wrongTapsBefore: 1, elapsedMs: 13000) == 90)
    // Half points round up, as Math.round: 150 × 0.75 = 112.5.
    #expect(trialPointsForCorrect(wrongTapsBefore: 1, elapsedMs: 9000) == 113)
}

@Test func growlDelayIsOneDrawWithinItsJitter() {
    var rng = SeededRandom(seed: 3)
    var copy = rng
    let delay = trialGrowlDelayMs(rng: &rng)
    _ = copy.next()
    #expect(rng == copy)
    #expect(delay >= 12000 * 0.85 && delay <= 12000 * 1.15)
}

// MARK: - TrialSession

private func answerCell<R>(_ s: TrialSession<R>) -> Int {
    s.grid.firstIndex(of: s.trial.problem.answer)!
}

private func wrongCell<R>(_ s: TrialSession<R>) -> Int {
    s.grid.indices.first { s.grid[$0] != nil && s.grid[$0] != s.trial.problem.answer }!
}

@Test func sessionDealsTheSameTrialAsTheRules() {
    var rng = SeededRandom(seed: 11)
    let rules = TrialState(rng: &rng)
    let session = TrialSession(rng: SeededRandom(seed: 11))
    #expect(session.trial == rules)
    #expect(session.grid.count == session.layout.cells.count)
    #expect(session.grid.compactMap { $0 }.filter { $0 == rules.problem.answer }.count == 1)
    #expect(!session.started && session.nextTimerAt == nil)
}

@Test func sessionScoresBlanksAndTimesTheNextProblemFromTheBlank() {
    var s = TrialSession(rng: SeededRandom(seed: 5))
    s.send(.start(now: 1000))
    #expect(s.trial.problemStartedAt == 1000)
    let growl = s.nextTimerAt!
    #expect(growl > 1000)

    // A wrong tap flashes, a second resolves the problem at 0.
    let wrong = wrongCell(s)
    #expect(s.send(.tap(now: 1500, cell: wrong)) == [.wrong(cell: wrong)])
    #expect(s.wrongCellIndex == wrong)
    s.send(.tick(now: 1850))
    #expect(s.wrongCellIndex == nil)
    let op = s.trial.problem.op
    s.send(.tap(now: 1900, cell: wrongCell(s)))
    #expect(s.trial.perOpPoints[op] == [0])
    #expect(s.blanking)
    // Input is ignored while blanking.
    let blanked = s
    s.send(.tap(now: 2000, cell: answerCell(s)))
    s.send(.skip(now: 2000))
    #expect(s.trial == blanked.trial)

    // A late tick: the next problem is timed from the end of the blank.
    s.send(.tick(now: 5000))
    #expect(!s.blanking)
    #expect(s.trial.index == 1)
    #expect(s.trial.problemStartedAt == 2300)
    #expect(s.grid.contains(s.trial.problem.answer))

    let nextOp = s.trial.problem.op
    #expect(s.send(.tap(now: 5300, cell: answerCell(s))) == [.correct])
    // 3000 ms after it appeared: first try, full speed.
    #expect(s.trial.perOpPoints[nextOp].last == 200)
}

@Test func sessionGrowlsOncePerProblemWithoutScoring() {
    var s = TrialSession(rng: SeededRandom(seed: 9))
    s.send(.start(now: 0))
    let at = s.nextTimerAt!
    #expect(s.send(.tick(now: at)) == [.growl])
    #expect(s.growls == 1)
    #expect(s.nextTimerAt == nil)
    #expect(!s.trial.resolved)
    #expect(s.trial.perOpPoints == TrialPoints())
}

@Test func sessionCompletesWithTheOutcome() {
    var s = TrialSession(rng: SeededRandom(seed: 2))
    s.send(.start(now: 0))
    var now: Double = 0
    var completed: TrialOutcome?
    while completed == nil {
        now += 1000
        s.send(.tap(now: now, cell: answerCell(s)))
        now += trialGridBlankMs
        for effect in s.send(.tick(now: now)) {
            if case .completed(let outcome) = effect { completed = outcome }
        }
    }
    #expect(s.trial.status == .complete)
    #expect(completed == s.trial.outcome)
    // Fluent throughout: all core ops mastered.
    #expect(completed?.targetNodeID == TrialSettings.defaults.allMasteredNode)
    #expect(s.nextTimerAt == nil)
}
