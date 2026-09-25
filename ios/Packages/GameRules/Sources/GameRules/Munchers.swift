// Dragon Munchers — the Swift port of the clock-driven reducer in
// src/rules/munchers.js, pinned by golden/munchers.json: the board, the level
// sequence, monster spawning and movement, collisions, lives, scoring, level
// progression and game over.
//
//   MunchersState(operation:baseNumber:progression:highScore:settings:rng:)   createMunchersState
//   stepMunchers(state, event, rng:) → MunchersStep                            stepMunchers
//   state.nextTimerAt, isFrozen, currentBase, isCorrectValue(_:),
//   totalCorrect, maxEnemies, enemyInterval                                    derived values
//
// Nothing here reads a clock: time arrives on every event as `now` (ms, any
// epoch — only differences matter) and randomness from `rng`. An event that
// changes nothing returns the input state with `changed == false`, so a caller
// can skip a re-render.
//
// The rules, copied from the JavaScript module header (read it for the why):
//
// Frozen — before `start`, after game over, during the level splash and during
// the gobble beat. Frozen monsters neither spawn nor move and `eat`/`tapCell`
// are refused; `move` is still accepted unless not started or game over (the
// on-screen arrows always moved the muncher). The wrong-answer message does
// NOT freeze play; dismissing it costs a life.
//
// Timers — fired in (at, id) order, each AT its own `at`, so a late tick
// replays exactly what on-time ticks would have (a repeating timer catches up
// one step at a time, keeping its id):
//   spawn         every settings.spawnIntervalMs: add a monster if there's room
//   enemyPlan     every enemyInterval: each monster turns toward its next cell
//                 (the telegraph) and an enemyCommit is scheduled
//   enemyCommit   settings.enemyTelegraphMs after a plan: the monsters step
//   caughtEnd     settings.caughtBeatMs after a catch: lose a life, back to start
// Whenever play unfreezes, spawn and then enemyPlan are armed afresh from that
// moment; a change of maxEnemies restarts spawn and a change of enemyInterval
// restarts enemyPlan (dropping a pending commit). Freezing cancels spawn,
// enemyPlan and enemyCommit; caughtEnd is never cancelled. After every fired
// timer and after the event itself: a monster on an unfrozen muncher catches
// it, a game that just ended is reported, then the clocks are re-synced.
//
// Random draws, in order (part of the rule):
//   create:          levels (progression only), then the board
//   levels:          shuffle(progressionEasy), then shuffle(progressionHard)
//   board:           shuffle of the cell indices 0..<totalCells, then one draw
//                    per distractor cell, j = floor(rng() * pool.count)
//   configChanged:   levels if progression or baseNumber changed, then the
//                    board if operation or currentBase changed
//   advanceLevel:    the board, if currentBase changed
//   eat (correct):   one draw for the baby dragon's emoji
//   spawn:           one draw, only when there is room and a safe cell
//   enemyPlan:       per monster in array order: one draw (chase if < chaseChance),
//                    plus one to pick a direction when it wanders
//   shuffle:         Fisher–Yates from the last index down, j = floor(rng() * (i + 1))

// MARK: - Settings

/// The Munchers tunables, decoded straight from the `munchers` section of
/// GET /api/rule-settings (snake-case keys, the served types) —
/// DEFAULT_MUNCHERS_SETTINGS in src/data/ruleSettings.js.
public struct MunchersSettings: Sendable, Equatable, Decodable {
    public var startingLives: Int
    /// Bases up to this are worth `easyPoints` a correct answer; above, `hardPoints`.
    public var easyMaxBase: Int
    public var easyPoints: Int
    public var hardPoints: Int
    public var enemyMoveIntervalMs: Double
    /// How long a monster faces its next cell before stepping.
    public var enemyTelegraphMs: Double
    public var spawnIntervalMs: Double
    /// The gobble beat before a caught muncher loses a life.
    public var caughtBeatMs: Double
    /// Share of moves (0–1) where a monster chases rather than wanders.
    public var chaseChance: Double
    /// Campaign bases played first, shuffled; then the hard ones, shuffled.
    public var progressionEasy: [Int]
    public var progressionHard: [Int]
    public var enemySpeedupPerLevelMs: Double
    public var minEnemyIntervalMs: Double
    public var levelsPerExtraEnemy: Int
    public var maxEnemies: Int

