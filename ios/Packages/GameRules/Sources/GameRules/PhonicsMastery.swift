// Phonics mastery — the Swift port of server/lib/phonicsMastery.js, pinned by
// the `mastery` cases of golden/phonics.json, plus the Sound Map's rollups
// (`fullMastery`, `stageSummary`, `overallSummary` in
// src/hooks/usePhonicsProgress.js).
//
// The rule, in short (the JavaScript header argues for each part):
//   1. only an element's last `recentWindow` attempts vote;
//   2. `mastered` needs right answers in at least `modesForMastery` games —
//      one game alone tops out at `solid`;
//   3. a verdict needs a floor of attempts (`minAttemptsSolid`/`Mastered`);
//   4. a solid or mastered element unpractised for `staleAfterDays` is
//      `stale`: flagged for review, never demoted.
//
// Times are milliseconds since 1970 (GameRules imports nothing, so no Date):
// nil is the JavaScript's unparseable date — it sorts as 0 and is never stale.

/// How well a child knows one element, worst to best (`LEVELS`). The order
/// is load-bearing: comparing levels is how "did this improve?" is asked.
public enum PhonicsMasteryLevel: String, Sendable, Hashable, CaseIterable, Comparable, Decodable {
    case new
    case learning
    case solid
    case mastered

    public static func < (lhs: Self, rhs: Self) -> Bool {
        allCases.firstIndex(of: lhs)! < allCases.firstIndex(of: rhs)!
    }
}

/// One answer as the mastery rule reads it: a phonics_attempts row.
public struct PhonicsMasteryAttempt: Sendable, Hashable {
    /// The element asked; nil rows are skipped (`classifyAll`).
    public let elementKey: String?
    /// The game: "choose", "type-it", "find-in-word" or "missing-sound".
    public let mode: String
    public let correct: Bool
    /// For a wrong answer, the element it named; nil otherwise.
    public let chosen: String?
    /// When it was answered, in ms since 1970; nil when unknown.
    public let atMs: Double?

    public init(elementKey: String?, mode: String, correct: Bool, chosen: String? = nil, atMs: Double?) {
        self.elementKey = elementKey
        self.mode = mode
        self.correct = correct
        self.chosen = chosen
        self.atMs = atMs
    }
}

/// One element's verdict (`classifyElement`'s result).
public struct PhonicsElementMastery: Sendable, Hashable {
    public let level: PhonicsMasteryLevel
    /// Attempts in the recent window.
    public let attempts: Int
    /// Right answers in the recent window.
    public let correct: Int
    /// `correct / attempts`; nil with no attempts.
    public let accuracy: Double?
    /// The games answered RIGHT in the window, sorted.
    public let modes: [String]
    /// The newest attempt's time; nil with none or when it's unknown.
    public let lastSeenAtMs: Double?
    /// Solid or mastered, but not practised for `staleAfterDays`.
    public let stale: Bool
    /// Every attempt ever, window or not.
    public let total: Int

    public init(
        level: PhonicsMasteryLevel, attempts: Int, correct: Int, accuracy: Double?, modes: [String],
        lastSeenAtMs: Double?, stale: Bool, total: Int
    ) {
        self.level = level
        self.attempts = attempts
        self.correct = correct
        self.accuracy = accuracy
        self.modes = modes
        self.lastSeenAtMs = lastSeenAtMs
        self.stale = stale
        self.total = total
    }

    /// An element never attempted (`EMPTY_STATE`).
    public static let new = PhonicsElementMastery(
        level: .new, attempts: 0, correct: 0, accuracy: nil, modes: [], lastSeenAtMs: nil, stale: false, total: 0)

    /// The fields a round reads (what GET /api/phonics/mastery reports).
    public var state: PhonicsMasteryState {
        PhonicsMasteryState(level: level.rawValue, stale: stale, accuracy: accuracy)
    }
}

/// A pair a child mixes up: asked `element`, answered `chose`, `count` times.
public struct PhonicsConfusion: Sendable, Hashable {
    public let element: String
    public let chose: String
    public let count: Int

    public init(element: String, chose: String, count: Int) {
        self.element = element
        self.chose = chose
        self.count = count
    }
}

public enum PhonicsMastery {
    /// Attempts considered per element (`RECENT_WINDOW`).
    public static let recentWindow = 10
    public static let minAttemptsSolid = 4
    public static let minAttemptsMastered = 6
    public static let solidAccuracy = 0.75
    public static let masteredAccuracy = 0.9
    public static let modesForMastery = 2
    /// After this long unpractised, a solid/mastered element is stale.
    public static let staleAfterDays = 45

    private static let dayMs = 86_400_000.0

    /// Judge one element from its attempts, newest first (`classifyElement`).
    public static func classifyElement(_ attempts: [PhonicsMasteryAttempt], nowMs: Double) -> PhonicsElementMastery {
        let recent = Array(attempts.prefix(recentWindow))
        guard let newest = recent.first else { return .new }

        let correct = recent.filter(\.correct).count
        let accuracy = Double(correct) / Double(recent.count)
        // Only games answered right count: being wrong in three games is not
        // three kinds of evidence.
        let modes = Array(Set(recent.filter(\.correct).map(\.mode))).sorted()

        var level = PhonicsMasteryLevel.learning
        if recent.count >= minAttemptsMastered && accuracy >= masteredAccuracy && modes.count >= modesForMastery {
            level = .mastered
        } else if recent.count >= minAttemptsSolid && accuracy >= solidAccuracy {
            level = .solid
        }

        let lastSeen = newest.atMs
        let stale = level != .learning && lastSeen.map { nowMs - $0 > Double(staleAfterDays) * dayMs } == true

        return PhonicsElementMastery(
            level: level, attempts: recent.count, correct: correct, accuracy: accuracy, modes: modes,
            lastSeenAtMs: lastSeen, stale: stale, total: attempts.count)
    }

