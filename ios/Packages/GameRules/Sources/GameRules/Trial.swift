// The Dragon's Trial — the one-time placement test (docs/TRIAL.md). The Swift
// port of src/rules/dragonTrial.js; golden/trial.json is the check
// (TrialTests replays every run of it).
//
//   TrialState(settings:rng:)                createTrialState
//   state.startProblemClock(now:)            startProblemClock
//   state.tapAnswer(isCorrect:now:)          tapAnswer
//   state.skipProblem()                      skipProblem
//   state.nextProblem(now:rng:)              nextProblem
//   trialOutcome(perOpPoints:settings:)      computeTrialOutcome
//   trialGrowlDelayMs(rng:settings:)         aiGrowlDelayMs
//
// Like the battle reducer, nothing here reads a clock: every step that times a
// problem takes `now` (ms as a Double, any epoch). `TrialSession`
// (TrialSession.swift) adds what the web keeps in useDragonTrial — the grid,
// the wrong-cell flash, the blank between problems and the growl — for a view
// model to drive.
//
// Random draws, in order (part of the rule — the same as the JavaScript): the
// state's init draws the baseline shuffle (Fisher–Yates from the last index
// down, j = floor(next() * (i + 1))), then the first problem; nextProblem
// draws only the next problem. Each problem is `generateProblem` — which draws
// once to pick the op even though the trial config has a single op — retried
// up to settings.uniqueRetries times while its signature was already asked.

/// The ops a trial measures, in the order probing walks them (`TRIAL_OPS`).
public let trialOps: [BattleOp] = [.add, .sub, .mul, .div]

/// Placement walks these, and drops the kid at the start of the first one not
/// mastered (`PLACEMENT_ORDER`). Division has no world of its own yet.
public let trialPlacementOrder: [BattleOp] = [.add, .sub, .mul]

// MARK: - Settings

/// One speed band: a correct answer within `maxMs` of the problem appearing
/// scores `mult` of its base points. nil `maxMs` (JSON null) = no limit.
public struct TrialSpeedBand: Sendable, Equatable, Decodable {
    public var maxMs: Double?
    public var mult: Double

    enum CodingKeys: String, CodingKey {
        case maxMs = "max_ms"
        case mult
    }

    public init(maxMs: Double?, mult: Double) {
        self.maxMs = maxMs
        self.mult = mult
    }
}

/// Lowest normalized score (0–1000) for each confidence band; below
/// `emerging` is not ready.
public struct TrialBandMinScores: Sendable, Equatable, Decodable {
    public var fluent: Double
    public var capable: Double
    public var developing: Double
    public var emerging: Double

    public init(fluent: Double, capable: Double, developing: Double, emerging: Double) {
        self.fluent = fluent
        self.capable = capable
        self.developing = developing
        self.emerging = emerging
    }
}

/// The node each placement op's world starts at.
public struct TrialOpStartNodes: Sendable, Equatable, Decodable {
    public var add: Int
    public var sub: Int
    public var mul: Int

    public init(add: Int, sub: Int, mul: Int) {
        self.add = add
        self.sub = sub
        self.mul = mul
    }

    public subscript(op: BattleOp) -> Int? {
        switch op {
        case .add: add
        case .sub: sub
        case .mul: mul
        case .div: nil
        }
    }
}

/// Every trial tunable, decoded straight from the `trial` section of
/// GET /api/rule-settings (snake-case keys, the served types) —
/// `DEFAULT_TRIAL_SETTINGS` in src/data/ruleSettings.js.
public struct TrialSettings: Sendable, Equatable, Decodable {
    /// Baseline problems per op (add, sub, mul, div), shuffled together.
    public var baselinePerOp: Int
    /// Probe problems for an "uncertain" op, and for a "strong" one.
    public var probeUncertain: Int
    public var probeConfirm: Int
    /// Baseline score at or above which an op is strong, and below which weak.
    public var probeStrongMinScore: Double
    public var probeWeakBelowScore: Double
    /// Hard cap on baseline + probe problems.
    public var maxTotalProblems: Int
    /// Operand range every problem draws from.
    public var rangeMin: Int
    public var rangeMax: Int
    /// Attempts at a not-yet-asked problem before settling for a repeat.
    public var uniqueRetries: Int
    /// Points for a correct tap on the first / second try, before speed.
    public var firstTryPoints: Double
    public var secondTryPoints: Double
    /// The wrong tap that scores a problem 0.
    public var maxAttempts: Int
    public var speedBands: [TrialSpeedBand]
    public var bandMinScores: TrialBandMinScores
    public var opStartNode: TrialOpStartNodes
    /// Where a kid fluent at add, sub and mul lands.
    public var allMasteredNode: Int
    /// The atmospheric growl: growlMs ± (growlJitterFraction / 2), at least growlMinMs.
    public var growlMs: Double
    public var growlJitterFraction: Double
    public var growlMinMs: Double