    enum CodingKeys: String, CodingKey {
        case startingLives = "starting_lives"
        case easyMaxBase = "easy_max_base"
        case easyPoints = "easy_points"
        case hardPoints = "hard_points"
        case enemyMoveIntervalMs = "enemy_move_interval_ms"
        case enemyTelegraphMs = "enemy_telegraph_ms"
        case spawnIntervalMs = "spawn_interval_ms"
        case caughtBeatMs = "caught_beat_ms"
        case chaseChance = "chase_chance"
        case progressionEasy = "progression_easy"
        case progressionHard = "progression_hard"
        case enemySpeedupPerLevelMs = "enemy_speedup_per_level_ms"
        case minEnemyIntervalMs = "min_enemy_interval_ms"
        case levelsPerExtraEnemy = "levels_per_extra_enemy"
        case maxEnemies = "max_enemies"
    }

    public init(
        startingLives: Int, easyMaxBase: Int, easyPoints: Int, hardPoints: Int,
        enemyMoveIntervalMs: Double, enemyTelegraphMs: Double, spawnIntervalMs: Double, caughtBeatMs: Double,
        chaseChance: Double, progressionEasy: [Int], progressionHard: [Int],
        enemySpeedupPerLevelMs: Double, minEnemyIntervalMs: Double, levelsPerExtraEnemy: Int, maxEnemies: Int
    ) {
        self.startingLives = startingLives
        self.easyMaxBase = easyMaxBase
        self.easyPoints = easyPoints
        self.hardPoints = hardPoints
        self.enemyMoveIntervalMs = enemyMoveIntervalMs
        self.enemyTelegraphMs = enemyTelegraphMs
        self.spawnIntervalMs = spawnIntervalMs
        self.caughtBeatMs = caughtBeatMs
        self.chaseChance = chaseChance
        self.progressionEasy = progressionEasy
        self.progressionHard = progressionHard
        self.enemySpeedupPerLevelMs = enemySpeedupPerLevelMs
        self.minEnemyIntervalMs = minEnemyIntervalMs
        self.levelsPerExtraEnemy = levelsPerExtraEnemy
        self.maxEnemies = maxEnemies
    }

    /// The fallback until the server's settings arrive. Must equal the web's
    /// DEFAULT_MUNCHERS_SETTINGS (and so the server's served values).
    public static let defaults = MunchersSettings(
        startingLives: 3, easyMaxBase: 5, easyPoints: 5, hardPoints: 10,
        enemyMoveIntervalMs: 3000, enemyTelegraphMs: 750, spawnIntervalMs: 4000, caughtBeatMs: 1000,
        chaseChance: 0.6, progressionEasy: [2, 3, 4, 5], progressionHard: [6, 7, 8, 9],
        enemySpeedupPerLevelMs: 220, minEnemyIntervalMs: 1100, levelsPerExtraEnemy: 3, maxEnemies: 3)

    /// Served values checked like the web's munchersSettingsFromServer: each
    /// field a rule couldn't survive falls back to its default on its own.
    public static func served(
        startingLives: Int, easyMaxBase: Int, easyPoints: Int, hardPoints: Int,
        enemyMoveIntervalMs: Int, enemyTelegraphMs: Int, spawnIntervalMs: Int, caughtBeatMs: Int,
        chaseChance: Double, progressionEasy: [Int], progressionHard: [Int],
        enemySpeedupPerLevelMs: Int, minEnemyIntervalMs: Int, levelsPerExtraEnemy: Int, maxEnemies: Int
    ) -> MunchersSettings {
        let d = defaults
        func positive(_ v: Int, _ fallback: Int) -> Int { v >= 1 ? v : fallback }
        func positive(_ v: Int, _ fallback: Double) -> Double { v >= 1 ? Double(v) : fallback }
        func count(_ v: Int, _ fallback: Int) -> Int { v >= 0 ? v : fallback }
        func count(_ v: Int, _ fallback: Double) -> Double { v >= 0 ? Double(v) : fallback }
        func bases(_ list: [Int], _ fallback: [Int]) -> [Int] {
            !list.isEmpty && list.allSatisfy { $0 >= 1 } ? list : fallback
        }
        return MunchersSettings(
            startingLives: positive(startingLives, d.startingLives),
            easyMaxBase: count(easyMaxBase, d.easyMaxBase),
            easyPoints: count(easyPoints, d.easyPoints),
            hardPoints: count(hardPoints, d.hardPoints),
            enemyMoveIntervalMs: positive(enemyMoveIntervalMs, d.enemyMoveIntervalMs),
            enemyTelegraphMs: count(enemyTelegraphMs, d.enemyTelegraphMs),
            spawnIntervalMs: positive(spawnIntervalMs, d.spawnIntervalMs),
            caughtBeatMs: count(caughtBeatMs, d.caughtBeatMs),
            chaseChance: chaseChance.isFinite && chaseChance >= 0 && chaseChance <= 1 ? chaseChance : d.chaseChance,
            progressionEasy: bases(progressionEasy, d.progressionEasy),
            progressionHard: bases(progressionHard, d.progressionHard),
            enemySpeedupPerLevelMs: count(enemySpeedupPerLevelMs, d.enemySpeedupPerLevelMs),
            minEnemyIntervalMs: positive(minEnemyIntervalMs, d.minEnemyIntervalMs),
            levelsPerExtraEnemy: positive(levelsPerExtraEnemy, d.levelsPerExtraEnemy),
            maxEnemies: positive(maxEnemies, d.maxEnemies))
    }
}