    /// Judge every element attempted, from rows in any order (`classifyAll`).
    /// Elements never attempted are absent: `overview` fills them in as new.
    /// Rows with the same time keep their order (the JavaScript sort is stable).
    public static func classifyAll(_ rows: [PhonicsMasteryAttempt], nowMs: Double) -> [String: PhonicsElementMastery] {
        var byElement: [String: [(Int, PhonicsMasteryAttempt)]] = [:]
        for (index, row) in rows.enumerated() {
            guard let key = row.elementKey, !key.isEmpty else { continue }
            byElement[key, default: []].append((index, row))
        }
        var out: [String: PhonicsElementMastery] = [:]
        for (key, attempts) in byElement {
            let newestFirst = attempts.sorted { a, b in
                let at = a.1.atMs ?? 0, bt = b.1.atMs ?? 0
                return at != bt ? at > bt : a.0 < b.0
            }
            out[key] = classifyElement(newestFirst.map(\.1), nowMs: nowMs)
        }
        return out
    }

    /// The pairs a child actually mixes up, strongest first (`confusionPairs`):
    /// wrong answers that named another element, at least twice.
    public static func confusionPairs(_ rows: [PhonicsMasteryAttempt], limit: Int = 8) -> [PhonicsConfusion] {
        var order: [String: Int] = [:]
        var pairs: [PhonicsConfusion] = []
        for row in rows where !row.correct {
            guard let element = row.elementKey, !element.isEmpty, let chose = row.chosen, !chose.isEmpty,
                chose != element
            else { continue }
            let id = "\(element)\t\(chose)"
            if let at = order[id] {
                pairs[at] = PhonicsConfusion(element: element, chose: chose, count: pairs[at].count + 1)
            } else {
                order[id] = pairs.count
                pairs.append(PhonicsConfusion(element: element, chose: chose, count: 1))
            }
        }
        // A single slip is noise; two of the same mistake is a pattern.
        return Array(
            pairs.enumerated()
                .filter { $0.1.count >= 2 }
                .sorted { a, b in
                    if a.1.count != b.1.count { return a.1.count > b.1.count }
                    if a.1.element != b.1.element { return a.1.element < b.1.element }
                    return a.0 < b.0
                }
                .prefix(limit)
                .map(\.1))
    }

    /// The round builder's view of a verdict map.
    public static func states(_ mastery: [String: PhonicsElementMastery]) -> [String: PhonicsMasteryState] {
        mastery.mapValues(\.state)
    }
}

// MARK: - The Sound Map's rollups

/// How many elements sit at each level, and how many are stale.
public struct PhonicsMasteryCounts: Sendable, Hashable {
    public var new = 0
    public var learning = 0
    public var solid = 0
    public var mastered = 0
    public var stale = 0

    public init() {}

    public subscript(level: PhonicsMasteryLevel) -> Int {
        get {
            switch level {
            case .new: new
            case .learning: learning
            case .solid: solid
            case .mastered: mastered
            }
        }
        set {
            switch level {
            case .new: new = newValue
            case .learning: learning = newValue
            case .solid: solid = newValue
            case .mastered: mastered = newValue
            }
        }
    }

    mutating func add(_ state: PhonicsElementMastery) {
        self[state.level] += 1
        if state.stale { stale += 1 }
    }
}

/// One stage's line on the Sound Map and its card in the stage picker
/// (`stageSummary`).
public struct PhonicsStageSummary: Sendable, Hashable, Identifiable {
    public let stage: PhonicsStage
    public let elements: [PhonicsElement]
    public let counts: PhonicsMasteryCounts

    public var id: Int { stage.stage }
    public var total: Int { elements.count }
    public var mastered: Int { counts.mastered }
    /// Mastered only, on purpose: "solid or better" would let a child who has
    /// only played one game show a full bar.
    public var percent: Int { PhonicsMasteryOverview.percent(counts.mastered, of: total) }
    /// Everything met at all.
    public var touched: Int { total - counts.new }
}

/// The whole curriculum with a verdict for every element, including those
/// never attempted (`fullMastery` + `stageSummary` + `overallSummary`).
public struct PhonicsMasteryOverview: Sendable, Hashable {
    /// Every curriculum element's verdict.
    public let elements: [String: PhonicsElementMastery]
    public let stages: [PhonicsStageSummary]
    /// Program-wide.
    public let overall: PhonicsMasteryCounts

    public var total: Int { PhonicsElement.all.count }
    public var percent: Int { Self.percent(overall.mastered, of: total) }

    /// - Parameter mastery: `classifyAll`'s verdicts; missing elements are new.
    public init(_ mastery: [String: PhonicsElementMastery]) {
        var full: [String: PhonicsElementMastery] = [:]
        var overall = PhonicsMasteryCounts()
        for element in PhonicsElement.all {
            let state = mastery[element.key] ?? .new
            full[element.key] = state
            overall.add(state)
        }
        elements = full
        self.overall = overall
        stages = PhonicsStage.all.map { stage in
            let members = stage.elements
            var counts = PhonicsMasteryCounts()
            for element in members { counts.add(full[element.key] ?? .new) }
            return PhonicsStageSummary(stage: stage, elements: members, counts: counts)
        }
    }

    public subscript(key: String) -> PhonicsElementMastery { elements[key] ?? .new }

    /// `Math.round(part / whole * 100)`, 0 for an empty whole.
    static func percent(_ part: Int, of whole: Int) -> Int {
        whole == 0 ? 0 : Int((Double(part) / Double(whole) * 100).rounded())
    }
}