    enum CodingKeys: String, CodingKey {
        case baselinePerOp = "baseline_per_op"
        case probeUncertain = "probe_uncertain"
        case probeConfirm = "probe_confirm"
        case probeStrongMinScore = "probe_strong_min_score"
        case probeWeakBelowScore = "probe_weak_below_score"
        case maxTotalProblems = "max_total_problems"
        case rangeMin = "range_min"
        case rangeMax = "range_max"
        case uniqueRetries = "unique_retries"
        case firstTryPoints = "first_try_points"
        case secondTryPoints = "second_try_points"
        case maxAttempts = "max_attempts"
        case speedBands = "speed_bands"
        case bandMinScores = "band_min_scores"
        case opStartNode = "op_start_node"
        case allMasteredNode = "all_mastered_node"
        case growlMs = "growl_ms"
        case growlJitterFraction = "growl_jitter_fraction"
        case growlMinMs = "growl_min_ms"
    }

    public init(
        baselinePerOp: Int, probeUncertain: Int, probeConfirm: Int, probeStrongMinScore: Double,
        probeWeakBelowScore: Double, maxTotalProblems: Int, rangeMin: Int, rangeMax: Int, uniqueRetries: Int,
        firstTryPoints: Double, secondTryPoints: Double, maxAttempts: Int, speedBands: [TrialSpeedBand],
        bandMinScores: TrialBandMinScores, opStartNode: TrialOpStartNodes, allMasteredNode: Int,
        growlMs: Double, growlJitterFraction: Double, growlMinMs: Double
    ) {
        self.baselinePerOp = baselinePerOp
        self.probeUncertain = probeUncertain
        self.probeConfirm = probeConfirm
        self.probeStrongMinScore = probeStrongMinScore
        self.probeWeakBelowScore = probeWeakBelowScore
        self.maxTotalProblems = maxTotalProblems
        self.rangeMin = rangeMin
        self.rangeMax = rangeMax
        self.uniqueRetries = uniqueRetries
        self.firstTryPoints = firstTryPoints
        self.secondTryPoints = secondTryPoints
        self.maxAttempts = maxAttempts
        self.speedBands = speedBands
        self.bandMinScores = bandMinScores
        self.opStartNode = opStartNode
        self.allMasteredNode = allMasteredNode
        self.growlMs = growlMs
        self.growlJitterFraction = growlJitterFraction
        self.growlMinMs = growlMinMs
    }

    /// The fallback until the server's settings arrive. Must equal the web's
    /// DEFAULT_TRIAL_SETTINGS (and so the server's TRIAL_SETTINGS).
    public static let defaults = TrialSettings(
        baselinePerOp: 3, probeUncertain: 5, probeConfirm: 2, probeStrongMinScore: 800, probeWeakBelowScore: 400,
        maxTotalProblems: 50, rangeMin: 2, rangeMax: 10, uniqueRetries: 25, firstTryPoints: 200,
        secondTryPoints: 150, maxAttempts: 2,
        speedBands: [
            TrialSpeedBand(maxMs: 4000, mult: 1.0), TrialSpeedBand(maxMs: 8000, mult: 0.9),
            TrialSpeedBand(maxMs: 12000, mult: 0.75), TrialSpeedBand(maxMs: nil, mult: 0.6),
        ],
        bandMinScores: TrialBandMinScores(fluent: 850, capable: 700, developing: 500, emerging: 300),
        opStartNode: TrialOpStartNodes(add: 1, sub: 17, mul: 26), allMasteredNode: 34,
        growlMs: 12000, growlJitterFraction: 0.3, growlMinMs: 4000)

