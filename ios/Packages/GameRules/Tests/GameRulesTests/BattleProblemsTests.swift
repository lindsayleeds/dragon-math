import Foundation
import Testing
import GameRules

/// golden/battle-problems.json: problem and grid generation from
/// src/data/battleData.js, driven by createSeededRandom(seed).next.
private struct BattleGolden: Decodable, Sendable {
    struct Config: Decodable, Sendable {
        let name: String
        let ops: [BattleOp]
        let range: [Int]
    }

    struct GoldenProblem: Decodable, Sendable {
        let a: Int
        let b: Int
        let op: BattleOp
        let text: String
        let answer: Int
    }

    struct ProblemsCase: Decodable, Sendable, CustomTestStringConvertible {
        var testDescription: String { "\(config) seed \(seed)" }
        let config: String
        let seed: String
        let problems: [GoldenProblem]
    }

    struct Layout: Decodable, Sendable, CustomTestStringConvertible {
        var testDescription: String { id }
        let id: String
        let source: String
        let art: String?
        let cols: Int
        let rows: Int
        let cells: [Bool]
    }

    struct Resolve: Decodable, Sendable, CustomTestStringConvertible {
        var testDescription: String { "\(shapeId ?? "nil") → world \(fallbackWorldId)" }
        let shapeId: String?
        let fallbackWorldId: Int
        let layout: String
    }

    struct GridCase: Decodable, Sendable, CustomTestStringConvertible {
        var testDescription: String { "\(layout) \(config) seed \(seed)" }
        let layout: String
        let config: String
        let seed: String
        let problem: GoldenProblem
        let grid: [Int?]
    }

    let fixture: String
    let version: Int
    let configs: [Config]
    let problems: [ProblemsCase]
    let layouts: [Layout]
    let resolve: [Resolve]
    let grids: [GridCase]

    static func load() throws -> BattleGolden {
        try JSONDecoder().decode(BattleGolden.self, from: RepoPaths.goldenData("battle-problems"))
    }

    func config(_ name: String) throws -> BattleConfig {
        let entry = try #require(configs.first { $0.name == name }, "config \(name)")
        try #require(entry.range.count == 2)
        // aiSeconds isn't part of generation, and the fixture leaves it out.
        return BattleConfig(ops: entry.ops, min: entry.range[0], max: entry.range[1], aiSeconds: 0)
    }

    func layout(_ id: String) throws -> Layout {
        try #require(layouts.first { $0.id == id }, "layout \(id)")
    }
}

private let golden = Result { try BattleGolden.load() }
private func file() throws -> BattleGolden { try golden.get() }

private func expectMatches(_ problem: Problem, _ expected: BattleGolden.GoldenProblem, _ where: String) {
    #expect(problem.a == expected.a, "\(`where`): a")
    #expect(problem.b == expected.b, "\(`where`): b")
    #expect(problem.op == expected.op, "\(`where`): op")
    #expect(problem.answer == expected.answer, "\(`where`): answer")
    #expect(problem.text == expected.text, "\(`where`): text")
}

