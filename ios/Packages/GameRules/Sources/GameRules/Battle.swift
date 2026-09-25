// The battle rules as a pure, clock-driven reducer — the Swift port of
// src/rules/battle.js: every timer, the grid lock, the opponent's pace, first
// to `target`, and the companion Bond Powers. golden/battle-transcripts.json is
// the check; BattleTests replays every step of it.
//
//   BattleState(config:layout:target:settings:pace:rng:)  createBattleState
//   stepBattle(_:_:rng:) -> BattleStep                stepBattle
//   state.nextTimerAt                                 nextTimerAt
//   state.isBondActive                                isBondActive
//
// Nothing here reads a clock: time arrives as each event's `now` (ms as a
// Double, the same numbers the JavaScript uses, on any epoch — only
// differences matter), and randomness from the `rng` argument. The state is a
// plain value; `BattleSession` (BattleSession.swift) bundles it with a
// generator for a view model to drive.
//
// The shapes (state fields, timer kinds, events, effects) are the ones the
// JavaScript header documents, in camelCase. Every rule there holds here:
//
//   - Timers fire in (at, id) order, AT their own `at`, so one late tick gives
//     the same result as many on-time ticks. Every event first fires the
//     timers due by its `now`, then applies itself.
//   - The opponent runs while the match is started, playing, not blanking, not
//     aiLocked and the pace is not `.off` (Pace.swift). Whenever it (re)starts
//     it gets a fresh delay from one draw:
//     max(aiMinDelayMs, base + base * aiJitterFraction * (next() - 0.5)),
//     base = aiSeconds * 1000 * pace.factor, evaluated in exactly that order.
//     Untimed, it never starts and never draws.
//   - Some timers deliberately outlive a retry (nextProblem, clearWrongFlash,
//     clearHint, clearReveal, endAiLockout).
//
// Random draws, in order (part of the rule — the same as the JavaScript):
//
//   deal:            generateProblem(config, rng), then
//                    buildGrid(answer:config:layout:rng:)
//   opponent start:  one draw, after any deal in the same step
//   hint2x2:         one draw to pick a window; if none qualifies, a shuffle
//                    of the wrong cells
//   mushroomGrove, lightningStrike: a shuffle of the wrong cells
//   shuffle:         Fisher–Yates from the last index down,
//                    j = floor(next() * (i + 1))

/// Time between cooldown ticks; the cooldown counts down in these steps.
public let bondCooldownTickMs: Double = 100
/// lightningStrike removes at most this many wrong cells.
public let lightningMaxCells = 4

/// The game-wide battle tunables served in the `battle` section of
/// GET /api/rule-settings — `DEFAULT_BATTLE_SETTINGS` in
/// src/data/battleSettings.js. All times are milliseconds.
public struct BattleSettings: Sendable, Equatable {
    /// Opponent delay jitter: ±(aiJitterFraction / 2) of the base delay.
    public var aiJitterFraction: Double
    /// The opponent never answers faster than this.
    public var aiMinDelayMs: Double
    /// Blank between problems after the child solves one.
    public var gridBlankMs: Double
    /// Blank between problems after the opponent solves one (its eat animation).
    public var gridBlankAiMs: Double
    /// A wrong tap locks the grid for this long.
    public var gridLockMs: Double
    /// A wrong tap's cell flashes for this long.
    public var wrongFlashMs: Double

    public init(
        aiJitterFraction: Double, aiMinDelayMs: Double, gridBlankMs: Double,
        gridBlankAiMs: Double, gridLockMs: Double, wrongFlashMs: Double
    ) {
        self.aiJitterFraction = aiJitterFraction
        self.aiMinDelayMs = aiMinDelayMs
        self.gridBlankMs = gridBlankMs
        self.gridBlankAiMs = gridBlankAiMs
        self.gridLockMs = gridLockMs
        self.wrongFlashMs = wrongFlashMs
    }

    /// The fallback until the server's settings arrive. Must equal the web's
    /// DEFAULT_BATTLE_SETTINGS (and so the server's BATTLE_SETTINGS).
    public static let defaults = BattleSettings(
        aiJitterFraction: 0.35, aiMinDelayMs: 1500, gridBlankMs: 500,
        gridBlankAiMs: 2000, gridLockMs: 4000, wrongFlashMs: 350
    )
}

