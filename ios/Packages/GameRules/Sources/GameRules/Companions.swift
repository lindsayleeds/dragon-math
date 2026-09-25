// The companion dragons and their Bond Powers — the Swift port of
// src/data/companions.js. golden/companions.json is the check; CompanionsTests
// compares every field.
//
//   Companion.all                 Object.values(COMPANIONS), collection order
//   Companion.named(_:)           getCompanion(id) (unknown ids → Pip)
//   Companion.forBossNode(_:)     NODE_TO_COMPANION[nodeId]
//   Companion.befriended(nodesWon:)
//
// Pip is every kid's from the start; each other companion is befriended by
// beating its boss node (`capturedAtNodeID`). Which one a kid takes into
// battle is their choice, recorded as a `companion.chosen` Store event.

/// A companion dragon: who it is and the Bond Power it brings to a battle.
public struct Companion: Sendable, Equatable, Identifiable {
    /// Stable id, shared with the server (`users.active_companion_id`,
    /// `user_companions.companion_id`), e.g. "forest_dragon".
    public let id: String
    public let name: String
    public let icon: String
    public let tagline: String
    /// The boss node that befriends it; nil for Pip, the starter.
    public let capturedAtNodeID: Int?
    /// The power's name as the kid sees it, e.g. "Pip's Peek".
    public let bondPowerName: String
    /// What the battle reducer takes for `.bondPower(now:power:)`.
    public let bondPower: BondPower

    public init(
        id: String, name: String, icon: String, tagline: String, capturedAtNodeID: Int?,
        bondPowerName: String, bondPower: BondPower
    ) {
        self.id = id
        self.name = name
        self.icon = icon
        self.tagline = tagline
        self.capturedAtNodeID = capturedAtNodeID
        self.bondPowerName = bondPowerName
        self.bondPower = bondPower
    }
}

extension Companion {
    public static let pip = Companion(
        id: "pip", name: "Pip", icon: "🐲", tagline: "Your tiny pocket dragon.", capturedAtNodeID: nil,
        bondPowerName: "Pip's Peek",
        bondPower: BondPower(kind: .hint2x2, cooldownMs: 20_000, durationMs: 2_000, highlightColor: "#9ed8ff"))

    /// Every companion in collection order: Pip, then the boss companions in
    /// world order.
    public static let all: [Companion] = [
        pip,
        Companion(
            id: "forest_dragon", name: "Forest Dragon", icon: "🐲", tagline: "Guardian of the Mushroom Forest.",
            capturedAtNodeID: 8, bondPowerName: "Mushroom Grove",
            bondPower: BondPower(kind: .mushroomGrove, cooldownMs: 20_000, highlightColor: "#a5e6b8")),
        Companion(
            id: "sunfire_dragon", name: "Sunfire Dragon", icon: "🐲", tagline: "Guardian of the Honeyfield Plains.",
            capturedAtNodeID: 16, bondPowerName: "Sunfire Hold",
            bondPower: BondPower(kind: .aiLockout, cooldownMs: 45_000, durationMs: 30_000, highlightColor: "#ffd87a")),
        Companion(
            id: "crystal_dragon", name: "Crystal Dragon", icon: "🐉", tagline: "Guardian of the Crystal Caves.",
            capturedAtNodeID: 25, bondPowerName: "Crystal Flash",
            bondPower: BondPower(kind: .lightningStrike, cooldownMs: 25_000, highlightColor: "#d4b8ff")),
        Companion(
            id: "sakura_dragon", name: "Sakura Dragon", icon: "🐲", tagline: "Guardian of Sakura Vale.",
            capturedAtNodeID: 33, bondPowerName: "Petal Shield",
            bondPower: BondPower(kind: .petalShield, cooldownMs: 25_000, highlightColor: "#ffc4dd")),
        // The strongest helper — pinpoints the exact answer — so it's the
        // last one befriended (node 41).
        Companion(
            id: "storm_dragon", name: "Storm Dragon", icon: "🐉", tagline: "Guardian of Cloudspire Heights.",
            capturedAtNodeID: 41, bondPowerName: "Storm's Eye",
            bondPower: BondPower(kind: .revealAnswer, cooldownMs: 22_000, durationMs: 2_200, highlightColor: "#a8d8f0")),
    ]

    /// The companion with this id; Pip for nil or an id this version doesn't
    /// know, as the web's `getCompanion`.
    public static func named(_ id: String?) -> Companion {
        all.first { $0.id == id } ?? pip
    }

    /// The companion a boss node befriends, if it is one.
    public static func forBossNode(_ nodeID: Int) -> Companion? {
        all.first { $0.capturedAtNodeID == nodeID }
    }

    /// The companions a kid who has won `nodesWon` may choose: Pip, plus every
    /// companion whose boss node is won. Collection order.
    public static func befriended(nodesWon: Set<Int>) -> [Companion] {
        all.filter { $0.isBefriended(nodesWon: nodesWon) }
    }

    /// Whether a kid who has won `nodesWon` may choose this companion.
    public func isBefriended(nodesWon: Set<Int>) -> Bool {
        capturedAtNodeID.map(nodesWon.contains) ?? true
    }
}
