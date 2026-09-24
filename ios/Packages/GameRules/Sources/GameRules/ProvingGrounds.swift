// Proving Grounds — the timed × / ÷ drill for one digit 2–9 and its medals. The
// Swift port of src/rules/provingGrounds.js; golden/proving-grounds.json is the
// check (ProvingGroundsTests).
//
//   provingProblemSet(mode:digit:rng:)            buildProblemSet
//   provingMedal(elapsedSec:wrongCount:settings:) awardMedal
//   provingElapsedSeconds(startMs:nowMs:)         elapsedSeconds
//
// Random draws, in order (part of the rule — the same as the JavaScript): two
// Fisher–Yates shuffles of the 12 facts in listed order, each from the last
// index down, j = floor(next() * (i + 1)) for i = 11 … 1 (11 draws each, 22 in
// all), then the seam swap, which draws nothing.
//
// `ProvingDrill` is the run itself — the part that lives in
// src/pages/ProvingGroundsPage.jsx on the web: the miss that ends a run (the
// first one past the bronze allowance, so a second miss at the default of one
// slip) and the 2-second correction pause after a miss, during which the clock
// keeps running. Like the battle reducer it reads no clock: every call takes
// `now` in milliseconds.

/// Which facts a drill proves.
public enum ProvingMode: String, Sendable, Equatable, CaseIterable, Codable {
    /// 1×d … 12×d.
    case mul
    /// d÷d … 12d÷d.
    case div

    /// The operator as shown in a prompt.
    public var symbol: String {
        switch self {
        case .mul: "×"
        case .div: "÷"
        }
    }
}

/// The digits a drill can prove, `DIGITS` in the JavaScript.
public let provingDigits: [Int] = [2, 3, 4, 5, 6, 7, 8, 9]

/// Problems in a run: each of the 12 facts twice.
public let provingProblemCount = 24

/// One drill problem. `a op b = answer`, shown as `prompt` (e.g. "6 × 2").
public struct ProvingFact: Sendable, Equatable {
    public var a: Int
    public var b: Int
    public var op: ProvingMode
    public var answer: Int
    public var prompt: String

    public init(a: Int, b: Int, op: ProvingMode, answer: Int, prompt: String) {
        self.a = a
        self.b = b
        self.op = op
        self.answer = answer
        self.prompt = prompt
    }
}

/// A medal, ranked bronze < silver < gold, so a saved medal is only ever
/// replaced by a better one (`MEDAL_RANK`).
public enum Medal: String, Sendable, Equatable, CaseIterable, Codable, Comparable {
    case bronze, silver, gold

    public var rank: Int {
        switch self {
        case .bronze: 1
        case .silver: 2
        case .gold: 3
        }
    }

    public static func < (lhs: Medal, rhs: Medal) -> Bool { lhs.rank < rhs.rank }
}

/// Inclusive finish-time ceilings in seconds — `medal_seconds` in the
/// `proving_grounds` section of GET /api/rule-settings.
public struct MedalSeconds: Sendable, Equatable, Decodable {
    public var gold: Double
    public var silver: Double
    public var bronze: Double

    public init(gold: Double, silver: Double, bronze: Double) {
        self.gold = gold
        self.silver = silver
        self.bronze = bronze
    }
}

/// The medal thresholds, decoded straight from the `proving_grounds` section of
/// GET /api/rule-settings (snake-case keys, the served types) —
/// `DEFAULT_PROVING_GROUNDS_SETTINGS` in src/data/ruleSettings.js.
public struct ProvingGroundsSettings: Sendable, Equatable, Decodable {
    public var medalSeconds: MedalSeconds
    /// Slips bronze allows; gold and silver need a perfect run.
    public var maxWrongForBronze: Int

    enum CodingKeys: String, CodingKey {
        case medalSeconds = "medal_seconds"
        case maxWrongForBronze = "max_wrong_for_bronze"
    }

    public init(medalSeconds: MedalSeconds, maxWrongForBronze: Int) {
        self.medalSeconds = medalSeconds
        self.maxWrongForBronze = maxWrongForBronze
    }

    /// The fallback until the server's settings arrive. Must equal the web's
    /// DEFAULT_PROVING_GROUNDS_SETTINGS (and so the server's PROVING_GROUNDS_SETTINGS).
    public static let defaults = ProvingGroundsSettings(
        medalSeconds: MedalSeconds(gold: 45, silver: 60, bronze: 90), maxWrongForBronze: 1)

    /// The miss that ends a run: the first one past the bronze allowance, after
    /// which no medal is possible.
    public var wrongLimit: Int { maxWrongForBronze + 1 }
}

/// The 12 facts for a digit, in listed order (1×d … 12×d / d÷d … 12d÷d).
private func baseFacts(_ mode: ProvingMode, digit: Int) -> [ProvingFact] {
    (1...12).map { i in
        switch mode {
        case .div:
            let dividend = i * digit
            return ProvingFact(a: dividend, b: digit, op: .div, answer: i, prompt: "\(dividend) ÷ \(digit)")
        case .mul:
            return ProvingFact(a: i, b: digit, op: .mul, answer: i * digit, prompt: "\(i) × \(digit)")
        }
    }
}

/// Fisher–Yates from the end, one draw per step.
private func shuffled(_ items: [ProvingFact], rng: inout some RandomSource) -> [ProvingFact] {
    var a = items
    var i = a.count - 1
    while i > 0 {
        let j = Int((rng.next() * Double(i + 1)).rounded(.down))
        a.swapAt(i, j)
        i -= 1
    }
    return a
}