public enum BattleStatus: String, Sendable, Equatable {
    case playing, won, lost
}

/// What a pending deadline does when it fires.
public enum BattleTimerKind: String, Sendable, Equatable, CaseIterable {
    /// The opponent answers the current problem.
    case opponentSolve
    /// The blank ends: deal the next problem, unlock the grid.
    case nextProblem
    /// The wrong-tap pause ends.
    case unlockGrid
    /// The wrong-tap flash ends (one per wrong tap).
    case clearWrongFlash
    /// hint2x2 ends.
    case clearHint
    /// revealAnswer ends.
    case clearReveal
    /// aiLockout ends.
    case endAiLockout
    /// bondCooldownMs -= 100; repeats (same id) until it is 0.
    case cooldownTick
}

/// A pending deadline: `kind` fires at `at` (ms).
public struct BattleTimer: Sendable, Equatable {
    public var id: Int
    public var kind: BattleTimerKind
    public var at: Double

    public init(id: Int, kind: BattleTimerKind, at: Double) {
        self.id = id
        self.kind = kind
        self.at = at
    }
}

public enum BondPowerKind: String, Sendable, Equatable, CaseIterable {
    case hint2x2, revealAnswer, mushroomGrove, lightningStrike, aiLockout, petalShield
}

/// A companion's Bond Power, as the battle needs it.
public struct BondPower: Sendable, Equatable {
    public var kind: BondPowerKind
    public var cooldownMs: Double
    /// How long a timed power (hint2x2, revealAnswer, aiLockout) lasts; nil
    /// counts as 0.
    public var durationMs: Double?
    /// Highlight colour for hint2x2 / revealAnswer, e.g. "#9ed8ff".
    public var highlightColor: String?

    public init(kind: BondPowerKind, cooldownMs: Double, durationMs: Double? = nil, highlightColor: String? = nil) {
        self.kind = kind
        self.cooldownMs = cooldownMs
        self.durationMs = durationMs
        self.highlightColor = highlightColor
    }
}

/// An input to the battle. Each carries `now` (ms).
public enum BattleEvent: Sendable, Equatable {
    /// Start the clocks and the opponent.
    case start(now: Double)
    /// Fire every timer due by `now`.
    case tick(now: Double)
    /// The child taps grid index `cell`.
    case tap(now: Double, cell: Int)
    /// The child uses a companion's Bond Power.
    case bondPower(now: Double, power: BondPower)
    /// Served tunables; later timers use them, running ones keep theirs.
    case settingsLoaded(now: Double, settings: BattleSettings)
    /// The server's node config arrived: redeal on it.
    case configLoaded(now: Double, config: BattleConfig, layout: BattleLayout)
    /// A fresh match on the same config.
    case retry(now: Double)

    public var now: Double {
        switch self {
        case .start(let now), .tick(let now), .retry(let now): now
        case .tap(let now, _), .bondPower(let now, _), .settingsLoaded(let now, _): now
        case .configLoaded(let now, _, _): now
        }
    }
}

public enum BattleSound: String, Sendable, Equatable {
    /// The child solved it.
    case yip
    /// The opponent solved it.
    case growl
}

/// Who solved a problem.
public enum BattleOutcome: String, Sendable, Equatable {
    case child, ai
}

/// A solved problem, for attempt logging (`attempt` on the web).
public struct BattleAttempt: Sendable, Equatable {
    public var operandA: Int
    public var operandB: Int
    public var op: BattleOp
    public var answer: Int
    public var outcome: BattleOutcome
    /// Since the problem was dealt.
    public var timeMs: Double

    public init(operandA: Int, operandB: Int, op: BattleOp, answer: Int, outcome: BattleOutcome, timeMs: Double) {
        self.operandA = operandA
        self.operandB = operandB
        self.op = op
        self.answer = answer
        self.outcome = outcome
        self.timeMs = timeMs
    }
}

