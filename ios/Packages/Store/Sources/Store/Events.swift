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