// MARK: - Plain data

public enum MunchersDirection: String, Sendable, Equatable, CaseIterable {
    case up, down, left, right
}

/// Which way a monster looks: dead-on while resting, or the way it is about
/// to step (the telegraph).
public enum MunchersFacing: String, Sendable, Equatable {
    case center, up, down, left, right
}

public struct MunchersEnemy: Sendable, Equatable, Identifiable {
    public var id: Int
    public var position: Int
    public var facing: MunchersFacing
    /// The planned cell during the telegraph (kept after the step), or nil for
    /// a monster that has never been planned.
    public var nextPosition: Int?

    public init(id: Int, position: Int, facing: MunchersFacing, nextPosition: Int?) {
        self.id = id
        self.position = position
        self.facing = facing
        self.nextPosition = nextPosition
    }
}

/// One baby dragon per correct answer eaten this level.
public struct MunchersBabyDragon: Sendable, Equatable, Identifiable {
    /// "<level>-<n>".
    public var id: String
    public var emoji: String

    public init(id: String, emoji: String) {
        self.id = id
        self.emoji = emoji
    }
}

/// The wrong-answer message, as it was when eaten.
public struct MunchersWrongAnswer: Sendable, Equatable {
    public var operation: BattleOp
    public var baseNumber: Int
    public var value: Int

    public init(operation: BattleOp, baseNumber: Int, value: Int) {
        self.operation = operation
        self.baseNumber = baseNumber
        self.value = value
    }
}

public enum MunchersTimerKind: String, Sendable, Equatable {
    case spawn, enemyPlan, enemyCommit, caughtEnd
}

public struct MunchersTimer: Sendable, Equatable {
    public var id: Int
    public var kind: MunchersTimerKind
    public var at: Double

    public init(id: Int, kind: MunchersTimerKind, at: Double) {
        self.id = id
        self.kind = kind
        self.at = at
    }
}

public enum MunchersEvent: Sendable, Equatable {
    /// The child leaves the start screen.
    case start(now: Double)
    /// Fire every timer due by `now`.
    case tick(now: Double)
    case move(now: Double, direction: MunchersDirection)
    /// Eat the number under the muncher.
    case eat(now: Double)
    /// Eat if it is the muncher's cell, step if orthogonally adjacent.
    case tapCell(now: Double, cell: Int)
    /// Close the wrong-answer message: −1 life.
    case dismissWrongAnswer(now: Double)
    /// Leave the level splash.
    case advanceLevel(now: Double)
    /// New launch facts: re-plan levels and re-deal the board as needed.
    case configChanged(now: Double, operation: BattleOp, baseNumber: Int, progression: Bool)

    public var now: Double {
        switch self {
        case .start(let now), .tick(let now), .move(let now, _), .eat(let now), .tapCell(let now, _),
             .dismissWrongAnswer(let now), .advanceLevel(let now), .configChanged(let now, _, _, _):
            now
        }
    }
}

public enum MunchersSound: String, Sendable, Equatable {
    case correct, wrong, caught
}

/// What the caller must do.
public enum MunchersEffect: Sendable, Equatable {
    case sound(MunchersSound)
    /// The game ended on a new best.
    case saveHighScore(score: Int)
    /// The game just ended (the leaderboard).
    case gameOver(score: Int)
}

// MARK: - The board (code, not settings)

public enum Munchers {
    public static let gridCols = 5
    public static let gridRows = 6
    public static let totalCells = gridCols * gridRows
    /// The muncher starts (and restarts after a catch) in the bottom-right corner.
    public static let startCell = totalCells - 1
    /// Times tables run up to ×12, so each game covers the full 1…12 table.
    public static let maxFactor = 12
    public static let babyDragonEmojis = ["🐉", "🦕", "🦖", "🐲"]