private func seeded(_ seed: String) throws -> SeededRandom {
    SeededRandom(seed: try #require(UInt64(seed)))
}

@Test func goldenHeader() throws {
    let golden = try file()
    #expect(golden.fixture == "battle-problems")
    #expect(golden.version == 1)
    #expect(!golden.problems.isEmpty && !golden.grids.isEmpty && !golden.resolve.isEmpty)
}

@Test func goldenCoversEveryOperation() throws {
    let ops = Set(try file().problems.flatMap { $0.problems.map(\.op) })
    #expect(ops == Set(BattleOp.allCases))
}

@Test(arguments: try file().problems)
private func problemsMatchGolden(_ golden: BattleGolden.ProblemsCase) throws {
    let config = try file().config(golden.config)
    var rng = try seeded(golden.seed)
    #expect(!golden.problems.isEmpty)
    for (index, expected) in golden.problems.enumerated() {
        expectMatches(generateProblem(config, rng: &rng), expected, "\(golden.testDescription) #\(index)")
    }
}

@Test(arguments: try file().grids)
private func gridsMatchGolden(_ golden: BattleGolden.GridCase) throws {
    let file = try file()
    let config = try file.config(golden.config)
    let entry = try file.layout(golden.layout)
    let layout = BattleLayout(cols: entry.cols, rows: entry.rows, cells: entry.cells)
    // One generator for the whole round: the problem, then its grid.
    var rng = try seeded(golden.seed)
    let problem = generateProblem(config, rng: &rng)
    expectMatches(problem, golden.problem, golden.testDescription)
    let grid = buildGrid(answer: problem.answer, config: config, layout: layout, rng: &rng)
    #expect(grid == golden.grid)
}

@Test(arguments: try file().layouts)
private func layoutsParseLikeGolden(_ golden: BattleGolden.Layout) throws {
    let expected = BattleLayout(cols: golden.cols, rows: golden.rows, cells: golden.cells)
    switch golden.source {
    case "shape":
        let shape = try #require(BattleShape.named(golden.id), "shape \(golden.id) missing from BattleShape.all")
        #expect(shape.art == golden.art, "BattleShapes.swift is stale — run npm run ios:battle-shapes")
        #expect(shape.layout == expected)
        #expect(BattleLayout(art: try #require(golden.art)) == expected)
        #expect(BattleLayout.forShape(golden.id) == expected)
        // The library's own metadata agrees with its art.
        #expect(shape.cells == expected.activeCount)
        #expect(shape.width == expected.cols && shape.height == expected.rows)
    case "world":
        let worldId = try #require(Int(golden.id.dropFirst("world-".count)), "world id in \(golden.id)")
        #expect(BattleLayout.world(worldId) == expected)
    default:
        Issue.record("unknown layout source \(golden.source)")
    }
}

@Test func shapeLibraryMatchesGoldenExactly() throws {
    let goldenIds = try file().layouts.filter { $0.source == "shape" }.map(\.id)
    #expect(BattleShape.all.map(\.id) == goldenIds)
}

@Test(arguments: try file().resolve)
private func resolveMatchesGolden(_ golden: BattleGolden.Resolve) throws {
    let entry = try file().layout(golden.layout)
    let expected = BattleLayout(cols: entry.cols, rows: entry.rows, cells: entry.cells)
    #expect(BattleLayout.forShape(golden.shapeId, fallbackWorldId: golden.fallbackWorldId) == expected)
    let config = BattleConfig(ops: [.add], min: 1, max: 3, aiSeconds: 1, shapeId: golden.shapeId)
    #expect(BattleLayout.forConfig(config, fallbackWorldId: golden.fallbackWorldId) == expected)
}

@Test func defaultNodeConfigsMatchGolden() throws {
    let nodes = try file().configs.filter { $0.name.hasPrefix("node-") }
    #expect(nodes.count == BattleConfig.defaults.count)
    for node in nodes {
        let id = try #require(Int(node.name.dropFirst("node-".count)))
        let config = try #require(BattleConfig.defaults[id], "node \(id)")
        #expect(config.ops == node.ops, "node \(id)")
        #expect([config.min, config.max] == node.range, "node \(id)")
        #expect(config.shapeId == nil)
    }
    #expect(BattleConfig.defaultConfig(forNode: 999) == BattleConfig.defaults[1])
}

@Test func gridHasTheAnswerExactlyOnceAndNilSpacers() throws {
    let config = BattleConfig(ops: [.add, .mul], min: 2, max: 12, aiSeconds: 5)
    var rng = SeededRandom(seed: 99)
    for shape in BattleShape.all {
        let problem = generateProblem(config, rng: &rng)
        let grid = buildGrid(answer: problem.answer, config: config, layout: shape.layout, rng: &rng)
        #expect(grid.count == shape.layout.cells.count)
        #expect(zip(grid, shape.layout.cells).allSatisfy { ($0 == nil) == !$1 }, "\(shape.id)")
        #expect(grid.filter { $0 == problem.answer }.count == 1, "\(shape.id)")
        #expect(grid.compactMap { $0 }.allSatisfy { (0...config.distractorMax).contains($0) || $0 == problem.answer })
    }
}

@Test func squareGridHasTheAnswerExactlyOnce() {
    let config = BattleConfig(ops: [.sub], min: 1, max: 10, aiSeconds: 5)
    var rng = SeededRandom(seed: 3)
    let grid = buildGrid(answer: 7, config: config, rng: &rng)
    #expect(grid.count == defaultGridSize * defaultGridSize)
    #expect(grid.filter { $0 == 7 }.count == 1)
    #expect(grid.allSatisfy { (0...20).contains($0) })
}

@Test func distractorCeiling() {
    #expect(BattleConfig(ops: [.add, .mul], min: 2, max: 12, aiSeconds: 1).distractorMax == 144)
    #expect(BattleConfig(ops: [.add, .sub, .div], min: 2, max: 12, aiSeconds: 1).distractorMax == 24)
}
