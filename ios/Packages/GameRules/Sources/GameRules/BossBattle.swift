// What sets a boss battle apart once it ends — the Swift port of
// src/rules/bossBattle.js. golden/boss-battles.json is the check.
//
//   GameMap.isBossNode(_:)   isBossNode(nodeId)
//   matchStars(aiScore:target:)   matchStars(aiScore, target)
//   matchOutcome(...)       matchOutcome({ nodeId, won, aiScore, target, ownedCompanionIds })
//
// The match itself plays by the same reducer as any node (Battle.swift); a
// boss's difficulty is only its node config. No draws.

extension GameMap {
    /// Whether `nodeID` is a boss node. An id not on the map is not.
    public static func isBossNode(_ nodeID: Int) -> Bool {
        node(nodeID)?.isBoss ?? false
    }
}

/// Stars for a won match: 3 if the opponent got fewer than half the target,
/// 2 if under three quarters, else 1.
public func matchStars(aiScore: Int, target: Int) -> Int {
    let ai = Double(aiScore), t = Double(target)
    if ai < t * 0.5 { return 3 }
    if ai < t * 0.75 { return 2 }
    return 1
}

/// How a finished match turns out.
public struct MatchOutcome: Sendable, Equatable {
    /// The stars a win earns; nil for a loss.
    public var stars: Int?
    /// A won boss: the 👑 and "The dragon bows to you!".
    public var crowned: Bool
    /// The boss's companion, when this win befriends one the player didn't
    /// have — the capture celebration.
    public var befriends: Companion?

    public init(stars: Int?, crowned: Bool, befriends: Companion?) {
        self.stars = stars
        self.crowned = crowned
        self.befriends = befriends
    }
}

/// How a finished match on `nodeID` turns out.
///
/// - Parameters:
///   - won: whether the player reached the target first.
///   - aiScore, target: the final opponent score and the target.
///   - ownedCompanionIDs: the companions the player already has.
public func matchOutcome(
    nodeID: Int, won: Bool, aiScore: Int, target: Int, ownedCompanionIDs: Set<String>
) -> MatchOutcome {
    let boss = GameMap.isBossNode(nodeID)
    let companion = boss ? Companion.forBossNode(nodeID) : nil
    return MatchOutcome(
        stars: won ? matchStars(aiScore: aiScore, target: target) : nil,
        crowned: won && boss,
        befriends: won ? companion.flatMap { ownedCompanionIDs.contains($0.id) ? nil : $0 } : nil)
}