    /// Fisher–Yates from the end, one draw per step.
    public static func shuffle<T>(_ values: [T], rng: inout some RandomSource) -> [T] {
        var out = values
        var i = out.count - 1
        while i > 0 {
            let j = draw(i + 1, &rng)
            out.swapAt(i, j)
            i -= 1
        }
        return out
    }

    /// The positive, distinct answers `base op i` for i = 1…12, in that order.
    public static func correctAnswers(_ operation: BattleOp, _ baseNumber: Int) -> [Int] {
        var out: [Int] = []
        for i in 1...maxFactor {
            let v = value(operation, baseNumber, i)
            if v >= 1 && !out.contains(v) { out.append(v) }
        }
        return out
    }

    /// `base op i`, flooring division as the web does.
    static func value(_ operation: BattleOp, _ baseNumber: Int, _ i: Int) -> Int {
        switch operation {
        case .mul: baseNumber * i
        case .add: baseNumber + i
        case .sub: baseNumber - i
        case .div: floorDiv(baseNumber, i)
        }
    }

    /// Largest number allowed on the grid, so distractors stay in range with
    /// the answers (multiples of 3 → nothing bigger than 12 × 3 = 36).
    public static func maxValue(_ operation: BattleOp, _ baseNumber: Int) -> Int {
        switch operation {
        case .mul: baseNumber * maxFactor
        case .add: baseNumber + maxFactor
        case .sub, .div: baseNumber
        }
    }

    public static func pointsForBase(_ baseNumber: Int, settings: MunchersSettings = .defaults) -> Int {
        baseNumber <= settings.easyMaxBase ? settings.easyPoints : settings.hardPoints
    }

    /// The campaign: the easy bases shuffled, then the hard ones.
    public static func buildLevels(
        progression: Bool, baseNumber: Int, settings: MunchersSettings = .defaults, rng: inout some RandomSource
    ) -> [Int] {
        guard progression else { return [baseNumber] }
        let easy = shuffle(settings.progressionEasy, rng: &rng)
        let hard = shuffle(settings.progressionHard, rng: &rng)
        return easy + hard
    }

    /// Every correct answer on a random cell, then the other cells filled with
    /// in-range numbers that are NOT answers. A cell stays nil when there is
    /// nothing valid to show.
    public static func generateBoard(_ operation: BattleOp, _ baseNumber: Int, rng: inout some RandomSource) -> [Int?] {
        let correct = correctAnswers(operation, baseNumber)
        let maxValue = maxValue(operation, baseNumber)
        var board = [Int?](repeating: nil, count: totalCells)
        let positions = shuffle(Array(0..<totalCells), rng: &rng)
        let numCorrect = min(correct.count, totalCells)
        for i in 0..<numCorrect { board[positions[i]] = correct[i] }
        var pool: [Int] = []
        if maxValue >= 1 {
            for v in 1...maxValue where !correct.contains(v) { pool.append(v) }
        }
        guard !pool.isEmpty else { return board }
        for i in numCorrect..<totalCells {
            board[positions[i]] = pool[draw(pool.count, &rng)]
        }
        return board
    }

    public static func row(_ cell: Int) -> Int { cell / gridCols }
    public static func col(_ cell: Int) -> Int { cell % gridCols }

    /// The cell one step from `cell`, or `cell` itself at the edge.
    public static func step(from cell: Int, _ direction: MunchersDirection) -> Int {
        var r = row(cell), c = col(cell)
        switch direction {
        case .up where r > 0: r -= 1
        case .down where r < gridRows - 1: r += 1
        case .left where c > 0: c -= 1
        case .right where c < gridCols - 1: c += 1
        default: break
        }
        return r * gridCols + c
    }

    /// A random free cell that isn't the player's or any of the eight touching
    /// it (Chebyshev distance > 1), or nil when there is none.
    public static func pickSpawnPosition(muncher: Int, occupied: [Int], rng: inout some RandomSource) -> Int? {
        let mr = row(muncher), mc = col(muncher)
        var candidates: [Int] = []
        for i in 0..<totalCells where !occupied.contains(i) {
            if max(abs(row(i) - mr), abs(col(i) - mc)) > 1 { candidates.append(i) }
        }
        guard !candidates.isEmpty else { return nil }
        return candidates[draw(candidates.count, &rng)]
    }

