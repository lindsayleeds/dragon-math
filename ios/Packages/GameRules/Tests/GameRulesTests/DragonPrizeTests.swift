import Foundation
import GameRules
import Testing

/// golden/prize-draws.json, written by `npm run golden:generate` from
/// src/data/dragonPrize.js. Settings decode with the rule's own `PrizeSettings`
/// — the type the app decodes GET /api/rule-settings' `prize` section with.
private struct PrizeGolden: Decodable {
    struct Document: Decodable {
        let schemaVersion: Int
        let prize: PrizeSettings

        enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case prize
        }
    }

    struct Dragon: Decodable {
        let dragonId: Int
        let name: String?
        let rarity: String?

        enum CodingKeys: String, CodingKey {
            case dragonId = "dragon_id"
            case name, rarity
        }

        var swift: PrizeDragon { PrizeDragon(dragonID: dragonId, name: name, rarity: rarity) }
    }

    struct CountRolls: Decodable {
        let performance: String
        let seed: String
        let counts: [Int]
    }

    struct Tuned: Decodable {
        let settings: PrizeSettings
        let rolls: [CountRolls]
    }

    struct Draw: Decodable, CustomTestStringConvertible {
        let catalog: String?
        let rarityTable: String
        let seed: String
        let count: Int
        let drawn: [Int]
        var testDescription: String { "\(catalog ?? "null") \(rarityTable) ×\(count) seed \(seed)" }
    }

    struct Prize: Decodable {
        let catalog: String
        let performance: String
        let seed: String
        let count: Int
        let drawn: [Int]
    }

    let fixture: String
    let settings: Document
    let fallbackCatalogSize: Int
    let catalogs: [String: [Dragon]]
    let rarityTables: [String: [String: Double]]
    let countRolls: [CountRolls]
    let tunedCountRolls: Tuned
    let draws: [Draw]
    let prizes: [Prize]

    /// A null catalog is the same as an empty one: the fallback range.
    func catalog(_ name: String?) throws -> [PrizeDragon] {
        guard let name else { return [] }
        return try #require(catalogs[name]).map(\.swift)
    }

    static func load() throws -> PrizeGolden {
        try JSONDecoder().decode(PrizeGolden.self, from: RepoPaths.goldenData("prize-draws"))
    }
}

private func rng(_ seed: String) throws -> SeededRandom {
    SeededRandom(seed: try #require(UInt64(seed)))
}

@Test func goldenIsThePrizeDrawsFixture() throws {
    let golden = try PrizeGolden.load()
    #expect(golden.fixture == "prize-draws")
    #expect(!golden.countRolls.isEmpty && !golden.draws.isEmpty && !golden.prizes.isEmpty)
    // The served defaults are what the app draws with before settings sync.
    #expect(golden.settings.prize == .defaults)
    #expect(golden.rarityTables["default"] == PrizeSettings.defaults.rarityWeights)
    #expect(golden.tunedCountRolls.settings != .defaults)
    #expect(golden.fallbackCatalogSize == fallbackDragonCount)
    #expect(fallbackPrizeCatalog.map(\.dragonID) == Array(1...fallbackDragonCount))
}

@Test func countRollsMatchGolden() throws {
    let golden = try PrizeGolden.load()
    let cases = golden.countRolls.map { ($0, golden.settings.prize, "") }
        + golden.tunedCountRolls.rolls.map { ($0, golden.tunedCountRolls.settings, "tuned ") }
    for (c, settings, label) in cases {
        var r = try rng(c.seed)
        let counts = c.counts.indices.map { _ in
            rollPrizeCount(PrizePerformance(tier: c.performance), rng: &r, settings: settings)
        }
        #expect(counts == c.counts, "\(label)\(c.performance) seed \(c.seed)")
    }
}

@Test(arguments: try PrizeGolden.load().draws)
private func drawMatchesGolden(_ c: PrizeGolden.Draw) throws {
    let golden = try PrizeGolden.load()
    var settings = golden.settings.prize
    settings.rarityWeights = try #require(golden.rarityTables[c.rarityTable])
    var r = try rng(c.seed)
    let drawn = drawDragonPrize(catalog: try golden.catalog(c.catalog), count: c.count, rng: &r, settings: settings)
    #expect(drawn.map(\.dragonID) == c.drawn)
}

@Test func prizesMatchGoldenOnOneGenerator() throws {
    let golden = try PrizeGolden.load()
    for c in golden.prizes {
        var r = try rng(c.seed)
        let count = rollPrizeCount(PrizePerformance(tier: c.performance), rng: &r, settings: golden.settings.prize)
        let drawn = drawDragonPrize(catalog: try golden.catalog(c.catalog), count: count, rng: &r, settings: golden.settings.prize)
        #expect(count == c.count, "\(c.catalog) \(c.performance) seed \(c.seed)")
        #expect(drawn.map(\.dragonID) == c.drawn, "\(c.catalog) \(c.performance) seed \(c.seed)")
    }
}

@Test func theLiveRuleSettingsPrizeSectionDecodes() throws {
    // golden/rule-settings.json holds a full served document.
    struct File: Decodable {
        struct Doc: Decodable { let prize: PrizeSettings }
        let document: Doc
    }
    let file = try JSONDecoder().decode(File.self, from: RepoPaths.goldenData("rule-settings"))
    #expect(file.document.prize == .defaults)
}

@Test func unknownTiersRollAsNormal() {
    #expect(PrizePerformance(tier: "sparkly") == .normal)
    #expect(PrizePerformance(tier: "high") == .high)
}

@Test func eachDragonCostsTwoDraws() {
    var a = SeededRandom(seed: 9)
    var b = a
    _ = drawDragonPrize(catalog: [], count: 3, rng: &a)
    for _ in 0..<6 { _ = b.next() }
    #expect(a == b)
}

@Test func validationKeepsGoodServedValuesAndRepairsBadOnes() {
    let low = [PrizeCountWeight(count: 2, weight: 1)]
    var served = PrizeSettings(
        rarityWeights: ["common": -1, "rare": 3, "sparkly": 4, "mythic": .infinity],
        countWeights: PrizeCountWeights(low: low, normal: [], high: [PrizeCountWeight(count: 0, weight: 1)]))
    served = served.validated()
    var rarity = PrizeSettings.defaults.rarityWeights
    rarity["rare"] = 3
    rarity["sparkly"] = 4
    #expect(served.rarityWeights == rarity)
    #expect(served.countWeights.low == low)
    #expect(served.countWeights.normal == PrizeSettings.defaults.countWeights.normal)
    #expect(served.countWeights.high == PrizeSettings.defaults.countWeights.high)
    #expect(PrizeSettings.defaults.validated() == .defaults)
}
