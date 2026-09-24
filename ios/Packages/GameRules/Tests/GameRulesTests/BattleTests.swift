import Foundation
import Testing
import GameRules

/// golden/battle-transcripts.json: scripted battles through src/rules/battle.js.
/// Per transcript, one generator (createSeededRandom(seed)) makes the initial
/// state and then every step, in order. The events carry their own `now`, so
/// the replay is its own test clock: nothing here waits or reads a clock.
private struct TranscriptsGolden: Decodable, Sendable {
    struct Config: Decodable, Sendable {
        let ops: [BattleOp]
        let range: [Int]
        let aiSeconds: Double
        let shapeId: String?

        func swift() throws -> BattleConfig {
            try #require(range.count == 2)
            return BattleConfig(ops: ops, min: range[0], max: range[1], aiSeconds: aiSeconds, shapeId: shapeId)
        }
    }

    struct Layout: Decodable, Sendable {
        let cols: Int
        let rows: Int
        let cells: [Bool]

        var swift: BattleLayout { BattleLayout(cols: cols, rows: rows, cells: cells) }
    }

    struct Settings: Decodable, Sendable {
        let aiJitterFraction: Double
        let aiMinDelayMs: Double
        let gridBlankMs: Double
        let gridBlankAiMs: Double
        let gridLockMs: Double
        let wrongFlashMs: Double

        var swift: BattleSettings {
            BattleSettings(
                aiJitterFraction: aiJitterFraction, aiMinDelayMs: aiMinDelayMs, gridBlankMs: gridBlankMs,
                gridBlankAiMs: gridBlankAiMs, gridLockMs: gridLockMs, wrongFlashMs: wrongFlashMs
            )
        }
    }

    struct Init: Decodable, Sendable {
        let config: Config
        let layout: Layout
        let target: Int
        let settings: Settings
    }

    struct GoldenProblem: Decodable, Sendable {
        let a: Int
        let b: Int
        let op: BattleOp
        let text: String
        let answer: Int
    }

    struct Timer: Decodable, Sendable {
        let id: Int
        let kind: String
        let at: Double
    }

    /// Every field of the JavaScript state. `stateKeys` checks none is missed.
    struct State: Decodable, Sendable {
        let config: Config
        let layout: Layout
        let target: Int
        let settings: Settings
        let problem: GoldenProblem
        let grid: [Int?]
        let round: Int
        let playerScore: Int
        let aiScore: Int
        let status: String
        let wrongCellIndex: Int?
        let gridLocked: Bool
        let blanking: Bool
        let aiSolvedAnswer: Int?
        let aiEatCellIndex: Int?
        let hintCellIndices: [Int]?
        let hintColor: String?
        let revealCellIndex: Int?
        let mushroomCellIndices: [Int]?
        let zappedCellIndices: [Int]?
        let aiLocked: Bool
        let shieldActive: Bool
        let bondCooldownMs: Double
        let bondCooldownTotalMs: Double
        let matchStartedAt: Double?
        let problemStartedAt: Double?
        let matchDurationMs: Double?
        let timers: [Timer]
        let nextTimerId: Int

        func swift() throws -> BattleState {
            let problem = Problem(a: problem.a, b: problem.b, op: problem.op, answer: problem.answer)
            #expect(problem.text == self.problem.text)
            return BattleState(
                config: try config.swift(), layout: layout.swift, target: target, settings: settings.swift,
                problem: problem, grid: grid, round: round, playerScore: playerScore, aiScore: aiScore,
                status: try #require(BattleStatus(rawValue: status), "status \(status)"),
                wrongCellIndex: wrongCellIndex, gridLocked: gridLocked, blanking: blanking,
                aiSolvedAnswer: aiSolvedAnswer, aiEatCellIndex: aiEatCellIndex,
                hintCellIndices: hintCellIndices, hintColor: hintColor, revealCellIndex: revealCellIndex,
                mushroomCellIndices: mushroomCellIndices, zappedCellIndices: zappedCellIndices,
                aiLocked: aiLocked, shieldActive: shieldActive,
                bondCooldownMs: bondCooldownMs, bondCooldownTotalMs: bondCooldownTotalMs,
                matchStartedAt: matchStartedAt, problemStartedAt: problemStartedAt,
                matchDurationMs: matchDurationMs,
                timers: try timers.map {
                    BattleTimer(id: $0.id, kind: try #require(BattleTimerKind(rawValue: $0.kind), "timer \($0.kind)"), at: $0.at)
                },
                nextTimerId: nextTimerId
            )
        }
    }

    struct Power: Decodable, Sendable {
        let kind: String
        let cooldownMs: Double
        let durationMs: Double?
        let highlightColor: String?
    }

    struct Event: Decodable, Sendable {
        let type: String
        let now: Double
        let cell: Int?
        let power: Power?
        let settings: Settings?
        let config: Config?
        let layout: Layout?