    /// The config every problem for `op` is generated from (`configForOp`).
    public func config(for op: BattleOp) -> BattleConfig {
        BattleConfig(ops: [op], min: rangeMin, max: rangeMax, aiSeconds: 0)
    }
}

// MARK: - Scoring

/// `Math.round`: halves go up.
private func jsRound(_ x: Double) -> Int {
    let floor = x.rounded(.down)
    return Int(x - floor >= 0.5 ? floor + 1 : floor)
}

/// Speed multiplier on a correct answer, by ms from display to the correct
/// tap: the first band whose maxMs the time is within; the last band is
/// open-ended.
public func trialSpeedMultiplier(_ timeMs: Double, settings: TrialSettings = .defaults) -> Double {
    for band in settings.speedBands where band.maxMs.map({ timeMs <= $0 }) ?? true {
        return band.mult
    }
    return settings.speedBands.last?.mult ?? 1
}

/// Points for a correct tap: 1st or 2nd try, scaled by speed.
public func trialPointsForCorrect(wrongTapsBefore: Int, elapsedMs: Double, settings: TrialSettings = .defaults)
    -> Int
{
    let base = wrongTapsBefore == 0 ? settings.firstTryPoints : settings.secondTryPoints
    return jsRound(base * trialSpeedMultiplier(elapsedMs, settings: settings))
}

/// Per-op normalized score (0–1000) out of a first-try maximum per problem;
/// 0 when none were asked.
private func normalizedScore(_ points: [Int], _ settings: TrialSettings) -> Int {
    if points.isEmpty { return 0 }
    let raw = Double(points.reduce(0, +))
    let max = Double(points.count) * settings.firstTryPoints
    return jsRound((raw / max) * 1000)
}

/// A confidence band, strongest first, shown as 1–5 stars.
public enum TrialBand: String, Sendable, Equatable, CaseIterable, Codable {
    case fluent, capable, developing, emerging
    case notReady = "not_ready"

    /// As the results card and the web show it.
    public var label: String {
        switch self {
        case .notReady: "not ready"
        default: rawValue
        }
    }

    public var stars: Int {
        switch self {
        case .fluent: 5
        case .capable: 4
        case .developing: 3
        case .emerging: 2
        case .notReady: 1
        }
    }

    /// The band's lowest score under `settings`.
    public func minScore(_ settings: TrialSettings) -> Double {
        switch self {
        case .fluent: settings.bandMinScores.fluent
        case .capable: settings.bandMinScores.capable
        case .developing: settings.bandMinScores.developing
        case .emerging: settings.bandMinScores.emerging
        case .notReady: 0
        }
    }

    /// The first band, strongest first, whose minimum `score` reaches.
    public static func of(_ score: Int, settings: TrialSettings) -> TrialBand {
        allCases.first { Double(score) >= $0.minScore(settings) } ?? .notReady
    }

    /// Placement's bar: only fluent counts as mastered (`MASTERY_BAND`).
    public static let mastery: TrialBand = .fluent
}

/// Points per problem, by op, in the order they were asked.
public struct TrialPoints: Sendable, Equatable {
    public var add: [Int] = []
    public var sub: [Int] = []
    public var mul: [Int] = []
    public var div: [Int] = []

    public init(add: [Int] = [], sub: [Int] = [], mul: [Int] = [], div: [Int] = []) {
        self.add = add
        self.sub = sub
        self.mul = mul
        self.div = div
    }

    public subscript(op: BattleOp) -> [Int] {
        get {
            switch op {
            case .add: add
            case .sub: sub
            case .mul: mul
            case .div: div
            }
        }
        set {
            switch op {
            case .add: add = newValue
            case .sub: sub = newValue
            case .mul: mul = newValue
            case .div: div = newValue
            }
        }
    }
}

private enum BaselineClass {
    case unknown, strong, weak, uncertain
}

private func classifyBaseline(_ points: [Int], _ settings: TrialSettings) -> BaselineClass {
    if points.isEmpty { return .unknown }
    let score = Double(normalizedScore(points, settings))
    if score >= settings.probeStrongMinScore { return .strong }
    if score < settings.probeWeakBelowScore { return .weak }
    return .uncertain
}

