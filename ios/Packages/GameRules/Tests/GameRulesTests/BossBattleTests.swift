import Foundation
import Testing
import GameRules

/// golden/boss-battles.json: matchOutcome() in src/rules/bossBattle.js.
private struct BossBattlesGolden: Decodable {
    struct Case: Decodable {
        struct Input: Decodable {
            let nodeId: Int
            let won: Bool
            let aiScore: Int
            let target: Int
            let ownedCompanionIds: [String]
        }

        struct Expected: Decodable {
            let stars: Int?
            let crowned: Bool
            let befriendsCompanionId: String?
        }

        let input: Input
        let expected: Expected
    }

    let fixture: String
    let version: Int
    let bossNodeIds: [Int]
    let cases: [Case]
}

private func golden() throws -> BossBattlesGolden {
    try JSONDecoder().decode(BossBattlesGolden.self, from: RepoPaths.goldenData("boss-battles"))
}

@Test func bossBattlesHeader() throws {
    let golden = try golden()
    #expect(golden.fixture == "boss-battles")
    #expect(golden.version == 1)
    #expect(!golden.cases.isEmpty)
}

@Test func bossNodesMatchTheWeb() throws {
    let golden = try golden()
    #expect(GameMap.nodes.filter(\.isBoss).map(\.id) == golden.bossNodeIds)
    for id in Set(golden.cases.map(\.input.nodeId)) {
        #expect(GameMap.isBossNode(id) == golden.bossNodeIds.contains(id), "node \(id)")
    }
}

@Test func matchOutcomesMatchTheWeb() throws {
    for c in try golden().cases {
        let i = c.input
        let outcome = matchOutcome(
            nodeID: i.nodeId, won: i.won, aiScore: i.aiScore, target: i.target,
            ownedCompanionIDs: Set(i.ownedCompanionIds))
        let label = "node \(i.nodeId) won \(i.won) ai \(i.aiScore)/\(i.target) owned \(i.ownedCompanionIds)"
        #expect(outcome.stars == c.expected.stars, "\(label)")
        #expect(outcome.crowned == c.expected.crowned, "\(label)")
        #expect(outcome.befriends?.id == c.expected.befriendsCompanionId, "\(label)")
    }
}