/// A wrong tap, for logging (`wrongTap` on the web).
public struct BattleWrongTap: Sendable, Equatable {
    public var operandA: Int
    public var operandB: Int
    public var op: BattleOp
    public var correctAnswer: Int
    /// The tapped cell's value; nil for a spacer.
    public var tappedValue: Int?
    /// Since the problem was dealt.
    public var timeMs: Double

    public init(operandA: Int, operandB: Int, op: BattleOp, correctAnswer: Int, tappedValue: Int?, timeMs: Double) {
        self.operandA = operandA
        self.operandB = operandB
        self.op = op
        self.correctAnswer = correctAnswer
        self.tappedValue = tappedValue
        self.timeMs = timeMs
    }
}

/// What the caller must do after a step. The app adds the node id and handles
/// the logging queue, sounds and match rows.
public enum BattleEffect: Sendable, Equatable {
    case sound(BattleSound)
    case attempt(BattleAttempt)
    case wrongTap(BattleWrongTap)
}

/// The whole battle, as plain data. Field for field the JavaScript state.
public struct BattleState: Sendable, Equatable {
    public var config: BattleConfig
    /// Row-major; parallel to `grid`.
    public var layout: BattleLayout
    /// Points to win.
    public var target: Int
    public var settings: BattleSettings
    /// The child's game pace; fixed for the battle.
    public var pace: GamePace
    public var problem: Problem
    /// Parallel to `layout.cells`; nil = spacer.
    public var grid: [Int?]
    /// Deal counter; +1 whenever a new problem is dealt.
    public var round: Int
    public var playerScore: Int
    public var aiScore: Int
    public var status: BattleStatus
    /// Cell flashing as a wrong tap.
    public var wrongCellIndex: Int?
    /// True while the think-it-through pause runs.
    public var gridLocked: Bool
    /// True between a solve and the next problem.
    public var blanking: Bool
    /// Answer the opponent just took.
    public var aiSolvedAnswer: Int?
    /// Cell the opponent is gobbling.
    public var aiEatCellIndex: Int?
    public var hintCellIndices: [Int]?
    /// Highlight colour for hint2x2 / revealAnswer.
    public var hintColor: String?
    public var revealCellIndex: Int?
    /// Cells covered by mushroomGrove.
    public var mushroomCellIndices: [Int]?
    /// Cells removed by lightningStrike.
    public var zappedCellIndices: [Int]?
    /// aiLockout running.
    public var aiLocked: Bool
    /// petalShield armed.
    public var shieldActive: Bool
    /// Remaining cooldown, counted down in `bondCooldownTickMs` steps.
    public var bondCooldownMs: Double
    /// The cooldown it started from (for the ring).
    public var bondCooldownTotalMs: Double
    /// ms of `start`/`retry`; nil before `start`.
    public var matchStartedAt: Double?
    /// ms the current problem was dealt; nil before `start`.
    public var problemStartedAt: Double?
    /// Set once the match is won or lost.
    public var matchDurationMs: Double?
    /// Pending deadlines, in the order they were added.
    public var timers: [BattleTimer]
    /// Id for the next timer.
    public var nextTimerId: Int

    /// A dealt, not-yet-started battle (`createBattleState`): the first problem
    /// is on the board but no clock runs until `.start`.
    public init(
        config: BattleConfig,
        layout: BattleLayout,
        target: Int = problemsToWin,
        settings: BattleSettings = .defaults,
        pace: GamePace = .normal,
        rng: inout some RandomSource
    ) {
        let problem = generateProblem(config, rng: &rng)
        self.config = config
        self.layout = layout
        self.target = target
        self.settings = settings
        self.pace = pace
        self.problem = problem
        self.grid = buildGrid(answer: problem.answer, config: config, layout: layout, rng: &rng)
        self.round = 1
        self.playerScore = 0
        self.aiScore = 0
        self.status = .playing
        self.wrongCellIndex = nil
        self.gridLocked = false
        self.blanking = false
        self.aiSolvedAnswer = nil
        self.aiEatCellIndex = nil
        self.hintCellIndices = nil
        self.hintColor = nil
        self.revealCellIndex = nil
        self.mushroomCellIndices = nil
        self.zappedCellIndices = nil
        self.aiLocked = false
        self.shieldActive = false
        self.bondCooldownMs = 0
        self.bondCooldownTotalMs = 0
        self.matchStartedAt = nil
        self.problemStartedAt = nil
        self.matchDurationMs = nil
        self.timers = []
        self.nextTimerId = 1
    }

