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