    /// Where a monster steps next (chase the muncher chaseChance of the time —
    /// diagonally if need be — otherwise wander one orthogonal step) and which
    /// way it looks while doing it (horizontal lean wins on a diagonal).
    public static func planEnemyMove(
        position: Int, muncher: Int, settings: MunchersSettings = .defaults, rng: inout some RandomSource
    ) -> (newPosition: Int, facing: MunchersFacing) {
        let r = row(position), c = col(position)
        var nr = r, nc = c
        if rng.next() < settings.chaseChance {
            let mr = row(muncher), mc = col(muncher)
            if r < mr { nr += 1 } else if r > mr { nr -= 1 }
            if c < mc { nc += 1 } else if c > mc { nc -= 1 }
        } else {
            var dirs: [MunchersDirection] = []
            if r > 0 { dirs.append(.up) }
            if r < gridRows - 1 { dirs.append(.down) }
            if c > 0 { dirs.append(.left) }
            if c < gridCols - 1 { dirs.append(.right) }
            if !dirs.isEmpty {
                switch dirs[draw(dirs.count, &rng)] {
                case .up: nr -= 1
                case .down: nr += 1
                case .left: nc -= 1
                case .right: nc += 1
                }
            }
        }
        let facing: MunchersFacing =
            nc < c ? .left : nc > c ? .right : nr < r ? .up : nr > r ? .down : .center
        return (nr * gridCols + nc, facing)
    }

    /// The fact a number eaten on a `base` board stands for, for recording it
    /// as an attempt: `base op operandB = answer`, with `answer` the correct
    /// answer nearest `value` (the value itself when it is correct; the
    /// smaller factor on a tie). Nil when the board has no answers at all. Not
    /// part of the web rule — the web game records no attempts.
    public static func nearestFact(to value: Int, operation: BattleOp, baseNumber: Int) -> (operandB: Int, answer: Int)? {
        var best: (operandB: Int, answer: Int)?
        for i in 1...maxFactor {
            let answer = Munchers.value(operation, baseNumber, i)
            guard answer >= 1 else { continue }
            if best.map({ abs(answer - value) < abs($0.answer - value) }) ?? true { best = (i, answer) }
        }
        return best
    }

    /// floor(rng() * n).
    static func draw(_ n: Int, _ rng: inout some RandomSource) -> Int {
        Int((rng.next() * Double(n)).rounded(.down))
    }

    /// Math.floor(a / b) for positive b.
    static func floorDiv(_ a: Int, _ b: Int) -> Int {
        let q = a / b
        return (a % b != 0 && a < 0) ? q - 1 : q
    }
}

// MARK: - State

/// A whole game, as plain data. Field for field the JavaScript state.
public struct MunchersState: Sendable, Equatable {
    public var settings: MunchersSettings
    public var operation: BattleOp
    /// The base the game was opened with.
    public var baseNumber: Int
    /// The multi-level campaign.
    public var progression: Bool
    /// Base number of each level.
    public var levels: [Int]
    /// Index into `levels`.
    public var level: Int
    /// gridCols × gridRows, row-major.
    public var board: [Int?]
    /// Cells eaten this level, in eating order.
    public var eaten: [Int]
    /// The player's cell.
    public var muncher: Int
    public var enemies: [MunchersEnemy]
    /// Never reset, even across levels.
    public var nextEnemyId: Int
    public var lives: Int
    public var score: Int
    /// Best score before (or, once beaten, including) this game.
    public var highScore: Int
    public var isNewHighScore: Bool
    /// Correct answers eaten this level.
    public var correctEaten: Int
    public var babyDragons: [MunchersBabyDragon]
    public var wrongAnswer: MunchersWrongAnswer?
    /// False on the start screen.
    public var started: Bool
    /// The "level cleared" splash is up.
    public var levelTransition: Bool
    /// Where a monster caught the muncher, during the gobble beat.
    public var caughtAt: Int?
    public var gameOver: Bool
    public var timers: [MunchersTimer]
    public var nextTimerId: Int

    /// A dealt game on the start screen: the board is on the table but no
    /// clock runs until `.start`. Draws the levels, then the board.
    public init(
        operation: BattleOp, baseNumber: Int, progression: Bool = false, highScore: Int = 0,
        settings: MunchersSettings = .defaults, rng: inout some RandomSource
    ) {
        self.settings = settings
        self.operation = operation
        self.baseNumber = baseNumber
        self.progression = progression
        levels = Munchers.buildLevels(progression: progression, baseNumber: baseNumber, settings: settings, rng: &rng)
        level = 0
        board = []
        eaten = []
        muncher = Munchers.startCell
        enemies = []
        nextEnemyId = 0
        lives = settings.startingLives
        score = 0
        self.highScore = highScore
        isNewHighScore = false
        correctEaten = 0
        babyDragons = []
        wrongAnswer = nil
        started = false
        levelTransition = false
        caughtAt = nil
        gameOver = false
        timers = []
        nextTimerId = 1
        board = Munchers.generateBoard(operation, currentBase, rng: &rng)
    }

