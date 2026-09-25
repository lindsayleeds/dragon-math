// Event payloads. Each is a `Codable` struct with a stable `kind`; renaming a
// kind or a field changes what's stored and uploaded, so add new ones instead.

/// A kid beat a map node's battle.
public struct NodeWon: EventPayload, Hashable {
    public static let kind: EventKind = "node.won"

    public let nodeID: Int
    /// Stars earned, 0–3. Optional because the first events were recorded
    /// without it; those upload as 0 and the server keeps a node's best.
    public let stars: Int?

    enum CodingKeys: String, CodingKey {
        case nodeID = "nodeId"
        case stars
    }

    public init(nodeID: Int, stars: Int? = nil) {
        self.nodeID = nodeID
        self.stars = stars
    }
}

/// A kid won dragons (a prize draw, a game's reward). An id appears once per
/// dragon won, so the same dragon twice is `[5, 5]`.
public struct DragonsCollected: EventPayload, Hashable {
    public static let kind: EventKind = "dragons.collected"

    public let dragonIDs: [Int]

    enum CodingKeys: String, CodingKey {
        case dragonIDs = "dragonIds"
    }

    public init(dragonIDs: [Int]) {
        self.dragonIDs = dragonIDs
    }
}

/// A kid answered one problem in a game (the Egg Hatchery's twelve, for
/// now). Uploads as the sync kind `attempt`, which is telemetry: nothing is
/// derived from it on the device, and it stays behind for a child whose
/// parent turned telemetry off.
public struct ProblemAttempted: EventPayload, Hashable {
    public static let kind: EventKind = "problem.attempted"

    /// The story node, or 0 for a Learning Lair game.
    public let nodeID: Int
    /// The problem as shown: `operandA op operandB = answer`.
    public let operandA: Int
    public let operandB: Int
    /// "add", "sub", "mul" or "div" (GameRules' `BattleOp.rawValue`).
    public let op: String
    public let answer: Int
    /// Who got it: "child" or "ai".
    public let outcome: String
    /// How long the answer took, in whole milliseconds.
    public let timeMs: Int?

    enum CodingKeys: String, CodingKey {
        case nodeID = "nodeId"
        case operandA, operandB, op, answer, outcome, timeMs
    }

    public init(nodeID: Int, operandA: Int, operandB: Int, op: String, answer: Int, outcome: String, timeMs: Int?) {
        self.nodeID = nodeID
        self.operandA = operandA
        self.operandB = operandB
        self.op = op
        self.answer = answer
        self.outcome = outcome
        self.timeMs = timeMs
    }
}

/// A kid finished a Proving Grounds drill with a medal. Runs that earn none
/// aren't recorded (the web doesn't post them either).
public struct ProvingMedalEarned: EventPayload, Hashable {
    public static let kind: EventKind = "proving.medal"

    /// "mul" or "div" (`ProvingMode.rawValue` in GameRules).
    public let mode: String
    /// 2–9.
    public let digit: Int
    /// "bronze", "silver" or "gold" (`Medal.rawValue`).
    public let medal: String
    /// Finish time in whole milliseconds.
    public let elapsedMs: Int
    public let wrongCount: Int

    public init(mode: String, digit: Int, medal: String, elapsedMs: Int, wrongCount: Int) {
        self.mode = mode
        self.digit = digit
        self.medal = medal
        self.elapsedMs = elapsedMs
        self.wrongCount = wrongCount
    }

    /// The level it was earned on, e.g. "mul-7" — the key the web uses too.
    public var level: String { "\(mode)-\(digit)" }
}

/// A kid picked the companion dragon they take into battle. The latest one
/// recorded is the profile's companion (`ProfileProgress.companionID`).
public struct CompanionChosen: EventPayload, Hashable {
    public static let kind: EventKind = "companion.chosen"

    /// A companion id from the catalog (GameRules `Companion.id`), e.g. "pip".
    public let companionID: String

    enum CodingKeys: String, CodingKey {
        case companionID = "companionId"
    }

    public init(companionID: String) {
        self.companionID = companionID
    }
}

/// A kid picked a font theme in Settings. The latest one recorded is the
/// profile's font (`ProfileProgress.fontThemeID`); it uploads as the sync kind
/// `font_chosen`, which sets the `font` the web reads for the child.
public struct FontChosen: EventPayload, Hashable {
    public static let kind: EventKind = "font.chosen"

    /// A theme id from src/data/fontThemes.js (the app's `FontTheme.id`),
    /// e.g. "clean".
    public let fontThemeID: String

    enum CodingKeys: String, CodingKey {
        case fontThemeID = "fontThemeId"
    }

    public init(fontThemeID: String) {
        self.fontThemeID = fontThemeID
    }
}

