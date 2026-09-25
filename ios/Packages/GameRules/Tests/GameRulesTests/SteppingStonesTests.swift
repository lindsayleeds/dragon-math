import Foundation
import GameRules
import Testing

/// golden/stepping-stones.json, written by `npm run golden:generate` from
/// src/rules/steppingStones.js. Settings decode with the rule's own
/// `SteppingStonesSettings` — the type the app decodes GET /api/rule-settings with.
private struct StonesGolden: Decodable {
    struct Document: Decodable {
        let schemaVersion: Int
        let steppingStones: SteppingStonesSettings

        enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case steppingStones = "stepping_stones"
        }
    }

    struct Crossing: Decodable, CustomTestStringConvertible {
        let baseNumber: Int
        let seed: String
        let hops: [SteppingStoneHop]
        var testDescription: String { "\(baseNumber)× seed \(seed)" }
    }

    struct Tuned: Decodable {
        let settings: SteppingStonesSettings
        let path: [StonePosition]
        let crossings: [Crossing]
    }

    let fixture: String
    let settings: Document
    let path: [StonePosition]
    let crossings: [Crossing]
    let tuned: Tuned

    static func load() throws -> StonesGolden {
        try JSONDecoder().decode(StonesGolden.self, from: RepoPaths.goldenData("stepping-stones"))
    }
}

/// A crossing under the settings it was dealt with.
private struct TunedCase: CustomTestStringConvertible {
    let settings: SteppingStonesSettings
    let crossing: StonesGolden.Crossing
    var testDescription: String {
        "\(crossing.testDescription) (\(settings.numStones) stones, \(settings.choicesPerHop) pads)"
    }

    static func all() throws -> [TunedCase] {
        let golden = try StonesGolden.load()
        return golden.crossings.map { TunedCase(settings: golden.settings.steppingStones, crossing: $0) }
            + golden.tuned.crossings.map { TunedCase(settings: golden.tuned.settings, crossing: $0) }
    }
}

@Test func goldenIsTheSteppingStonesFixture() throws {
    let golden = try StonesGolden.load()
    #expect(golden.fixture == "stepping-stones")
    #expect(!golden.crossings.isEmpty && !golden.tuned.crossings.isEmpty)
    // The served defaults are what the app plays before settings load.
    #expect(golden.settings.steppingStones == .defaults)
    #expect(golden.tuned.settings != .defaults)
}

@Test(arguments: try TunedCase.all())
private func crossingMatchesGolden(_ c: TunedCase) throws {
    var rng = SeededRandom(seed: try #require(UInt64(c.crossing.seed)))
    let hops = SteppingStones.generateHops(baseNumber: c.crossing.baseNumber, settings: c.settings, rng: &rng)
    #expect(hops == c.crossing.hops)
    #expect(hops.count == c.settings.numStones)
}

@Test func pathsMatchGolden() throws {
    let golden = try StonesGolden.load()
    #expect(SteppingStones.buildPath(golden.settings.steppingStones.numStones) == golden.path)
    #expect(SteppingStones.buildPath(golden.tuned.settings.numStones) == golden.tuned.path)
    #expect(SteppingStones.buildPath() == golden.path)
}

@Test func servedSettingsOutOfRangeFallBack() {
    #expect(SteppingStonesSettings.served(numStones: 6, choicesPerHop: 3) == .init(numStones: 6, choicesPerHop: 3))
    #expect(SteppingStonesSettings.served(numStones: 0, choicesPerHop: 1) == .defaults)
}

@Test func distractorPoolDropsTheAnswerEarlierMultiplesAndNonPositives() {
    // 1×: target 1 → 2, 0✗, 3, -1✗, 2 (repeat), 3 (repeat).
    #expect(SteppingStones.distractorPool(baseNumber: 1, hop: 1) == [2, 3])
    // 2×4 = 8: 9, 7, 10, 6 (an earlier multiple), 10 (repeat), 11.
    #expect(SteppingStones.distractorPool(baseNumber: 2, hop: 4) == [9, 7, 10, 11])
}

@Test func aCrossingLandsFallsAndWins() {
    let hops = [
        SteppingStoneHop(target: 3, choices: [.init(value: 4, isCorrect: false), .init(value: 3, isCorrect: true)]),
        SteppingStoneHop(target: 6, choices: [.init(value: 6, isCorrect: true), .init(value: 7, isCorrect: false)]),
    ]
    var crossing = SteppingStonesCrossing(baseNumber: 3, hops: hops)
    #expect(crossing.currentHop == hops[0])
    #expect(crossing.tap(1) == .landed(index: 0, won: false))
    #expect(crossing.streak == 1)
    // A wrong pad sends the otter back to the near bank.
    #expect(crossing.tap(1) == .fell)
    #expect(crossing.landed == 0 && crossing.restarts == 1 && crossing.streak == 0)
    #expect(crossing.tap(5) == .ignored)
    #expect(crossing.tap(1) == .landed(index: 0, won: false))
    #expect(crossing.tap(0) == .landed(index: 1, won: true))
    #expect(crossing.won && crossing.currentHop == nil)
    #expect(crossing.tap(0) == .ignored)
}