    /// Every field, for resuming or tests.
    public init(
        settings: MunchersSettings, operation: BattleOp, baseNumber: Int, progression: Bool, levels: [Int],
        level: Int, board: [Int?], eaten: [Int], muncher: Int, enemies: [MunchersEnemy], nextEnemyId: Int,
        lives: Int, score: Int, highScore: Int, isNewHighScore: Bool, correctEaten: Int,
        babyDragons: [MunchersBabyDragon], wrongAnswer: MunchersWrongAnswer?, started: Bool,
        levelTransition: Bool, caughtAt: Int?, gameOver: Bool, timers: [MunchersTimer], nextTimerId: Int
    ) {
        self.settings = settings
        self.operation = operation
        self.baseNumber = baseNumber
        self.progression = progression
        self.levels = levels
        self.level = level
        self.board = board
        self.eaten = eaten
        self.muncher = muncher
        self.enemies = enemies
        self.nextEnemyId = nextEnemyId
        self.lives = lives
        self.score = score
        self.highScore = highScore
        self.isNewHighScore = isNewHighScore
        self.correctEaten = correctEaten
        self.babyDragons = babyDragons
        self.wrongAnswer = wrongAnswer
        self.started = started
        self.levelTransition = levelTransition
        self.caughtAt = caughtAt
        self.gameOver = gameOver
        self.timers = timers
        self.nextTimerId = nextTimerId
    }

    // MARK: Derived values

    /// This level's base number.
    public var currentBase: Int {
        levels.indices.contains(level) ? levels[level] : baseNumber
    }

    public func isCorrectValue(_ value: Int?) -> Bool {
        guard let value else { return false }
        return Munchers.correctAnswers(operation, currentBase).contains(value)
    }

    /// Correct answers on this level's board.
    public var totalCorrect: Int {
        let correct = Munchers.correctAnswers(operation, currentBase)
        return board.reduce(0) { n, v in v.map(correct.contains) == true ? n + 1 : n }
    }

    /// A new monster joins every levelsPerExtraEnemy cleared levels (at most
    /// settings.maxEnemies)…
    public var maxEnemies: Int {
        progression ? min(settings.maxEnemies, 1 + level / settings.levelsPerExtraEnemy) : 1
    }

    /// …and they speed up every level (never faster than minEnemyIntervalMs).
    public var enemyInterval: Double {
        progression
            ? max(settings.minEnemyIntervalMs, settings.enemyMoveIntervalMs - Double(level) * settings.enemySpeedupPerLevelMs)
            : settings.enemyMoveIntervalMs
    }

    public var isFrozen: Bool { !started || gameOver || levelTransition || caughtAt != nil }

    /// The earliest pending deadline, for the caller to schedule a `.tick` at.
    public var nextTimerAt: Double? { earliestTimerIndex.map { timers[$0].at } }
}

public struct MunchersStep: Sendable, Equatable {
    public var state: MunchersState
    public var effects: [MunchersEffect]
    /// False when the event changed nothing (`state` is then the input).
    public var changed: Bool

    public init(state: MunchersState, effects: [MunchersEffect], changed: Bool) {
        self.state = state
        self.effects = effects
        self.changed = changed
    }
}

/// Applies one event: first fires every timer due by `event.now`, then the
/// event itself. Draws only from `rng`, in the order the header documents.
public func stepMunchers(_ state: MunchersState, _ event: MunchersEvent, rng: inout some RandomSource) -> MunchersStep {
    var s = state
    var effects: [MunchersEffect] = []
    let now = event.now
    var changed = s.advance(to: now, rng: &rng, effects: &effects)
    let afterTimers = s

    switch event {
    case .tick:
        break
    case .start:
        if !s.started {
            s.started = true
            changed = true
        }
    case .move(_, let direction):
        let moved = s.move(direction)
        changed = moved || changed
    case .eat:
        let ate = s.eat(rng: &rng, effects: &effects)
        changed = ate || changed
    case .tapCell(_, let cell):
        let tapped = s.tapCell(cell, rng: &rng, effects: &effects)
        changed = tapped || changed
    case .dismissWrongAnswer:
        if s.wrongAnswer != nil && !s.gameOver {
            s.wrongAnswer = nil
            s.loseLife()
            changed = true
        }
    case .advanceLevel:
        if s.levelTransition {
            s.advanceLevel(rng: &rng)
            changed = true
        }
    case .configChanged(_, let operation, let baseNumber, let progression):
        let reconfigured = s.configChanged(
            operation: operation, baseNumber: baseNumber, progression: progression, rng: &rng)
        changed = reconfigured || changed
    }

    guard changed else { return MunchersStep(state: state, effects: effects, changed: false) }
    s.settle(from: afterTimers, now: now, effects: &effects)
    return MunchersStep(state: s, effects: effects, changed: true)
}

