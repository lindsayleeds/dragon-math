// Dragon Egg Hatchery — twelve problems on one base number and operation
// (base op 1 … base op 12), each hatching an egg into a baby dragon when
// solved. The Swift port of src/rules/eggHatchery.js; golden/egg-hatchery.json
// is the check (EggHatcheryTests).
//
//   hatcheryProblem(base:multiplier:op:)          buildProblem
//   hatcheryProblems(_:base:rng:)                 generateProblems
//   hatcheryAnswerButtons(correct:rng:)           generateAnswerButtons
//   hatcheryShuffledButtons(_:rng:)               shuffleAnswerButtons
//   hatcheryAnswerChoices(correct:rng:)           buildAnswerChoices
//   hatcheryHintOfferDelayMs(rng:settings:)       hintOfferDelayMs
//   hatcheryPickDragonID(pool:rng:)               pickDragonId
//   hatcheryHintText(_:base:multiplier:hintLevel:rng:)  getHintText
//   hatcheryFormatTime(_:)                        formatTime
//   hatcheryTier(elapsedSeconds:settings:)        calculateMasteryTier (the tier)
//
// Random draws, in order (part of the rule — the same as the JavaScript):
//   - problems: one Fisher–Yates of the 12, from the end — 11 draws,
//     j = floor(next() * (i + 1)) for i = 11 … 1.
//   - answer buttons: 4 draws for the "plausible" distractors
//     (floor(next() * (max - min + 1)) + min each), then one draw per button
//     picked from the de-duplicated list (idx = floor(next() * remaining))
//     until there are 4 buttons or the list runs out; correct answer first.
//   - shuffling the buttons: a Fisher–Yates from the end (count - 1 draws).
//   - hint offer delay: one draw, hint_delay_min_ms + next() * hint_delay_spread_ms.
//   - dragon: one draw — floor(next() * pool.count) into the pool, or
//     floor(next() * hatcheryFallbackDragonCount) + 1 with no pool.
//   - hint text: one draw (2–4 extra skip-count numbers), only for a shown
//     multiplication hint.
// A round draws the problems, then per problem its answer choices and hint
// delay, then its dragon when it hatches; a hint's text is drawn when the kid
// opens it.
//
// `HatcheryRound` is the round itself — the timers and state that live in
// src/components/DragonEggHatchery.jsx on the web: the 800 ms hatch, the
// 500 ms "try again", the hint offer, and the 300 ms beat before the
// achievement. Like ProvingDrill it reads no clock: every call takes `now` in
// milliseconds.

/// Problems in a round.
public let hatcherySize = 12

/// Answer buttons per problem (fewer when the answer is too small for three
/// distinct positive distractors).
public let hatcheryAnswerButtonCount = 4

/// The dragon art range an egg hatches from before the catalog has synced —
/// `DRAGON_PNG_COUNT` in src/data/dragonRarity.js.
public let hatcheryFallbackDragonCount = 253

/// One problem. `operand1 op operand2 = correctAnswer`; `id` and `multiplier`
/// are the i in base op i.
public struct HatcheryProblem: Sendable, Equatable, Hashable {
    public var id: Int
    public var multiplier: Int
    public var operand1: Int
    public var operand2: Int
    public var correctAnswer: Int

    public init(id: Int, multiplier: Int, operand1: Int, operand2: Int, correctAnswer: Int) {
        self.id = id
        self.multiplier = multiplier
        self.operand1 = operand1
        self.operand2 = operand2
        self.correctAnswer = correctAnswer
    }
}

/// Seconds UNDER which each tier is earned — `tier_seconds` in the
/// `egg_hatchery` section of GET /api/rule-settings.
public struct HatcheryTierSeconds: Sendable, Equatable, Codable {
    public var legendary: Double
    public var gold: Double
    public var silver: Double

    public init(legendary: Double, gold: Double, silver: Double) {
        self.legendary = legendary
        self.gold = gold
        self.silver = silver
    }
}

/// The hatchery's tunables, decoded straight from the `egg_hatchery` section
/// of GET /api/rule-settings (snake-case keys, the served types) —
/// `DEFAULT_EGG_HATCHERY_SETTINGS` in src/data/ruleSettings.js.
public struct EggHatcherySettings: Sendable, Equatable, Codable {
    public var tierSeconds: HatcheryTierSeconds
    /// A hint is offered hintDelayMinMs + next() × hintDelaySpreadMs into a problem.
    public var hintDelayMinMs: Double
    public var hintDelaySpreadMs: Double

    enum CodingKeys: String, CodingKey {
        case tierSeconds = "tier_seconds"
        case hintDelayMinMs = "hint_delay_min_ms"
        case hintDelaySpreadMs = "hint_delay_spread_ms"
    }