    /// Memberwise, for restoring or constructing a state as-is (tests, golden
    /// replays). Deals nothing and draws nothing.
    public init(
        config: BattleConfig, layout: BattleLayout, target: Int, settings: BattleSettings, pace: GamePace = .normal,
        problem: Problem, grid: [Int?], round: Int, playerScore: Int, aiScore: Int,
        status: BattleStatus, wrongCellIndex: Int?, gridLocked: Bool, blanking: Bool,
        aiSolvedAnswer: Int?, aiEatCellIndex: Int?, hintCellIndices: [Int]?, hintColor: String?,
        revealCellIndex: Int?, mushroomCellIndices: [Int]?, zappedCellIndices: [Int]?,
        aiLocked: Bool, shieldActive: Bool, bondCooldownMs: Double, bondCooldownTotalMs: Double,
        matchStartedAt: Double?, problemStartedAt: Double?, matchDurationMs: Double?,
        timers: [BattleTimer], nextTimerId: Int
    ) {
        self.config = config
        self.layout = layout
        self.target = target
        self.settings = settings
        self.pace = pace
        self.problem = problem
        self.grid = grid
        self.round = round
        self.playerScore = playerScore
        self.aiScore = aiScore
        self.status = status
        self.wrongCellIndex = wrongCellIndex
        self.gridLocked = gridLocked
        self.blanking = blanking
        self.aiSolvedAnswer = aiSolvedAnswer
        self.aiEatCellIndex = aiEatCellIndex
        self.hintCellIndices = hintCellIndices
        self.hintColor = hintColor
        self.revealCellIndex = revealCellIndex
        self.mushroomCellIndices = mushroomCellIndices
        self.zappedCellIndices = zappedCellIndices
        self.aiLocked = aiLocked
        self.shieldActive = shieldActive
        self.bondCooldownMs = bondCooldownMs
        self.bondCooldownTotalMs = bondCooldownTotalMs
        self.matchStartedAt = matchStartedAt
        self.problemStartedAt = problemStartedAt
        self.matchDurationMs = matchDurationMs
        self.timers = timers
        self.nextTimerId = nextTimerId
    }

    /// Whether any Bond Power effect is showing or armed.
    public var isBondActive: Bool {
        hintCellIndices != nil || revealCellIndex != nil || mushroomCellIndices != nil ||
            zappedCellIndices != nil || aiLocked || shieldActive
    }

    /// The earliest pending deadline (ms), for the caller to schedule a
    /// `.tick` at; nil when nothing is pending.
    public var nextTimerAt: Double? {
        earliestTimerIndex.map { timers[$0].at }
    }
}

/// The result of one `stepBattle`.
public struct BattleStep: Sendable, Equatable {
    public var state: BattleState
    public var effects: [BattleEffect]
    /// False when the event changed nothing (`state` is then the input, and
    /// no random draw was made) — the caller can skip a re-render.
    public var changed: Bool

    public init(state: BattleState, effects: [BattleEffect], changed: Bool) {
        self.state = state
        self.effects = effects
        self.changed = changed
    }
}