// MARK: - Internals

extension MunchersState {
    var earliestTimerIndex: Int? {
        var best: Int?
        for i in timers.indices {
            guard let b = best else { best = i; continue }
            let t = timers[i], bt = timers[b]
            if t.at < bt.at || (t.at == bt.at && t.id < bt.id) { best = i }
        }
        return best
    }

    mutating func addTimer(_ kind: MunchersTimerKind, at: Double, id: Int? = nil) {
        let id = id ?? nextTimerId
        timers.append(MunchersTimer(id: id, kind: kind, at: at))
        if id == nextTimerId { nextTimerId += 1 }
    }

    mutating func cancelTimers(_ kind: MunchersTimerKind) {
        timers.removeAll { $0.kind == kind }
    }

    /// Fires every timer due by `now`, earliest first, settling after each.
    /// Returns whether anything fired.
    mutating func advance(to now: Double, rng: inout some RandomSource, effects: inout [MunchersEffect]) -> Bool {
        var fired = false
        while let i = earliestTimerIndex, timers[i].at <= now {
            let before = self
            let due = timers.remove(at: i)
            fire(due, rng: &rng)
            settle(from: before, now: due.at, effects: &effects)
            fired = true
        }
        return fired
    }

    mutating func fire(_ timer: MunchersTimer, rng: inout some RandomSource) {
        let at = timer.at
        switch timer.kind {
        case .spawn:
            addTimer(.spawn, at: at + settings.spawnIntervalMs, id: timer.id)
            guard enemies.count < maxEnemies else { break }
            guard let position = Munchers.pickSpawnPosition(
                muncher: muncher, occupied: enemies.map(\.position), rng: &rng) else { break }
            enemies.append(MunchersEnemy(id: nextEnemyId, position: position, facing: .center, nextPosition: nil))
            nextEnemyId += 1
        case .enemyPlan:
            addTimer(.enemyPlan, at: at + enemyInterval, id: timer.id)
            // Plan every monster's step, then settle conflicts so no two claim
            // the same cell: each holds its cell unless its target is free of
            // every other monster's settled cell (two may swap, never stack).
            var plans: [(newPosition: Int, facing: MunchersFacing)] = []
            for e in enemies {
                plans.append(Munchers.planEnemyMove(position: e.position, muncher: muncher, settings: settings, rng: &rng))
            }
            var finals = enemies.map(\.position)
            for i in finals.indices {
                let target = plans[i].newPosition
                if !finals.indices.contains(where: { $0 != i && finals[$0] == target }) { finals[i] = target }
            }
            for i in enemies.indices {
                enemies[i].facing = finals[i] != enemies[i].position ? plans[i].facing : .center
                enemies[i].nextPosition = finals[i]
            }
            addTimer(.enemyCommit, at: at + settings.enemyTelegraphMs)
        case .enemyCommit:
            // The planned cell stays recorded; a monster spawned since the plan
            // holds its cell.
            for i in enemies.indices {
                enemies[i].position = enemies[i].nextPosition ?? enemies[i].position
                enemies[i].facing = .center
            }
        case .caughtEnd:
            // Dock a life, send the muncher back, clear away the monster(s) that got it.
            let caught = caughtAt
            loseLife()
            muncher = Munchers.startCell
            enemies.removeAll { $0.position == caught }
            caughtAt = nil
        }
    }

    mutating func loseLife() {
        lives -= 1
        if lives <= 0 { gameOver = true }
    }