    public init(tierSeconds: HatcheryTierSeconds, hintDelayMinMs: Double, hintDelaySpreadMs: Double) {
        self.tierSeconds = tierSeconds
        self.hintDelayMinMs = hintDelayMinMs
        self.hintDelaySpreadMs = hintDelaySpreadMs
    }

    /// The fallback until the server's settings arrive. Must equal the web's
    /// DEFAULT_EGG_HATCHERY_SETTINGS (and so the server's EGG_HATCHERY_SETTINGS).
    public static let defaults = EggHatcherySettings(
        tierSeconds: HatcheryTierSeconds(legendary: 15, gold: 25, silver: 40),
        hintDelayMinMs: 5000, hintDelaySpreadMs: 2000)

    /// The web converter's checks (`eggHatcherySettingsFromServer`): a
    /// negative value falls back to its default.
    public func validated() -> EggHatcherySettings {
        let d = Self.defaults
        func ok(_ v: Double, _ fallback: Double) -> Double { v >= 0 ? v : fallback }
        return EggHatcherySettings(
            tierSeconds: HatcheryTierSeconds(
                legendary: ok(tierSeconds.legendary, d.tierSeconds.legendary),
                gold: ok(tierSeconds.gold, d.tierSeconds.gold),
                silver: ok(tierSeconds.silver, d.tierSeconds.silver)),
            hintDelayMinMs: ok(hintDelayMinMs, d.hintDelayMinMs),
            hintDelaySpreadMs: ok(hintDelaySpreadMs, d.hintDelaySpreadMs))
    }
}

/// How well a whole round went, by time.
public enum HatcheryTier: String, Sendable, Equatable, CaseIterable, Codable {
    case legendary, gold, silver, bronze
}

private func draw(_ n: Int, _ rng: inout some RandomSource) -> Int {
    Int((rng.next() * Double(n)).rounded(.down))
}

/// Fisher–Yates from the end, one draw per step.
private func shuffled<T>(_ items: [T], rng: inout some RandomSource) -> [T] {
    var a = items
    var i = a.count - 1
    while i > 0 {
        a.swapAt(i, draw(i + 1, &rng))
        i -= 1
    }
    return a
}

/// The two operands and answer of base op i. Division comes from the times
/// table so it always divides cleanly ((base × i) ÷ base = i); subtraction
/// takes the smaller from the larger, so nothing goes negative.
public func hatcheryProblem(base: Int, multiplier i: Int, op: BattleOp) -> HatcheryProblem {
    let (a, b, answer): (Int, Int, Int)
    switch op {
    case .mul: (a, b, answer) = (base, i, base * i)
    case .div: (a, b, answer) = (base * i, base, i)
    case .add: (a, b, answer) = (base, i, base + i)
    case .sub: (a, b, answer) = (max(base, i), min(base, i), abs(base - i))
    }
    return HatcheryProblem(id: i, multiplier: i, operand1: a, operand2: b, correctAnswer: answer)
}

/// base op 1 … base op 12, shuffled.
public func hatcheryProblems(_ op: BattleOp, base: Int, rng: inout some RandomSource) -> [HatcheryProblem] {
    shuffled((1...hatcherySize).map { hatcheryProblem(base: base, multiplier: $0, op: op) }, rng: &rng)
}

/// Up to 4 buttons, the correct answer first, then distractors from off-by-one
/// and -two slips and random values within ±5 (all positive).
public func hatcheryAnswerButtons(correct: Int, rng: inout some RandomSource) -> [Int] {
    var distractors = [correct - 1, correct + 1, correct - 2, correct + 2]
    let lo = max(1, correct - 5)
    let hi = correct + 5
    for _ in 0..<4 {
        distractors.append(draw(hi - lo + 1, &rng) + lo)
    }
    // `[...new Set(list)]`: first appearances, in order.
    var seen = Set<Int>()
    var unique = distractors.filter { seen.insert($0).inserted && $0 != correct && $0 > 0 }
    var buttons = [correct]
    while buttons.count < hatcheryAnswerButtonCount && !unique.isEmpty {
        buttons.append(unique.remove(at: draw(unique.count, &rng)))
    }
    return buttons
}

public func hatcheryShuffledButtons(_ buttons: [Int], rng: inout some RandomSource) -> [Int] {
    shuffled(buttons, rng: &rng)
}

/// A problem's buttons as the screen shows them.
public func hatcheryAnswerChoices(correct: Int, rng: inout some RandomSource) -> [Int] {
    hatcheryShuffledButtons(hatcheryAnswerButtons(correct: correct, rng: &rng), rng: &rng)
}

/// How long (ms) a kid sits on a problem before a hint is offered.
public func hatcheryHintOfferDelayMs(rng: inout some RandomSource, settings: EggHatcherySettings = .defaults) -> Double {
    settings.hintDelayMinMs + rng.next() * settings.hintDelaySpreadMs
}