        func swift() throws -> BattleEvent {
            switch type {
            case "start": return .start(now: now)
            case "tick": return .tick(now: now)
            case "retry": return .retry(now: now)
            case "tap": return .tap(now: now, cell: try #require(cell))
            case "bondPower":
                let p = try #require(power)
                let kind = try #require(BondPowerKind(rawValue: p.kind), "power \(p.kind)")
                return .bondPower(now: now, power: BondPower(
                    kind: kind, cooldownMs: p.cooldownMs, durationMs: p.durationMs, highlightColor: p.highlightColor
                ))
            case "settingsLoaded": return .settingsLoaded(now: now, settings: try #require(settings).swift)
            case "configLoaded":
                return .configLoaded(now: now, config: try #require(config).swift(), layout: try #require(layout).swift)
            default:
                Issue.record("unknown event \(type)")
                throw CancellationError()
            }
        }
    }

    struct Effect: Decodable, Sendable {
        struct Attempt: Decodable, Sendable {
            let operand_a: Int
            let operand_b: Int
            let `operator`: BattleOp
            let answer: Int
            let outcome: String
            let time_ms: Double
        }

        struct WrongTap: Decodable, Sendable {
            let operand_a: Int
            let operand_b: Int
            let `operator`: BattleOp
            let correct_answer: Int
            let tapped_value: Int?
            let time_ms: Double
        }

        let type: String
        let sound: String?
        let attempt: Attempt?
        let wrongTap: WrongTap?

        func swift() throws -> BattleEffect {
            switch type {
            case "sound":
                let name = try #require(sound)
                return .sound(try #require(BattleSound(rawValue: name)))
            case "attempt":
                let a = try #require(attempt)
                return .attempt(BattleAttempt(
                    operandA: a.operand_a, operandB: a.operand_b, op: a.operator, answer: a.answer,
                    outcome: try #require(BattleOutcome(rawValue: a.outcome)), timeMs: a.time_ms
                ))
            case "wrongTap":
                let w = try #require(wrongTap)
                return .wrongTap(BattleWrongTap(
                    operandA: w.operand_a, operandB: w.operand_b, op: w.operator, correctAnswer: w.correct_answer,
                    tappedValue: w.tapped_value, timeMs: w.time_ms
                ))
            default:
                Issue.record("unknown effect \(type)")
                throw CancellationError()
            }
        }
    }

    struct Step: Decodable, Sendable {
        let event: Event
        let effects: [Effect]
        let state: State
    }

    struct Transcript: Decodable, Sendable, CustomTestStringConvertible {
        var testDescription: String { name }
        let name: String
        let seed: String
        let `init`: Init
        let initialState: State
        let steps: [Step]
    }

    let fixture: String
    let version: Int
    let transcripts: [Transcript]

    static func load() throws -> TranscriptsGolden {
        try JSONDecoder().decode(TranscriptsGolden.self, from: RepoPaths.goldenData("battle-transcripts"))
    }
}

private let golden = Result { try TranscriptsGolden.load() }
private func file() throws -> TranscriptsGolden { try golden.get() }

@Test func transcriptsHeader() throws {
    let golden = try file()
    #expect(golden.fixture == "battle-transcripts")
    #expect(golden.version == 1)
    #expect(Set(golden.transcripts.map(\.name)) ==
        ["win", "loss", "grid-lock", "opponent-pacing", "bond-powers", "hint-fallback"])
}

/// The decoder above names every state and effect field; this fails if the
/// JavaScript grows one the replay would otherwise silently ignore.
@Test func transcriptsDecodeEveryField() throws {
    let json = try #require(
        try JSONSerialization.jsonObject(with: RepoPaths.goldenData("battle-transcripts")) as? [String: Any]
    )
    let stateKeys: Set<String> = [
        "config", "layout", "target", "settings", "problem", "grid", "round", "playerScore", "aiScore",
        "status", "wrongCellIndex", "gridLocked", "blanking", "aiSolvedAnswer", "aiEatCellIndex",
        "hintCellIndices", "hintColor", "revealCellIndex", "mushroomCellIndices", "zappedCellIndices",
        "aiLocked", "shieldActive", "bondCooldownMs", "bondCooldownTotalMs", "matchStartedAt",
        "problemStartedAt", "matchDurationMs", "timers", "nextTimerId",
    ]
    let effectKeys: [String: Set<String>] = [
        "attempt": ["operand_a", "operand_b", "operator", "answer", "outcome", "time_ms"],
        "wrongTap": ["operand_a", "operand_b", "operator", "correct_answer", "tapped_value", "time_ms"],
    ]
    let transcripts = try #require(json["transcripts"] as? [[String: Any]])
    for transcript in transcripts {
        let steps = try #require(transcript["steps"] as? [[String: Any]])
        let states = [transcript["initialState"]] + steps.map { $0["state"] }
        for state in states {
            let state = try #require(state as? [String: Any])
            #expect(Set(state.keys) == stateKeys)
            #expect(Set(try #require(state["settings"] as? [String: Any]).keys).count == 6)
            #expect(Set(try #require(state["config"] as? [String: Any]).keys)
                .isSubset(of: ["ops", "range", "aiSeconds", "shapeId"]))
        }
        for step in steps {
            for effect in try #require(step["effects"] as? [[String: Any]]) {
                let type = try #require(effect["type"] as? String)
                #expect(Set(effect.keys) == ["type", type == "sound" ? "sound" : type])
                if let keys = effectKeys[type] {
                    #expect(Set(try #require(effect[type] as? [String: Any]).keys) == keys)
                }
            }
        }
    }
}

@Test(arguments: try file().transcripts)
private func transcriptReplaysExactly(_ transcript: TranscriptsGolden.Transcript) throws {
    var rng = SeededRandom(seed: try #require(UInt64(transcript.seed)))
    let setup = transcript.`init`
    var state = BattleState(
        config: try setup.config.swift(), layout: setup.layout.swift, target: setup.target,
        settings: setup.settings.swift, rng: &rng
    )
    #expect(state == (try transcript.initialState.swift()), "initial state")
    #expect(!transcript.steps.isEmpty)

    for (index, step) in transcript.steps.enumerated() {
        let event = try step.event.swift()
        let out = stepBattle(state, event, rng: &rng)
        let expectedEffects = try step.effects.map { try $0.swift() }
        let expectedState = try step.state.swift()
        #expect(out.effects == expectedEffects, "step \(index) \(step.event.type) effects")
        #expect(out.state == expectedState, "step \(index) \(step.event.type) state")
        if out.state != expectedState || out.effects != expectedEffects { return }
        state = out.state
    }
}

@Test func transcriptsCoverWinLossLockAndOpponent() throws {
    let states = try file().transcripts.flatMap { $0.steps.map(\.state) }
    #expect(states.contains { $0.status == "won" })
    #expect(states.contains { $0.status == "lost" })
    #expect(states.contains { $0.gridLocked })
    let solves = try file().transcripts.flatMap { $0.steps.flatMap(\.effects) }
        .filter { $0.attempt?.outcome == "ai" }.count
    #expect(solves > 10)
}

// ─── Behaviour beyond the transcripts, driven by a test clock ────────────────

/// A manual clock: time moves only when the test says so.
private struct TestClock {
    var now: Double = 0
    mutating func advance(by ms: Double) { now += ms }
}

private func newSession(seed: UInt64 = 11) -> BattleSession<SeededRandom> {
    BattleSession(config: BattleConfig.defaultConfig(forNode: 1), layout: .world(1), rng: SeededRandom(seed: seed))
}

@Test func oneLateTickEqualsOnTimeTicks() {
    // A few problems with a power on cooldown, ticking either at every deadline
    // or only once at the end, from the same seed.
    func play(onTime: Bool) -> BattleSession<SeededRandom> {
        var battle = newSession()
        var clock = TestClock()
        battle.send(.start(now: clock.now))
        clock.advance(by: 50)
        battle.send(.bondPower(now: clock.now, power: BondPower(kind: .petalShield, cooldownMs: 1500)))
        if onTime {
            while let at = battle.nextTimerAt, at <= 40_000 { battle.send(.tick(now: at)) }
        }
        battle.send(.tick(now: 40_000))
        return battle
    }
    let late = play(onTime: false)
    #expect(late.state.aiScore > 1)
    #expect(late == play(onTime: true))
}

@Test func anEventThatChangesNothingDrawsNothing() {
    var rng = SeededRandom(seed: 5)
    let state = BattleState(config: BattleConfig.defaultConfig(forNode: 1), layout: .world(1), rng: &rng)
    let before = rng
    // Not started, so no opponent and no timers: a tick is a no-op.
    let step = stepBattle(state, .tick(now: 1000), rng: &rng)
    #expect(!step.changed)
    #expect(step.state == state)
    #expect(step.effects.isEmpty)
    #expect(rng == before)
}

@Test func sessionDrivesAWinByTicksAtNextTimerAt() {
    var battle = newSession(seed: 3)
    var clock = TestClock()
    battle.send(.start(now: clock.now))
    var sounds: [BattleSound] = []
    while battle.state.status == .playing {
        clock.advance(by: 300)
        if let at = battle.nextTimerAt, at <= clock.now { battle.send(.tick(now: clock.now)); continue }
        let state = battle.state
        guard !state.blanking, let cell = state.grid.firstIndex(of: state.problem.answer) else { continue }
        for effect in battle.send(.tap(now: clock.now, cell: cell)) {
            if case .sound(let sound) = effect { sounds.append(sound) }
        }
    }
    #expect(battle.state.status == .won)
    #expect(battle.state.playerScore == problemsToWin)
    #expect(sounds == Array(repeating: .yip, count: problemsToWin))
    #expect(battle.state.matchDurationMs == clock.now)
}
