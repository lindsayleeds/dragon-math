import Foundation
import Testing
import GameRules

/// golden/companions.json: the companion catalog in src/data/companions.js.
private struct CompanionsGolden: Decodable {
    struct Entry: Decodable {
        struct Power: Decodable {
            let name: String
            let kind: String
            let cooldownMs: Double
            let durationMs: Double?
            let highlightColor: String
        }

        let id: String
        let name: String
        let icon: String
        let tagline: String
        let capturedAtNodeId: Int?
        let bondPower: Power
    }

    let fixture: String
    let version: Int
    let companions: [Entry]
}

private func golden() throws -> CompanionsGolden {
    try JSONDecoder().decode(CompanionsGolden.self, from: RepoPaths.goldenData("companions"))
}

@Test func companionsHeader() throws {
    let golden = try golden()
    #expect(golden.fixture == "companions")
    #expect(golden.version == 1)
}

@Test func companionsMatchTheWebCatalog() throws {
    let expected = try golden().companions
    #expect(Companion.all.map(\.id) == expected.map(\.id))
    for (swift, js) in zip(Companion.all, expected) {
        #expect(swift.name == js.name)
        #expect(swift.icon == js.icon)
        #expect(swift.tagline == js.tagline)
        #expect(swift.capturedAtNodeID == js.capturedAtNodeId)
        #expect(swift.bondPowerName == js.bondPower.name)
        #expect(swift.bondPower == BondPower(
            kind: try #require(BondPowerKind(rawValue: js.bondPower.kind)),
            cooldownMs: js.bondPower.cooldownMs,
            durationMs: js.bondPower.durationMs,
            highlightColor: js.bondPower.highlightColor))
    }
}

/// "no two companions share a power" (src/data/companions.js).
@Test func everyPowerIsDistinct() {
    #expect(Set(Companion.all.map(\.bondPower.kind)) == Set(BondPowerKind.allCases))
    #expect(Companion.all.count == BondPowerKind.allCases.count)
}

@Test func namedFallsBackToPip() {
    #expect(Companion.named("crystal_dragon").bondPower.kind == .lightningStrike)
    #expect(Companion.named(nil) == .pip)
    #expect(Companion.named("not_a_dragon") == .pip)
}

@Test func bossNodesBefriendTheirCompanion() {
    #expect(Companion.forBossNode(8)?.id == "forest_dragon")
    #expect(Companion.forBossNode(41)?.id == "storm_dragon")
    #expect(Companion.forBossNode(1) == nil)
}

@Test func befriendedIsPipPlusWonBosses() {
    #expect(Companion.befriended(nodesWon: []).map(\.id) == ["pip"])
    #expect(Companion.befriended(nodesWon: [1, 2, 8, 9, 25]).map(\.id) == ["pip", "forest_dragon", "crystal_dragon"])
    #expect(Companion.pip.isBefriended(nodesWon: []))
    #expect(!Companion.named("storm_dragon").isBefriended(nodesWon: [40]))
}