/// A baby dragon id: from the synced catalog's `pool` when there is one, else
/// the fallback art range 1 … hatcheryFallbackDragonCount.
public func hatcheryPickDragonID(pool: [Int]?, rng: inout some RandomSource) -> Int {
    if let pool, !pool.isEmpty {
        return pool[draw(pool.count, &rng)]
    }
    return draw(hatcheryFallbackDragonCount, &rng) + 1
}

/// A problem's hint: multiplication only, a skip-count from 1× up to the
/// answer plus 2–4 numbers beyond it, never past 15×. nil otherwise (and
/// with the hint hidden, `hintLevel` 0), drawing nothing.
public func hatcheryHintText(
    _ op: BattleOp, base: Int, multiplier: Int, hintLevel: Int, rng: inout some RandomSource
) -> String? {
    guard op == .mul, hintLevel != 0 else { return nil }
    let extra = draw(3, &rng) + 2
    let top = min(15, multiplier + extra)
    // 1× … multiplier×, then the extras up to `top` (none past 15×).
    let last = max(multiplier, top)
    let counts = last >= 1 ? (1...last).map { String(base * $0) } : []
    return "Skip-count: " + counts.joined(separator: ", ")
}

/// Seconds as `m:ss` from a minute up, `Ns` below.
public func hatcheryFormatTime(_ seconds: Double) -> String {
    let mins = Int((seconds / 60).rounded(.down))
    let secs = Int(seconds.truncatingRemainder(dividingBy: 60).rounded(.down))
    if mins > 0 {
        return "\(mins):" + (secs < 10 ? "0\(secs)" : "\(secs)")
    }
    return "\(secs)s"
}

/// The tier for finishing all 12 in `elapsedSeconds`; each is earned UNDER
/// its time.
public func hatcheryTier(elapsedSeconds: Double, settings: EggHatcherySettings = .defaults) -> HatcheryTier {
    let t = settings.tierSeconds
    if elapsedSeconds < t.legendary { return .legendary }
    if elapsedSeconds < t.gold { return .gold }
    if elapsedSeconds < t.silver { return .silver }
    return .bronze
}

// MARK: - The round

/// How long a solved egg cracks before its dragon appears (ms).
public let hatcheryHatchMs: Double = 800
/// How long a wrong button stays marked (ms).
public let hatcheryWrongMs: Double = 500
/// The beat between the last dragon and the achievement (ms).
public let hatcheryFinishMs: Double = 300

/// A baby dragon, hatched from one problem.
public struct HatchedDragon: Sendable, Equatable, Hashable {
    public var problemID: Int
    public var dragonID: Int

    public init(problemID: Int, dragonID: Int) {
        self.problemID = problemID
        self.dragonID = dragonID
    }
}

/// A solved problem, for attempt logging (`attempt` on the server).
public struct HatcheryAttempt: Sendable, Equatable {
    public var problem: HatcheryProblem
    /// From the problem appearing to its right answer, wrong taps included.
    public var timeMs: Double
    public var wrongTaps: Int

    public init(problem: HatcheryProblem, timeMs: Double, wrongTaps: Int) {
        self.problem = problem
        self.timeMs = timeMs
        self.wrongTaps = wrongTaps
    }
}

/// How a whole round went.
public struct HatcheryResult: Sendable, Equatable {
    public var elapsedSeconds: Double
    public var tier: HatcheryTier

    public init(elapsedSeconds: Double, tier: HatcheryTier) {
        self.elapsedSeconds = elapsedSeconds
        self.tier = tier
    }
}