/// Applies one event: first fires every timer due by `event.now`, then the
/// event itself. Draws only from `rng`, in the order the header documents.
public func stepBattle(_ state: BattleState, _ event: BattleEvent, rng: inout some RandomSource) -> BattleStep {
    var s = state
    var effects: [BattleEffect] = []
    let now = event.now
    var changed = s.advance(to: now, rng: &rng, effects: &effects)
    let afterTimers = s

    switch event {
    case .tick:
        break
    case .start:
        s.matchStartedAt = now
        s.problemStartedAt = now
        changed = true
    case .tap(_, let cell):
        changed = s.tap(cell, now: now, effects: &effects) || changed
    case .bondPower(_, let power):
        changed = s.bondPower(power, now: now, rng: &rng) || changed
    case .settingsLoaded(_, let settings):
        s.settings = settings
        changed = true
    case .configLoaded(_, let config, let layout):
        s.config = config
        s.layout = layout
        s.deal(rng: &rng)
        s.problemStartedAt = now
        changed = true
    case .retry:
        s.resetMatch()
        s.cancelTimers(.unlockGrid)
        s.cancelTimers(.cooldownTick)
        s.deal(rng: &rng)
        s.matchStartedAt = now
        s.problemStartedAt = now
        changed = true
    }

    guard changed else { return BattleStep(state: state, effects: effects, changed: false) }
    s.syncOpponent(from: afterTimers, now: now, rng: &rng)
    return BattleStep(state: s, effects: effects, changed: true)
}

// ─── internals ───────────────────────────────────────────────────────────────

extension BattleState {
    /// Index of the earliest timer by (at, id); the first such on a tie.
    fileprivate var earliestTimerIndex: Int? {
        var best: Int?
        for (i, t) in timers.enumerated() {
            guard let b = best else { best = i; continue }
            let bt = timers[b]
            if t.at < bt.at || (t.at == bt.at && t.id < bt.id) { best = i }
        }
        return best
    }

    /// The fields a new match starts from (shared with the initial state).
    fileprivate mutating func resetMatch() {
        playerScore = 0
        aiScore = 0
        status = .playing
        wrongCellIndex = nil
        gridLocked = false
        blanking = false
        aiSolvedAnswer = nil
        aiEatCellIndex = nil
        hintCellIndices = nil
        hintColor = nil
        revealCellIndex = nil
        mushroomCellIndices = nil
        zappedCellIndices = nil
        aiLocked = false
        shieldActive = false
        bondCooldownMs = 0
        bondCooldownTotalMs = 0
        matchDurationMs = nil
    }

    fileprivate mutating func deal(rng: inout some RandomSource) {
        let problem = generateProblem(config, rng: &rng)
        self.problem = problem
        grid = buildGrid(answer: problem.answer, config: config, layout: layout, rng: &rng)
        round += 1
    }

    /// Adds a timer. A new timer takes `nextTimerId`; a repeating one passes
    /// its own id to keep it.
    fileprivate mutating func addTimer(_ kind: BattleTimerKind, at: Double, id: Int? = nil) {
        let id = id ?? nextTimerId
        timers.append(BattleTimer(id: id, kind: kind, at: at))
        if id == nextTimerId { nextTimerId += 1 }
    }

    fileprivate mutating func cancelTimers(_ kind: BattleTimerKind) {
        timers.removeAll { $0.kind == kind }
    }

    /// Fires every timer due by `now`, earliest first, re-syncing the opponent
    /// after each (a fire can start or stop it). Returns whether anything fired.
    fileprivate mutating func advance(
        to now: Double, rng: inout some RandomSource, effects: inout [BattleEffect]
    ) -> Bool {
        var fired = false
        while let index = earliestTimerIndex, timers[index].at <= now {
            let before = self
            let due = timers.remove(at: index)
            fire(due, rng: &rng, effects: &effects)
            syncOpponent(from: before, now: due.at, rng: &rng)
            fired = true
        }
        return fired
    }

    private mutating func fire(_ timer: BattleTimer, rng: inout some RandomSource, effects: inout [BattleEffect]) {
        let at = timer.at
        switch timer.kind {
        case .opponentSolve:
            effects.append(.attempt(BattleAttempt(
                operandA: problem.a, operandB: problem.b, op: problem.op, answer: problem.answer,
                outcome: .ai, timeMs: at - (problemStartedAt ?? at)
            )))
            effects.append(.sound(.growl))
            endProblem(winner: .ai, now: at)
        case .nextProblem:
            // Dealt from the CURRENT config/layout, which a server config may
            // have replaced during the blank.
            deal(rng: &rng)
            problemStartedAt = at
            blanking = false
            aiSolvedAnswer = nil
            aiEatCellIndex = nil
            // A fresh problem is always tappable, even mid wrong-tap pause.
            cancelTimers(.unlockGrid)
            gridLocked = false
        case .unlockGrid:
            gridLocked = false
        case .clearWrongFlash:
            wrongCellIndex = nil
        case .clearHint:
            hintCellIndices = nil
            hintColor = nil
        case .clearReveal:
            revealCellIndex = nil
            hintColor = nil
        case .endAiLockout:
            aiLocked = false
        case .cooldownTick:
            bondCooldownMs = Swift.max(0, bondCooldownMs - bondCooldownTickMs)
            if bondCooldownMs > 0 { addTimer(.cooldownTick, at: at + bondCooldownTickMs, id: timer.id) }
        }
    }