/// The 24 problems of a run: two independent shuffles of the 12 facts, so each
/// fact appears once per half, with the second half's first fact swapped away
/// if it repeats the first half's last — no fact is ever asked back to back.
public func provingProblemSet(mode: ProvingMode, digit: Int, rng: inout some RandomSource) -> [ProvingFact] {
    let first = shuffled(baseFacts(mode, digit: digit), rng: &rng)
    var second = shuffled(baseFacts(mode, digit: digit), rng: &rng)
    if let seam = first.last, second[0].prompt == seam.prompt,
        let i = second.firstIndex(where: { $0.prompt != seam.prompt })
    {
        second.swapAt(0, i)
    }
    return first + second
}

/// The medal a run earns, or nil. Strongest first; ceilings are inclusive.
public func provingMedal(
    elapsedSec: Double, wrongCount: Int, settings: ProvingGroundsSettings = .defaults
) -> Medal? {
    let s = settings.medalSeconds
    if wrongCount == 0 && elapsedSec <= s.gold { return .gold }
    if wrongCount == 0 && elapsedSec <= s.silver { return .silver }
    if wrongCount <= settings.maxWrongForBronze && elapsedSec <= s.bronze { return .bronze }
    return nil
}

/// Seconds between two millisecond readings, never negative.
public func provingElapsedSeconds(startMs: Double, nowMs: Double) -> Double {
    max(0, (nowMs - startMs) / 1000)
}

// MARK: - The run

/// How long the "here's the right answer" card holds after a miss (ms).
public let provingCorrectionMs: Double = 2000

/// A run's result.
public struct ProvingResult: Sendable, Equatable {
    public var elapsedSec: Double
    public var wrongCount: Int
    public var medal: Medal?

    public init(elapsedSec: Double, wrongCount: Int, medal: Medal?) {
        self.elapsedSec = elapsedSec
        self.wrongCount = wrongCount
        self.medal = medal
    }
}

/// One answered problem.
public struct ProvingAnswer: Sendable, Equatable {
    public var fact: ProvingFact
    public var correct: Bool
}

/// One Proving Grounds run, from the first problem to the result. A plain value
/// driven by `answer(_:now:)` and `tick(now:)`; the view schedules a tick at
/// `nextTimerAt` while a correction is showing.
public struct ProvingDrill: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Waiting for an answer to `problems[index]`.
        case asking
        /// A miss: `fact`'s right answer shows until `until`; input is ignored.
        case correcting(fact: ProvingFact, until: Double)
        case finished(ProvingResult)
    }

    /// What an answer did.
    public enum Outcome: Sendable, Equatable {
        case correct
        case wrong
        /// Nothing: a correction is showing or the run is over.
        case ignored
    }

    public let mode: ProvingMode
    public let digit: Int
    public let settings: ProvingGroundsSettings
    public let problems: [ProvingFact]
    public let startMs: Double
    public private(set) var index = 0
    public private(set) var wrongCount = 0
    public private(set) var phase: Phase = .asking
    /// One entry per answered problem, in order: the fact and whether it was right.
    public private(set) var answered: [ProvingAnswer] = []

    public init(
        mode: ProvingMode, digit: Int, settings: ProvingGroundsSettings = .defaults, now: Double,
        rng: inout some RandomSource
    ) {
        self.mode = mode
        self.digit = digit
        self.settings = settings
        self.problems = provingProblemSet(mode: mode, digit: digit, rng: &rng)
        self.startMs = now
    }

    /// The problem being asked (or corrected), nil once finished.
    public var current: ProvingFact? {
        if case .finished = phase { return nil }
        return problems[index]
    }

    public var result: ProvingResult? {
        if case .finished(let r) = phase { return r }
        return nil
    }

    /// When `tick` next has something to do.
    public var nextTimerAt: Double? {
        if case .correcting(_, let until) = phase { return until }
        return nil
    }

    public func elapsedSec(now: Double) -> Double {
        if let result { return result.elapsedSec }
        return provingElapsedSeconds(startMs: startMs, nowMs: now)
    }

    /// Checks `value` against the current problem. A miss shows the correction
    /// for `provingCorrectionMs`; the run then moves on, or ends if that miss
    /// reached `settings.wrongLimit` or was the last problem.
    @discardableResult
    public mutating func answer(_ value: Int, now: Double) -> Outcome {
        tick(now: now)
        guard case .asking = phase else { return .ignored }
        let fact = problems[index]
        let correct = value == fact.answer
        answered.append(ProvingAnswer(fact: fact, correct: correct))
        if correct {
            advance(now: now)
            return .correct
        }
        wrongCount += 1
        phase = .correcting(fact: fact, until: now + provingCorrectionMs)
        return .wrong
    }

    /// Ends a correction whose time is up.
    public mutating func tick(now: Double) {
        guard case .correcting(_, let until) = phase, now >= until else { return }
        if wrongCount >= settings.wrongLimit {
            finish(at: until)
        } else {
            advance(now: until)
        }
    }

    private mutating func advance(now: Double) {
        if index + 1 >= problems.count {
            finish(at: now)
        } else {
            index += 1
            phase = .asking
        }
    }

    private mutating func finish(at now: Double) {
        let elapsed = provingElapsedSeconds(startMs: startMs, nowMs: now)
        phase = .finished(
            ProvingResult(
                elapsedSec: elapsed, wrongCount: wrongCount,
                medal: provingMedal(elapsedSec: elapsed, wrongCount: wrongCount, settings: settings)))
    }
}