    /// After a change prev → self at `now`: catch the muncher if it shares a
    /// cell with a monster, report a game that just ended, and start or stop
    /// the clocks.
    mutating func settle(from prev: MunchersState, now: Double, effects: inout [MunchersEffect]) {
        if !isFrozen && enemies.contains(where: { $0.position == muncher }) {
            effects.append(.sound(.caught))
            caughtAt = muncher
            addTimer(.caughtEnd, at: now + settings.caughtBeatMs)
        }
        if gameOver && !prev.gameOver {
            if score > highScore {
                isNewHighScore = true
                highScore = score
                effects.append(.saveHighScore(score: score))
            }
            effects.append(.gameOver(score: score))
        }
        syncClocks(from: prev, now: now)
    }

    mutating func syncClocks(from prev: MunchersState, now: Double) {
        let runs = !isFrozen
        let ran = !prev.isFrozen
        guard runs else {
            if ran {
                cancelTimers(.spawn)
                cancelTimers(.enemyPlan)
                cancelTimers(.enemyCommit)
            }
            return
        }
        if !ran || prev.maxEnemies != maxEnemies {
            cancelTimers(.spawn)
            addTimer(.spawn, at: now + settings.spawnIntervalMs)
        }
        if !ran || prev.enemyInterval != enemyInterval {
            cancelTimers(.enemyPlan)
            cancelTimers(.enemyCommit)
            addTimer(.enemyPlan, at: now + enemyInterval)
        }
    }

    mutating func move(_ direction: MunchersDirection) -> Bool {
        guard started && !gameOver else { return false }
        let next = Munchers.step(from: muncher, direction)
        guard next != muncher else { return false }
        muncher = next
        return true
    }

    mutating func eat(rng: inout some RandomSource, effects: inout [MunchersEffect]) -> Bool {
        guard !isFrozen, !eaten.contains(muncher), let value = board[muncher] else { return false }
        eaten.append(muncher)
        let base = currentBase
        if isCorrectValue(value) {
            effects.append(.sound(.correct))
            score += Munchers.pointsForBase(base, settings: settings)
            correctEaten += 1
            let emoji = Munchers.babyDragonEmojis[Munchers.draw(Munchers.babyDragonEmojis.count, &rng)]
            babyDragons.append(MunchersBabyDragon(id: "\(level)-\(correctEaten)", emoji: emoji))
            // Cleared the board: on to the next level, or that's the game.
            if correctEaten == totalCorrect {
                if progression && level < levels.count - 1 { levelTransition = true } else { gameOver = true }
            }
        } else {
            effects.append(.sound(.wrong))
            wrongAnswer = MunchersWrongAnswer(operation: operation, baseNumber: base, value: value)
        }
        return true
    }

    mutating func tapCell(_ cell: Int, rng: inout some RandomSource, effects: inout [MunchersEffect]) -> Bool {
        guard !isFrozen else { return false }
        if cell == muncher { return eat(rng: &rng, effects: &effects) }
        let dr = Munchers.row(cell) - Munchers.row(muncher)
        let dc = Munchers.col(cell) - Munchers.col(muncher)
        // Only orthogonal neighbours; anything else is ignored.
        guard abs(dr) + abs(dc) == 1 else { return false }
        if dr < 0 { return move(.up) }
        if dr > 0 { return move(.down) }
        if dc < 0 { return move(.left) }
        return move(.right)
    }

    /// Next base number: a fresh board, keeping lives and score.
    mutating func advanceLevel(rng: inout some RandomSource) {
        let oldBase = currentBase
        level += 1
        muncher = Munchers.startCell
        enemies = []
        eaten = []
        correctEaten = 0
        babyDragons = []
        wrongAnswer = nil
        levelTransition = false
        if currentBase != oldBase { board = Munchers.generateBoard(operation, currentBase, rng: &rng) }
    }

    /// The launch facts changed under the game: re-plan the levels (keyed on
    /// progression and baseNumber) and re-deal the board (keyed on operation
    /// and the current base) as needed; nothing else resets.
    mutating func configChanged(
        operation newOperation: BattleOp, baseNumber newBase: Int, progression newProgression: Bool,
        rng: inout some RandomSource
    ) -> Bool {
        let oldBase = currentBase
        let oldOperation = operation
        var changed = false
        if newProgression != progression || newBase != baseNumber {
            levels = Munchers.buildLevels(progression: newProgression, baseNumber: newBase, settings: settings, rng: &rng)
            progression = newProgression
            baseNumber = newBase
            changed = true
        }
        if newOperation != oldOperation {
            operation = newOperation
            changed = true
        }
        if newOperation != oldOperation || currentBase != oldBase {
            board = Munchers.generateBoard(newOperation, currentBase, rng: &rng)
        }
        return changed
    }
}