/// The probe problems to append after the baseline. Walks the ops in order;
/// the first weak op stops probing harder ones. Capped at maxTotalProblems.
public func trialProbeSequence(baseline: TrialPoints, baselineCount: Int, settings: TrialSettings = .defaults)
    -> [BattleOp]
{
    var out: [BattleOp] = []
    var total = baselineCount
    var hitWeak = false
    for op in trialOps {
        if total >= settings.maxTotalProblems { break }
        var count = 0
        switch classifyBaseline(baseline[op], settings) {
        case .uncertain: count = settings.probeUncertain
        case .strong where !hitWeak: count = settings.probeConfirm
        case .weak: hitWeak = true
        default: break
        }
        count = min(count, settings.maxTotalProblems - total)
        out.append(contentsOf: Array(repeating: op, count: max(0, count)))
        total += max(0, count)
        if hitWeak { break }
    }
    return out
}

// MARK: - Outcome

/// One op's result.
public struct TrialOpResult: Sendable, Equatable {
    public var score: Int
    public var band: TrialBand
    public var problemsAsked: Int

    public init(score: Int, band: TrialBand, problemsAsked: Int) {
        self.score = score
        self.band = band
        self.problemsAsked = problemsAsked
    }

    public var stars: Int { band.stars }
}

/// What the trial found and where it places the kid.
public struct TrialOutcome: Sendable, Equatable {
    public var add: TrialOpResult
    public var sub: TrialOpResult
    public var mul: TrialOpResult
    public var div: TrialOpResult
    /// Highest fluent op among add/sub/mul (informational).
    public var highestMasteredOp: BattleOp?
    /// The first op in add → sub → mul that isn't fluent; nil when all are.
    public var placementOp: BattleOp?
    /// The node the kid starts at: the placement op's world start, or
    /// allMasteredNode.
    public var targetNodeID: Int

    public subscript(op: BattleOp) -> TrialOpResult {
        switch op {
        case .add: add
        case .sub: sub
        case .mul: mul
        case .div: div
        }
    }
}

/// Scores, bands and placement from the per-op points (`computeTrialOutcome`).
public func trialOutcome(perOpPoints: TrialPoints, settings: TrialSettings = .defaults) -> TrialOutcome {
    func result(_ op: BattleOp) -> TrialOpResult {
        let points = perOpPoints[op]
        let score = normalizedScore(points, settings)
        return TrialOpResult(score: score, band: .of(score, settings: settings), problemsAsked: points.count)
    }
    var outcome = TrialOutcome(
        add: result(.add), sub: result(.sub), mul: result(.mul), div: result(.div),
        highestMasteredOp: nil, placementOp: nil, targetNodeID: settings.allMasteredNode)
    for op in trialPlacementOrder {
        if outcome[op].band == TrialBand.mastery {
            outcome.highestMasteredOp = op
        } else if outcome.placementOp == nil {
            outcome.placementOp = op
        }
    }
    if let op = outcome.placementOp, let node = settings.opStartNode[op] {
        outcome.targetNodeID = node
    }
    return outcome
}

/// Delay before the atmospheric growl: growlMs ± (growlJitterFraction / 2),
/// never under growlMinMs. One draw.
public func trialGrowlDelayMs(rng: inout some RandomSource, settings: TrialSettings = .defaults) -> Double {
    let jitter = settings.growlMs * settings.growlJitterFraction * (rng.next() - 0.5)
    return max(settings.growlMinMs, settings.growlMs + jitter)
}

// MARK: - The trial

/// Stable signature for a problem, so one isn't asked twice. Add and mul are
/// commutative: "2 + 5" and "5 + 2" are the same question to a child.
public func trialProblemSignature(_ p: Problem) -> String {
    switch p.op {
    case .add, .mul:
        let (lo, hi) = p.a <= p.b ? (p.a, p.b) : (p.b, p.a)
        return "\(p.op.rawValue)|\(lo)|\(hi)"
    case .sub, .div:
        return "\(p.op.rawValue)|\(p.a)|\(p.b)"
    }
}

private func uniqueProblem(
    _ op: BattleOp, asked: [String], rng: inout some RandomSource, settings: TrialSettings
) -> Problem {
    let config = settings.config(for: op)
    var candidate = generateProblem(config, rng: &rng)
    if !asked.contains(trialProblemSignature(candidate)) { return candidate }
    var tries = 1
    while tries < settings.uniqueRetries {
        candidate = generateProblem(config, rng: &rng)
        if !asked.contains(trialProblemSignature(candidate)) { return candidate }
        tries += 1
    }
    return candidate
}

