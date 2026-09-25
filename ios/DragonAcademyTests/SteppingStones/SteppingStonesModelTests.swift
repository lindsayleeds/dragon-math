import Audio
import Foundation
import GameRules
import Store
import Testing
@testable import DragonAcademy

@MainActor
private struct StonesHarness {
    let clock = ManualClock()
    let sounds = SoundLog()
    let store: SQLiteStore
    let model: SteppingStonesModel

    init(baseNumber: Int = 3, settings: SteppingStonesSettings = .init(numStones: 4, choicesPerHop: 3)) throws {
        store = try .inMemory()
        let clock = clock, sounds = sounds
        model = SteppingStonesModel(
            baseNumber: baseNumber, store: store, profileID: store.guestProfile.id, sync: nil, settings: settings,
            clock: { clock.now }, sleep: { _ in }, seed: 7, playSound: sounds.play)
    }

    var guest: Profile.ID { store.guestProfile.id }

    func pad(correct: Bool) throws -> Int {
        let hop = try #require(model.offeredHop)
        return try #require(hop.choices.firstIndex { $0.isCorrect == correct })
    }

    /// Taps a pad `afterMs` after the last beat ended, and waits out the beats.
    func tap(correct: Bool, afterMs: Double = 500) async throws {
        clock.now += afterMs
        model.tap(try pad(correct: correct))
        await model.lastTap?.value
    }

    func events<T: EventPayload>(_: T.Type) async throws -> [T] {
        try await store.events(for: guest).compactMap { try $0.decode(T.self) }
    }
}

@MainActor @Test func aCleanCrossingRecordsEachHopAndTheTime() async throws {
    let h = try StonesHarness()
    #expect(h.model.numStones == 4 && h.model.path.count == 4)
    for _ in 0..<4 { try await h.tap(correct: true, afterMs: 1_000) }

    let result = try #require(h.model.result)
    #expect(result == SteppingStonesModel.Result(
        elapsedMs: 4_000, restarts: 0, verdict: .first, board: [.init(ms: 4_000, isCurrent: true)]))
    #expect(h.model.shownLanded == 4 && h.model.offeredHop == nil)
    // Frozen once won.
    h.clock.now += 5_000
    #expect(h.model.elapsedMs() == 4_000)

    #expect(try await h.events(ProblemAttempted.self) == (1...4).map {
        ProblemAttempted(nodeID: 0, operandA: 3, operandB: $0, op: "mul", answer: 3 * $0, outcome: "child", timeMs: 1_000)
    })
    #expect(try await h.events(WrongAnswerTapped.self).isEmpty)
    #expect(try await h.events(SteppingStonesCrossed.self) == [
        SteppingStonesCrossed(baseNumber: 3, elapsedMs: 4_000, restarts: 0),
    ])
    #expect(h.sounds.played == [.correct, .correct, .correct, .correct, .win])
}

@MainActor @Test func aWrongPadSendsTheOtterBackAndRestartsTheClock() async throws {
    let h = try StonesHarness()
    try await h.tap(correct: true)
    try await h.tap(correct: true)
    #expect(h.model.shownLanded == 2 && h.model.streak == 2)

    let wrong = try h.pad(correct: false)
    let tapped = try #require(h.model.offeredHop).choices[wrong].value
    h.clock.now += 700
    h.model.tap(wrong)
    // The otter leaps onto the wrong pad; the rocks keep their numbers while it sinks.
    #expect(h.model.otter == .pad(wrong) && h.model.busy && h.model.shownLanded == 2)
    await h.model.lastTap?.value

    #expect(h.model.otter == .start && !h.model.busy)
    #expect(h.model.shownLanded == 0 && h.model.restarts == 1 && h.model.streak == 0)
    #expect(h.model.otterGeneration == 1)
    #expect(h.sounds.played == [.correct, .correct, .splash])
    #expect(try await h.events(ProblemAttempted.self).last
        == ProblemAttempted(nodeID: 0, operandA: 3, operandB: 3, op: "mul", answer: 9, outcome: "ai", timeMs: 700))
    #expect(try await h.events(WrongAnswerTapped.self) == [
        WrongAnswerTapped(nodeID: 0, operandA: 3, operandB: 3, op: "mul", correctAnswer: 9, tappedValue: tapped,
                          timeMs: 700),
    ])

    // The run's time counts from the restart.
    for _ in 0..<4 { try await h.tap(correct: true, afterMs: 250) }
    let result = try #require(h.model.result)
    #expect(result.elapsedMs == 1_000 && result.restarts == 1)
    #expect(try await h.events(SteppingStonesCrossed.self) == [
        SteppingStonesCrossed(baseNumber: 3, elapsedMs: 1_000, restarts: 1),
    ])
}

@MainActor @Test func padsLockDuringABeat() async throws {
    let h = try StonesHarness()
    let right = try h.pad(correct: true)
    h.model.tap(right)
    #expect(h.model.offeredHop == nil)
    h.model.tap(0)
    await h.model.lastTap?.value
    #expect(try await h.events(ProblemAttempted.self).count == 1)
    #expect(h.model.shownLanded == 1 && h.model.offeredHop != nil)
}

@MainActor @Test func bestTimesComeFromEarlierCrossingsOfTheSameNumber() async throws {
    let h = try StonesHarness()
    try await h.store.record(SteppingStonesCrossed(baseNumber: 3, elapsedMs: 5_000, restarts: 0), for: h.guest)
    try await h.store.record(SteppingStonesCrossed(baseNumber: 4, elapsedMs: 900, restarts: 0), for: h.guest)
    for _ in 0..<4 { try await h.tap(correct: true, afterMs: 1_000) }

    let result = try #require(h.model.result)
    #expect(result.verdict == .newRecord(previousMs: 5_000))
    #expect(result.board == [.init(ms: 4_000, isCurrent: true), .init(ms: 5_000, isCurrent: false)])
}

@Test func verdictsCompareToTheTenthShown() {
    typealias M = SteppingStonesModel
    #expect(M.result(elapsedMs: 4_020, restarts: 0, prior: [3_990]).verdict == .tied(previousMs: 3_990))
    #expect(M.result(elapsedMs: 3_900, restarts: 0, prior: [4_000, 3_960]).verdict == .newRecord(previousMs: 3_960))
    #expect(M.result(elapsedMs: 6_000, restarts: 2, prior: [4_000]).verdict == .slower(bestMs: 4_000))
    // Top ten; an earlier equal time stays ahead of this run.
    let board = M.result(elapsedMs: 5_000, restarts: 0, prior: Array(repeating: 5_000, count: 3)
        + (1...9).map { $0 * 1_000 }).board
    #expect(board.count == 10)
    #expect(board.map(\.ms) == [1_000, 2_000, 3_000, 4_000, 5_000, 5_000, 5_000, 5_000, 5_000, 6_000])
    #expect(board.firstIndex(where: \.isCurrent) == 8)
}

@MainActor @Test func playsTheServedSettings() throws {
    let h = try StonesHarness(baseNumber: 5, settings: .init(numStones: 6, choicesPerHop: 2))
    #expect(h.model.numStones == 6)
    #expect(h.model.crossing.hops.allSatisfy { $0.choices.count == 2 })
    #expect(h.model.crossing.hops.map(\.target) == [5, 10, 15, 20, 25, 30])
}