/// One Egg Hatchery round, from the first egg to the achievement. A plain
/// value driven by `answer(_:now:)`, `toggleHint(rng:)` and
/// `tick(now:rng:)`; the view schedules a tick at `nextTimerAt`.
public struct HatcheryRound: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Waiting for an answer; `wrongButton` is marked until `until` after a miss.
        case asking(wrongButton: Int?, until: Double?)
        /// Solved with `button`: the egg cracks until `until`, then hatches.
        case hatching(button: Int, until: Double)
        /// All 12 hatched; the achievement shows at `until`.
        case finishing(until: Double)
        case finished(HatcheryResult)
    }

    public enum Outcome: Sendable, Equatable {
        case correct
        case wrong
        /// Nothing: an egg is hatching or the round is over.
        case ignored
    }

    public let operation: BattleOp
    public let baseNumber: Int
    /// The dragon ids an egg can become (nil: the fallback range).
    public let pool: [Int]?
    public let settings: EggHatcherySettings
    public let problems: [HatcheryProblem]
    public let startMs: Double
    public private(set) var index = 0
    public private(set) var phase: Phase = .asking(wrongButton: nil, until: nil)
    /// The current problem's buttons.
    public private(set) var choices: [Int] = []
    /// When the hint is offered; nil once offered or cancelled by a tap.
    public private(set) var hintOfferAt: Double?
    /// The "Need a hand?" button shows.
    public private(set) var hintOffered = false
    /// The open hint's text (nil while hidden, or for a problem with none).
    public private(set) var hintText: String?
    /// The hint is open (`hintLevel` 1 on the web).
    public private(set) var hintShown = false
    public private(set) var dragons: [HatchedDragon] = []
    /// One per solved problem, in order.
    public private(set) var attempts: [HatcheryAttempt] = []
    private var problemStartMs: Double
    private var wrongTaps = 0

    public init(
        operation: BattleOp, baseNumber: Int, pool: [Int]?, settings: EggHatcherySettings = .defaults,
        now: Double, rng: inout some RandomSource
    ) {
        self.operation = operation
        self.baseNumber = baseNumber
        self.pool = pool
        self.settings = settings
        self.problems = hatcheryProblems(operation, base: baseNumber, rng: &rng)
        self.startMs = now
        self.problemStartMs = now
        present(now: now, rng: &rng)
    }

    /// The problem on screen, nil once all have hatched.
    public var current: HatcheryProblem? {
        switch phase {
        case .asking, .hatching: problems[index]
        case .finishing, .finished: nil
        }
    }

    public var hatchedCount: Int { dragons.count }

    public var result: HatcheryResult? {
        if case .finished(let r) = phase { return r }
        return nil
    }

    /// When `tick` next has something to do.
    public var nextTimerAt: Double? {
        switch phase {
        case .asking(_, let until):
            [until, hintOfferAt].compactMap { $0 }.min()
        case .hatching(_, let until), .finishing(let until):
            until
        case .finished:
            nil
        }
    }

    /// The kid tapped button `button`. Any tap cancels a hint offer not yet
    /// shown (as the web clears its timer on every tap).
    public mutating func answer(_ button: Int, now: Double) -> Outcome {
        guard case .asking = phase, choices.indices.contains(button) else { return .ignored }
        hintOfferAt = nil
        hintOffered = false
        if choices[button] == problems[index].correctAnswer {
            attempts.append(HatcheryAttempt(
                problem: problems[index], timeMs: max(0, now - problemStartMs), wrongTaps: wrongTaps))
            phase = .hatching(button: button, until: now + hatcheryHatchMs)
            return .correct
        }
        wrongTaps += 1
        phase = .asking(wrongButton: button, until: now + hatcheryWrongMs)
        return .wrong
    }

    /// Opens or closes the hint. Opening a multiplication hint draws its text.
    public mutating func toggleHint(rng: inout some RandomSource) {
        guard let problem = current else { return }
        if hintShown {
            hintShown = false
            hintText = nil
        } else {
            hintShown = true
            hintText = hatcheryHintText(
                operation, base: baseNumber, multiplier: problem.multiplier, hintLevel: 1, rng: &rng)
        }
    }

    /// Runs every deadline at or before `now`, each at its own time.
    public mutating func tick(now: Double, rng: inout some RandomSource) {
        while let at = nextTimerAt, at <= now {
            fire(at: at, rng: &rng)
        }
    }

    private mutating func fire(at: Double, rng: inout some RandomSource) {
        switch phase {
        case .asking(let wrong, let until):
            if let offer = hintOfferAt, offer <= at {
                hintOfferAt = nil
                hintOffered = true
            }
            if wrong != nil, let until, until <= at {
                phase = .asking(wrongButton: nil, until: nil)
            }
        case .hatching:
            dragons.append(HatchedDragon(
                problemID: problems[index].id, dragonID: hatcheryPickDragonID(pool: pool, rng: &rng)))
            if dragons.count == problems.count {
                phase = .finishing(until: at + hatcheryFinishMs)
            } else {
                index += 1
                present(now: at, rng: &rng)
            }
        case .finishing:
            let elapsed = (at - startMs) / 1000
            phase = .finished(HatcheryResult(elapsedSeconds: elapsed, tier: hatcheryTier(elapsedSeconds: elapsed, settings: settings)))
        case .finished:
            break
        }
    }

    /// Shows `problems[index]`: its buttons, then its hint timer.
    private mutating func present(now: Double, rng: inout some RandomSource) {
        choices = hatcheryAnswerChoices(correct: problems[index].correctAnswer, rng: &rng)
        hintOfferAt = now + hatcheryHintOfferDelayMs(rng: &rng, settings: settings)
        hintOffered = false
        hintShown = false
        hintText = nil
        problemStartMs = now
        wrongTaps = 0
        phase = .asking(wrongButton: nil, until: nil)
    }
}