public enum TrialPhase: String, Sendable, Equatable {
    case baseline, probe
}

public enum TrialStatus: String, Sendable, Equatable {
    case playing, complete
}

/// The trial as a plain value, the fields the JavaScript's TrialState has.
/// Steps mutate in place and do nothing when the JavaScript would return the
/// state unchanged.
public struct TrialState: Sendable, Equatable {
    /// The tunables it was dealt with; every step reads these.
    public let settings: TrialSettings
    /// Op per problem: the baseline until the probe is decided, then both.
    public private(set) var sequence: [BattleOp]
    public let baselineLength: Int
    /// Position of `problem` in `sequence`.
    public private(set) var index = 0
    /// Stays `.probe` once complete.
    public private(set) var phase: TrialPhase = .baseline
    public private(set) var status: TrialStatus = .playing
    /// On screen.
    public private(set) var problem: Problem
    /// Signature of every problem posed, in order.
    public private(set) var askedSignatures: [String]
    public private(set) var perOpPoints = TrialPoints()
    /// Wrong taps on the current problem.
    public private(set) var wrongTaps = 0
    /// The current problem is scored; taps and skips are ignored.
    public private(set) var resolved = false
    /// When the problem appeared (ms), or nil before the first startProblemClock.
    public private(set) var problemStartedAt: Double?

    /// A freshly dealt trial: the shuffled baseline, then its first problem.
    public init(settings: TrialSettings = .defaults, rng: inout some RandomSource) {
        self.settings = settings
        var seq: [BattleOp] = []
        for op in trialOps {
            seq.append(contentsOf: Array(repeating: op, count: settings.baselinePerOp))
        }
        var i = seq.count - 1
        while i > 0 {
            let j = Int((rng.next() * Double(i + 1)).rounded(.down))
            seq.swapAt(i, j)
            i -= 1
        }
        sequence = seq
        baselineLength = seq.count
        problem = uniqueProblem(seq[0], asked: [], rng: &rng, settings: settings)
        askedSignatures = [trialProblemSignature(problem)]
    }

    /// Starts timing the first problem once it's on screen; later problems are
    /// timed by nextProblem, so this does nothing once a time is set.
    public mutating func startProblemClock(now: Double) {
        if problemStartedAt == nil { problemStartedAt = now }
    }

    private var canAnswer: Bool { status == .playing && !resolved }

    private mutating func resolve(points: Int) {
        resolved = true
        perOpPoints[problem.op].append(points)
    }

    /// A tap on the grid. Correct scores by attempt and speed; the
    /// maxAttempts-th wrong tap scores 0. Either resolves the problem.
    public mutating func tapAnswer(isCorrect: Bool, now: Double) {
        guard canAnswer else { return }
        if isCorrect {
            let startedAt = problemStartedAt ?? now
            resolve(points: trialPointsForCorrect(
                wrongTapsBefore: wrongTaps, elapsedMs: now - startedAt, settings: settings))
            return
        }
        wrongTaps += 1
        if wrongTaps >= settings.maxAttempts { resolve(points: 0) }
    }

    /// "Too hard for me": zero points, resolved.
    public mutating func skipProblem() {
        guard canAnswer else { return }
        resolve(points: 0)
    }

    /// Past a resolved problem: appends the probe once the baseline is done,
    /// then poses the next problem or completes the trial.
    public mutating func nextProblem(now: Double, rng: inout some RandomSource) {
        guard status == .playing, resolved else { return }
        let nextIndex = index + 1
        if phase == .baseline && nextIndex >= baselineLength {
            sequence += trialProbeSequence(baseline: perOpPoints, baselineCount: baselineLength, settings: settings)
            phase = .probe
        }
        if nextIndex >= sequence.count {
            status = .complete
            return
        }
        problem = uniqueProblem(sequence[nextIndex], asked: askedSignatures, rng: &rng, settings: settings)
        askedSignatures.append(trialProblemSignature(problem))
        index = nextIndex
        wrongTaps = 0
        resolved = false
        problemStartedAt = now
    }

    /// The outcome by the trial's own settings.
    public var outcome: TrialOutcome { trialOutcome(perOpPoints: perOpPoints, settings: settings) }
}
