import Foundation
import Testing
import GameRules

/// golden/prng.json: per seed, the first outputs of the JavaScript
/// createSeededRandom. `uint64` and `float` each come from a fresh generator.
private struct PRNGGolden: Decodable, Sendable {
    struct Case: Decodable, Sendable, CustomTestStringConvertible {
        var testDescription: String { "seed \(seed)" }
        let seed: String
        let uint64: [String]
        let float: [Double]
    }

    let fixture: String
    let algorithm: String
    let cases: [Case]

    static func load() throws -> PRNGGolden {
        try JSONDecoder().decode(PRNGGolden.self, from: RepoPaths.goldenData("prng"))
    }
}

private let golden = Result { try PRNGGolden.load() }

private func goldenCases() throws -> [PRNGGolden.Case] {
    let file = try golden.get()
    #expect(file.fixture == "prng")
    #expect(file.algorithm == "splitmix64")
    return file.cases
}

@Test func goldenCoversEveryEdgeSeed() throws {
    let seeds = try goldenCases().map(\.seed)
    #expect(seeds == ["0", "1", "42", "9007199254740991", "18446744073709551615"])
}

@Test(arguments: try goldenCases())
private func uint64MatchesGolden(_ golden: PRNGGolden.Case) throws {
    var rng = SeededRandom(seed: try #require(UInt64(golden.seed)))
    #expect(!golden.uint64.isEmpty)
    for (index, text) in golden.uint64.enumerated() {
        let expected = try #require(UInt64(text), "draw \(index) of seed \(golden.seed)")
        #expect(rng.nextUInt64() == expected, "draw \(index) of seed \(golden.seed)")
    }
}

@Test(arguments: try goldenCases())
private func floatMatchesGolden(_ golden: PRNGGolden.Case) throws {
    var rng = SeededRandom(seed: try #require(UInt64(golden.seed)))
    #expect(!golden.float.isEmpty)
    for (index, expected) in golden.float.enumerated() {
        let actual = rng.next()
        // Bit patterns, so "equal" can't hide a -0 or a last-bit difference.
        #expect(actual.bitPattern == expected.bitPattern, "draw \(index) of seed \(golden.seed): \(actual) vs \(expected)")
    }
}

@Test func floatIsTopBitsOfTheSameDraw() {
    var ints = SeededRandom(seed: 42)
    var floats = SeededRandom(seed: 42)
    for _ in 0..<100 {
        let bits = ints.nextUInt64()
        let value = floats.next()
        #expect(value == Double(bits >> 11) / 9_007_199_254_740_992)
        #expect(value >= 0 && value < 1)
    }
}

@Test func copyingForksTheSequence() {
    var original = SeededRandom(seed: 7)
    _ = original.nextUInt64()
    var copy = original
    #expect(copy == original)
    let fromCopy = (0..<5).map { _ in copy.nextUInt64() }
    let fromOriginal = (0..<5).map { _ in original.nextUInt64() }
    #expect(fromCopy == fromOriginal)
}

/// A rule written against RandomSource, the way later GameRules ports will be.
private func draws(_ count: Int, from rng: inout some RandomSource) -> [Double] {
    (0..<count).map { _ in rng.next() }
}

@Test func worksAsAnInjectedRandomSource() throws {
    let first = try #require(try goldenCases().first)
    var seeded = SeededRandom(seed: try #require(UInt64(first.seed)))
    #expect(draws(first.float.count, from: &seeded) == first.float)

    var system = SystemRandomSource()
    for value in draws(100, from: &system) {
        #expect(value >= 0 && value < 1)
    }
}
