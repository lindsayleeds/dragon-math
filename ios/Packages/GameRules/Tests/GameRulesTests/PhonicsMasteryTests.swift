import Foundation
import GameRules
import Testing

/// The `mastery` section of golden/phonics.json: the server's rule
/// (server/lib/phonicsMastery.js) on fixed attempts, judged at fixed times.
private struct MasteryGolden: Decodable {
    struct Constants: Decodable {
        let recentWindow: Int
        let minAttemptsSolid: Int
        let minAttemptsMastered: Int
        let solidAccuracy: Double
        let masteredAccuracy: Double
        let modesForMastery: Int
        let staleAfterDays: Int
        let levels: [String]
    }

    struct Attempt: Decodable {
        let elementKey: String?
        let mode: String?
        let correct: Bool
        let chosen: String?
        let createdAt: String?

        var rule: PhonicsMasteryAttempt {
            PhonicsMasteryAttempt(
                elementKey: elementKey, mode: mode ?? "", correct: correct, chosen: chosen,
                atMs: createdAt.flatMap(isoMs))
        }
    }

    struct Result: Decodable, Equatable {
        let level: String
        let attempts: Int
        let correct: Int
        let accuracy: Double?
        let modes: [String]
        let lastSeenAt: String?
        let stale: Bool
        let total: Int

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            level = try c.decode(String.self, forKey: .level)
            attempts = try c.decode(Int.self, forKey: .attempts)
            correct = try c.decode(Int.self, forKey: .correct)
            accuracy = try c.decodeIfPresent(Double.self, forKey: .accuracy)
            modes = try c.decode([String].self, forKey: .modes)
            lastSeenAt = try c.decodeIfPresent(String.self, forKey: .lastSeenAt)
            stale = try c.decode(Bool.self, forKey: .stale)
            total = try c.decode(Int.self, forKey: .total)
        }

        init(_ m: PhonicsElementMastery) {
            level = m.level.rawValue
            attempts = m.attempts
            correct = m.correct
            accuracy = m.accuracy
            modes = m.modes
            lastSeenAt = m.lastSeenAtMs.map(isoString)
            stale = m.stale
            total = m.total
        }

        enum CodingKeys: String, CodingKey {
            case level, attempts, correct, accuracy, modes, lastSeenAt, stale, total
        }
    }

    struct ElementCase: Decodable, CustomTestStringConvertible {
        let name: String
        let attempts: [Attempt]
        let result: Result
        var testDescription: String { name }
    }

    struct Step: Decodable {
        let attempt: Attempt
        let result: Result
    }

    struct Later: Decodable {
        let now: String
        let result: Result
    }

    struct Progression: Decodable {
        let steps: [Step]
        let later: Later
    }

    struct AllCase: Decodable {
        let now: String
        let rows: [Attempt]
        let result: [String: Result]
    }

    struct Pair: Decodable, Equatable {
        let element: String
        let chose: String
        let count: Int
    }

    struct PairsCase: Decodable, CustomTestStringConvertible {
        let limit: Int
        let rows: [Attempt]
        let result: [Pair]
        var testDescription: String { "limit \(limit)" }
    }

    let constants: Constants
    let now: String
    let classifyElement: [ElementCase]
    let progression: Progression
    let classifyAll: AllCase
    let confusionPairs: [PairsCase]
}

private struct PhonicsFile: Decodable {
    let mastery: MasteryGolden
}

private let golden: MasteryGolden = {
    let data = try! RepoPaths.goldenData("phonics")
    return try! JSONDecoder().decode(PhonicsFile.self, from: data).mastery
}()

/// JavaScript's `new Date(string)` for the ISO strings the fixtures use; nil
/// for anything else ("not a date").
private func isoMs(_ string: String) -> Double? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = f.date(from: string) else { return nil }
    return (date.timeIntervalSince1970 * 1000).rounded()
}

/// `Date#toISOString`.
private func isoString(_ ms: Double) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date(timeIntervalSince1970: ms / 1000))
}

@Test func theConstantsAreTheServers() {
    let c = golden.constants
    #expect(c.recentWindow == PhonicsMastery.recentWindow)
    #expect(c.minAttemptsSolid == PhonicsMastery.minAttemptsSolid)
    #expect(c.minAttemptsMastered == PhonicsMastery.minAttemptsMastered)
    #expect(c.solidAccuracy == PhonicsMastery.solidAccuracy)
    #expect(c.masteredAccuracy == PhonicsMastery.masteredAccuracy)
    #expect(c.modesForMastery == PhonicsMastery.modesForMastery)
    #expect(c.staleAfterDays == PhonicsMastery.staleAfterDays)
    #expect(c.levels == PhonicsMasteryLevel.allCases.map(\.rawValue))
}

