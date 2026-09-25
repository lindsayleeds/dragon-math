// A Dragon's Trial as it's played on screen: the trial rules (Trial.swift) plus
// what src/hooks/useDragonTrial.js adds around them — the answer grid, the
// wrong-cell flash, the blank between problems and the atmospheric growl —
// bundled with the generator they draw from. Like `BattleSession` it reads no
// clock and runs no timers of its own: every event carries `now` (ms, any
// epoch), and the caller sleeps until `nextTimerAt` and sends `.tick`.
//
// Deadlines fire AT their own time, earliest first, so a late tick replays
// exactly what on-time ticks would have: the next problem is timed from the
// end of its blank, not from when the tick arrived.
//
// Random draws: the trial's own (see Trial.swift), then for each problem posed
// its grid (`buildGrid(answer:config:layout:rng:)`), then its growl delay
// (`trialGrowlDelayMs`, one draw). golden/trial.json checks the trial draws
// through `TrialState` alone; the web draws grids and growls from
// Math.random, so these extra draws aren't part of the golden contract.

/// Blank between problems (`GRID_BLANK_MS`).
public let trialGridBlankMs: Double = 400
/// How long a wrong tap's cell flashes (`WRONG_FLASH_MS`).
public let trialWrongFlashMs: Double = 350
/// The trial's grid is World 5's layout (`TRIAL_WORLD_ID`).
public let trialWorldID = 5

public enum TrialEvent: Sendable, Equatable {
    /// The first problem is on screen: start its clock.
    case start(now: Double)
    case tap(now: Double, cell: Int)
    /// "Too hard for me".
    case skip(now: Double)
    /// Fire every deadline due by `now`.
    case tick(now: Double)
}

/// What the caller should do after an event.
public enum TrialEffect: Sendable, Equatable {
    case correct
    case wrong(cell: Int)
    /// The dragon growls (flavor only; it never scores against the kid).
    case growl
    /// The last problem is done.
    case completed(TrialOutcome)
}

public struct TrialSession<RNG: RandomSource> {
    public private(set) var trial: TrialState
    public private(set) var rng: RNG
    public let layout: BattleLayout
    /// Parallel to `layout.cells`: a number per active cell, nil per spacer.
    public private(set) var grid: [Int?]
    /// The cell flashing wrong, if any.
    public private(set) var wrongCellIndex: Int?
    /// The atmospheric score: growls so far. Never ends anything.
    public private(set) var growls = 0
    public private(set) var started = false

    private var blankUntil: Double?
    private var wrongUntil: Double?
    private var growlAt: Double?

    /// A dealt, not-yet-started trial; send `.start(now:)` once it's shown.
    public init(settings: TrialSettings = .defaults, layout: BattleLayout = .world(trialWorldID), rng: RNG) {
        var rng = rng
        trial = TrialState(settings: settings, rng: &rng)
        self.layout = layout
        grid = []
        self.rng = rng
        deal()
    }

    /// Between problems: the numbers are hidden and input is ignored.
    public var blanking: Bool { blankUntil != nil }

    /// When to send the next `.tick`; nil when nothing is pending.
    public var nextTimerAt: Double? {
        [blankUntil, wrongUntil, growlAt].compactMap { $0 }.min()
    }

    /// Applies one event and returns the effects to perform.
    @discardableResult
    public mutating func send(_ event: TrialEvent) -> [TrialEffect] {
        var effects: [TrialEffect] = []
        switch event {
        case .start(let now):
            fire(until: now, &effects)
            guard !started else { break }
            started = true
            trial.startProblemClock(now: now)
            armGrowl(from: now)
        case .tap(let now, let cell):
            fire(until: now, &effects)
            tap(cell, now: now, &effects)
        case .skip(let now):
            fire(until: now, &effects)
            guard started, !blanking, trial.status == .playing, !trial.resolved else { break }
            trial.skipProblem()
            beginBlank(now)
        case .tick(let now):
            fire(until: now, &effects)
        }
        return effects
    }

    private mutating func tap(_ cell: Int, now: Double, _ effects: inout [TrialEffect]) {
        guard started, !blanking, trial.status == .playing, !trial.resolved,
            grid.indices.contains(cell), let value = grid[cell]
        else { return }
        let correct = value == trial.problem.answer
        trial.tapAnswer(isCorrect: correct, now: now)
        if correct {
            effects.append(.correct)
        } else {
            wrongCellIndex = cell
            wrongUntil = now + trialWrongFlashMs
            effects.append(.wrong(cell: cell))
        }
        if trial.resolved { beginBlank(now) }
    }

    private mutating func beginBlank(_ now: Double) {
        blankUntil = now + trialGridBlankMs
        growlAt = nil
    }

    private mutating func armGrowl(from now: Double) {
        growlAt = now + trialGrowlDelayMs(rng: &rng, settings: trial.settings)
    }

    private mutating func deal() {
        let problem = trial.problem
        grid = buildGrid(
            answer: problem.answer, config: trial.settings.config(for: problem.op), layout: layout, rng: &rng)
    }

    /// Fires due deadlines in time order, each at its own time.
    private mutating func fire(until now: Double, _ effects: inout [TrialEffect]) {
        while let at = nextTimerAt, at <= now {
            if at == wrongUntil {
                wrongUntil = nil
                wrongCellIndex = nil
            } else if at == blankUntil {
                blankUntil = nil
                trial.nextProblem(now: at, rng: &rng)
                if trial.status == .complete {
                    effects.append(.completed(trial.outcome))
                } else {
                    deal()
                    armGrowl(from: at)
                }
            } else {
                growlAt = nil
                growls += 1
                effects.append(.growl)
            }
        }
    }
}

extension TrialSession: Sendable where RNG: Sendable {}
extension TrialSession: Equatable where RNG: Equatable {}