    private var opponentCanRun: Bool {
        matchStartedAt != nil && status == .playing && !blanking && !aiLocked && !pace.isUntimed
    }

    /// Starts, restarts or stops the opponent to match the transition
    /// `prev` → self.
    fileprivate mutating func syncOpponent(from prev: BattleState, now: Double, rng: inout some RandomSource) {
        let runs = opponentCanRun
        let ran = prev.opponentCanRun
        if runs && ran && prev.round == round && prev.config.aiSeconds == config.aiSeconds { return }
        if !runs && !ran { return }
        cancelTimers(.opponentSolve)
        guard runs else { return }
        let base = config.aiSeconds * 1000 * pace.factor
        let jitter = base * settings.aiJitterFraction * (rng.next() - 0.5)
        addTimer(.opponentSolve, at: now + Swift.max(settings.aiMinDelayMs, base + jitter))
    }

    /// The current problem is over: someone solved it. Blanks the grid, then
    /// the nextProblem timer deals a fresh one — even after the final point,
    /// since the result screen covers the grid by then.
    private mutating func endProblem(winner: BattleOutcome, now: Double) {
        switch winner {
        case .child:
            playerScore += 1
            if playerScore >= target && status == .playing { finish(.won, now: now) }
        case .ai:
            aiScore += 1
            if aiScore >= target && status == .playing { finish(.lost, now: now) }
            aiSolvedAnswer = problem.answer
            // Pounce on the cell holding the answer so the opponent can gobble it.
            aiEatCellIndex = grid.firstIndex(of: problem.answer)
        }
        blanking = true
        // Per-problem bond effects clear with the problem: their cell indices
        // point into the old grid, and an unused shield is per-problem.
        mushroomCellIndices = nil
        zappedCellIndices = nil
        revealCellIndex = nil
        shieldActive = false
        addTimer(.nextProblem, at: now + (winner == .ai ? settings.gridBlankAiMs : settings.gridBlankMs))
    }

    /// The match is decided: every bond effect and the cooldown clear, and the
    /// duration is stamped.
    private mutating func finish(_ status: BattleStatus, now: Double) {
        self.status = status
        hintCellIndices = nil
        hintColor = nil
        revealCellIndex = nil
        mushroomCellIndices = nil
        zappedCellIndices = nil
        aiLocked = false
        shieldActive = false
        bondCooldownMs = 0
        cancelTimers(.cooldownTick)
        matchDurationMs = now - (matchStartedAt ?? now)
    }

    fileprivate mutating func tap(_ cell: Int, now: Double, effects: inout [BattleEffect]) -> Bool {
        if status != .playing || blanking || gridLocked { return false }
        // Mushroom-covered and lightning-zapped cells are inert: no answer
        // match, no wrong-tap penalty.
        if mushroomCellIndices?.contains(cell) == true { return false }
        if zappedCellIndices?.contains(cell) == true { return false }

        let value = grid.indices.contains(cell) ? grid[cell] : nil
        let timeMs = now - (problemStartedAt ?? now)
        if value == problem.answer {
            effects.append(.attempt(BattleAttempt(
                operandA: problem.a, operandB: problem.b, op: problem.op, answer: problem.answer,
                outcome: .child, timeMs: timeMs
            )))
            effects.append(.sound(.yip))
            endProblem(winner: .child, now: now)
            return true
        }

        effects.append(.wrongTap(BattleWrongTap(
            operandA: problem.a, operandB: problem.b, op: problem.op, correctAnswer: problem.answer,
            tappedValue: value, timeMs: timeMs
        )))
        wrongCellIndex = cell
        addTimer(.clearWrongFlash, at: now + settings.wrongFlashMs)
        // The petal shield forgives one wrong tap: it still flashes and is
        // logged, but the grid does not lock. One-shot.
        if shieldActive {
            shieldActive = false
            return true
        }
        // Lock the whole grid so the child slows down and reconsiders rather
        // than tapping rapidly through the options. The next problem lifts it.
        gridLocked = true
        cancelTimers(.unlockGrid)
        addTimer(.unlockGrid, at: now + settings.gridLockMs)
        return true
    }