@Test(arguments: golden.classifyElement)
private func classifyElementMatchesTheServer(_ c: MasteryGolden.ElementCase) throws {
    let now = try #require(isoMs(golden.now))
    let got = PhonicsMastery.classifyElement(c.attempts.map(\.rule), nowMs: now)
    #expect(MasteryGolden.Result(got) == c.result)
}

@Test func aProgressionClimbsAndGoesStaleAsTheServerSays() throws {
    var history: [PhonicsMasteryAttempt] = []
    for (i, step) in golden.progression.steps.enumerated() {
        history.insert(step.attempt.rule, at: 0)
        let now = try #require(step.attempt.rule.atMs)
        let got = PhonicsMastery.classifyElement(history, nowMs: now)
        #expect(MasteryGolden.Result(got) == step.result, "step \(i + 1)")
    }
    let later = try #require(isoMs(golden.progression.later.now))
    #expect(MasteryGolden.Result(PhonicsMastery.classifyElement(history, nowMs: later)) == golden.progression.later.result)
}

@Test func classifyAllGroupsAndSortsAsTheServer() throws {
    let c = golden.classifyAll
    let got = PhonicsMastery.classifyAll(c.rows.map(\.rule), nowMs: try #require(isoMs(c.now)))
    #expect(got.mapValues(MasteryGolden.Result.init) == c.result)
}

@Test(arguments: golden.confusionPairs)
private func confusionPairsMatchTheServer(_ c: MasteryGolden.PairsCase) {
    let got = PhonicsMastery.confusionPairs(c.rows.map(\.rule), limit: c.limit)
    #expect(got.map { MasteryGolden.Pair(element: $0.element, chose: $0.chose, count: $0.count) } == c.result)
}

@Test func levelsRankWorstToBest() {
    #expect(PhonicsMasteryLevel.new < .learning && PhonicsMasteryLevel.learning < .solid)
    #expect(PhonicsMasteryLevel.solid < .mastered)
}

@Test func theOverviewFillsInEveryElementAndCountsPerStage() {
    let stage1 = PhonicsStage.all[0].elements
    let mastery: [String: PhonicsElementMastery] = [
        stage1[0].key: .init(
            level: .mastered, attempts: 6, correct: 6, accuracy: 1, modes: ["choose", "type-it"], lastSeenAtMs: 0,
            stale: true, total: 6),
        stage1[1].key: .init(
            level: .solid, attempts: 4, correct: 3, accuracy: 0.75, modes: ["choose"], lastSeenAtMs: 0, stale: false,
            total: 4),
        stage1[2].key: .init(
            level: .learning, attempts: 2, correct: 1, accuracy: 0.5, modes: ["choose"], lastSeenAtMs: 0,
            stale: false, total: 2),
        "not-in-the-curriculum": .init(
            level: .mastered, attempts: 6, correct: 6, accuracy: 1, modes: ["a", "b"], lastSeenAtMs: 0, stale: false,
            total: 6),
    ]
    let overview = PhonicsMasteryOverview(mastery)

    #expect(overview.elements.count == PhonicsElement.all.count)
    #expect(overview[PhonicsElement.all.last!.key] == .new)
    #expect(overview.total == PhonicsElement.all.count)
    #expect(overview.overall.mastered == 1 && overview.overall.solid == 1 && overview.overall.learning == 1)
    #expect(overview.overall.new == PhonicsElement.all.count - 3)
    #expect(overview.overall.stale == 1)
    #expect(overview.percent == Int((100.0 / Double(PhonicsElement.all.count)).rounded()))

    #expect(overview.stages.map(\.stage) == PhonicsStage.all)
    let first = overview.stages[0]
    #expect(first.total == stage1.count)
    #expect(first.mastered == 1)
    #expect(first.touched == 3)
    #expect(first.counts.stale == 1)
    #expect(first.percent == Int((100.0 / Double(stage1.count)).rounded()))
    #expect(overview.stages.dropFirst().allSatisfy { $0.touched == 0 && $0.percent == 0 })
}

@Test func verdictsFeedTheRoundBuilder() {
    let state = PhonicsElementMastery(
        level: .solid, attempts: 5, correct: 5, accuracy: 1, modes: ["choose"], lastSeenAtMs: 0, stale: true,
        total: 5
    ).state
    #expect(state == PhonicsMasteryState(level: "solid", stale: true, accuracy: 1))
    let element = PhonicsElement.all[0]
    // A stale solid sound is weighted as the web weights it: solid + the stale bonus.
    #expect(Phonics.weight(for: element, mastery: [element.key: state]) == 6)
}