/// A kid completed a whole Memorize passage the server assigned them, at one
/// difficulty. Uploads as the sync kind `memorize_progress`; the server checks
/// the passage still has this wording and revision (an edit resets mastery).
public struct MemorizePassageCompleted: EventPayload, Hashable {
    public static let kind: EventKind = "memorize.passage_completed"

    /// The server's passage id.
    public let passageID: Int
    /// `easy`, `medium` or `hard` (GameRules' `MemorizeDifficulty` raw value).
    public let difficulty: String
    /// The passage's body exactly as practised.
    public let body: String
    /// The passage's `updated_at` exactly as the server sent it: which
    /// revision was practised.
    public let revision: String

    enum CodingKeys: String, CodingKey {
        case passageID = "passageId"
        case difficulty, body, revision
    }

    public init(passageID: Int, difficulty: String, body: String, revision: String) {
        self.passageID = passageID
        self.difficulty = difficulty
        self.body = body
        self.revision = revision
    }
}

/// A kid completed one of the app's bundled sample passages, at one
/// difficulty. Samples exist only on the device, so this never uploads.
public struct MemorizeSampleCompleted: EventPayload, Hashable {
    public static let kind: EventKind = "memorize.sample_completed"

    /// The bundled sample's id.
    public let sampleID: String
    /// `easy`, `medium` or `hard`.
    public let difficulty: String

    enum CodingKeys: String, CodingKey {
        case sampleID = "sampleId"
        case difficulty
    }

    public init(sampleID: String, difficulty: String) {
        self.sampleID = sampleID
        self.difficulty = difficulty
    }
}

/// A kid finished the Dragon's Trial, the one-time placement test
/// (docs/TRIAL.md). Its placement moves the map: the frontier jumps to
/// `targetNodeID` and every node before it counts as won with 3 stars — what
/// the server writes for a trial (POST /api/dragon-trial/complete and the
/// `trial_completed` sync kind), so the map looks the same before and after
/// the upload.
public struct TrialCompleted: EventPayload, Hashable {
    public static let kind: EventKind = "trial.completed"

    /// Where the trial placed the kid (`TrialOutcome.targetNodeID`).
    public let targetNodeID: Int
    /// Per op ("add", "sub", "mul", "div"): what the parent dashboard shows.
    public let perOp: [String: OpResult]

    /// One op's result.
    public struct OpResult: Codable, Hashable, Sendable {
        /// 0–1000.
        public let score: Int
        /// "fluent", "capable", "developing", "emerging" or "not_ready"
        /// (`TrialBand.rawValue` in GameRules).
        public let band: String
        public let problemsAsked: Int

        public init(score: Int, band: String, problemsAsked: Int) {
            self.score = score
            self.band = band
            self.problemsAsked = problemsAsked
        }
    }

    enum CodingKeys: String, CodingKey {
        case targetNodeID = "targetNodeId"
        case perOp
    }

    public init(targetNodeID: Int, perOp: [String: OpResult]) {
        self.targetNodeID = targetNodeID
        self.perOp = perOp
    }

    /// Stars the placement gives each node it skips, as the server does.
    public static let skippedNodeStars = 3
}

/// A kid tapped a wrong answer for a math fact. Uploads as the sync kind
/// `wrong_tap`, which is telemetry.
public struct WrongAnswerTapped: EventPayload, Hashable {
    public static let kind: EventKind = "problem.wrong_tap"

    /// The map node, or 0 for a practice game.
    public let nodeID: Int
    public let operandA: Int
    public let operandB: Int
    /// "add", "sub", "mul" or "div".
    public let op: String
    public let correctAnswer: Int
    public let tappedValue: Int
    /// How long the tap took, in whole milliseconds.
    public let timeMs: Int?

    enum CodingKeys: String, CodingKey {
        case nodeID = "nodeId"
        case operandA, operandB, op, correctAnswer, tappedValue, timeMs
    }

    public init(
        nodeID: Int, operandA: Int, operandB: Int, op: String, correctAnswer: Int, tappedValue: Int, timeMs: Int?
    ) {
        self.nodeID = nodeID
        self.operandA = operandA
        self.operandB = operandB
        self.op = op
        self.correctAnswer = correctAnswer
        self.tappedValue = tappedValue
        self.timeMs = timeMs
    }
}

/// A kid crossed the river in Stepping Stones. Only on the device: it's what
/// the per-number best-times board is read from (the web keeps that board in
/// localStorage and never posts it), so it never uploads.
public struct SteppingStonesCrossed: EventPayload, Hashable {
    public static let kind: EventKind = "stepping_stones.crossed"

    /// The times table skip-counted, 1–12.
    public let baseNumber: Int
    /// The winning run's time in whole milliseconds (from the last restart).
    public let elapsedMs: Int
    /// Falls along the way.
    public let restarts: Int

    public init(baseNumber: Int, elapsedMs: Int, restarts: Int) {
        self.baseNumber = baseNumber
        self.elapsedMs = elapsedMs
        self.restarts = restarts
    }
}