    /// A Bond Power. Refused (no state change, no cooldown, no draw) while one
    /// is active, on cooldown, between problems, or when the power cannot
    /// apply to this grid.
    fileprivate mutating func bondPower(_ power: BondPower, now: Double, rng: inout some RandomSource) -> Bool {
        if status != .playing || blanking { return false }
        if bondCooldownMs > 0 || isBondActive { return false }

        let answer = problem.answer
        let answerIdx = grid.firstIndex(of: answer)
        // Active cells holding a wrong value (not spacers, not the answer).
        let wrongIndices = grid.indices.filter { grid[$0] != nil && grid[$0] != answer }
        let duration = power.durationMs ?? 0

        switch power.kind {
        case .hint2x2:
            // Every 2x2 window with ≥3 active cells that contains the answer.
            // On a sparse layout with none, fall back to the answer cell plus
            // up to 2 random wrong cells — so the peek always includes the answer.
            let (cols, rows) = (layout.cols, layout.rows)
            var windows: [[Int]] = []
            if rows >= 2 && cols >= 2 {
                for r in 0...(rows - 2) {
                    for c in 0...(cols - 2) {
                        let idxs = [r * cols + c, r * cols + c + 1, (r + 1) * cols + c, (r + 1) * cols + c + 1]
                        let active = idxs.filter { grid[$0] != nil }
                        if active.count < 3 { continue }
                        if !active.contains(where: { grid[$0] == answer }) { continue }
                        windows.append(active)
                    }
                }
            }
            let cells: [Int]
            if !windows.isEmpty {
                cells = windows[Int((rng.next() * Double(windows.count)).rounded(.down))]
            } else {
                guard let answerIdx else { return false }
                cells = [answerIdx] + shuffled(wrongIndices, rng: &rng).prefix(2)
            }
            hintCellIndices = cells
            hintColor = power.highlightColor
            addTimer(.clearHint, at: now + duration)
        case .revealAnswer:
            // Pinpoints the exact answer cell — the strongest hint.
            guard let answerIdx else { return false }
            revealCellIndex = answerIdx
            hintColor = power.highlightColor
            addTimer(.clearReveal, at: now + duration)
        case .mushroomGrove:
            // Cover half the wrong cells (rounded up) until the next problem.
            let order = shuffled(wrongIndices, rng: &rng)
            mushroomCellIndices = Array(order.prefix((order.count + 1) / 2))
        case .lightningStrike:
            // Zap up to lightningMaxCells wrong cells until the next problem.
            let order = shuffled(wrongIndices, rng: &rng)
            zappedCellIndices = Array(order.prefix(lightningMaxCells))
        case .aiLockout:
            aiLocked = true
            addTimer(.endAiLockout, at: now + duration)
        case .petalShield:
            // Armed until it absorbs a wrong tap or the problem ends.
            shieldActive = true
        }

        bondCooldownTotalMs = power.cooldownMs
        bondCooldownMs = power.cooldownMs
        if bondCooldownMs > 0 { addTimer(.cooldownTick, at: now + bondCooldownTickMs) }
        return true
    }
}

/// Fisher–Yates from the last index down, j = floor(next() * (i + 1)).
private func shuffled(_ values: [Int], rng: inout some RandomSource) -> [Int] {
    var out = values
    var i = out.count - 1
    while i > 0 {
        let j = Int((rng.next() * Double(i + 1)).rounded(.down))
        out.swapAt(i, j)
        i -= 1
    }
    return out
}
