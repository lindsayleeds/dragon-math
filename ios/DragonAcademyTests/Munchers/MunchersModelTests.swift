import Audio
import Foundation
import GameRules
import Store
import Testing
@testable import DragonAcademy

/// MunchersModel on the hand-moved `TestClock` (BattleModelTests): nothing
/// here waits in real time. The reducer's own rules are GameRules'
/// MunchersTests; these pin the clock loop, input, sounds and recording.
@MainActor
private struct MunchersHarness {
    let clock = TestClock()
    let sounds = SoundLog()
    let store: SQLiteStore
    let model: MunchersModel

    /// ×3, one base, on golden/munchers.json's "caught-three-times" seed.
    init(seed: UInt64 = 3, progression: Bool = false, highScore: Int = 0) throws {
        store = try .inMemory()
        model = MunchersModel(
            operation: .mul, baseNumber: 3, progression: progression, highScore: highScore,
            store: store, profileID: store.guestProfile.id, sync: nil,
            clock: clock.battleClock, rng: SeededRandom(seed: seed), playSound: sounds.play)
    }

    var guest: Profile.ID { store.guestProfile.id }

    /// Moves the clock to `time` and lets the pending tick, if it's due, run.
    func advance(to time: Double) async {
        clock.now = time
        while let at = model.state.nextTimerAt, at <= clock.now, let task = model.tickTask {
            clock.wakeDue()
            await task.value
        }
    }

    /// Walks to `target` with the arrows, columns first, at the current time.
    func walk(to target: Int) {
        while model.state.muncher != target {
            let here = model.state.muncher
            let dc = Munchers.col(target) - Munchers.col(here)
            let dr = Munchers.row(target) - Munchers.row(here)
            model.move(dc < 0 ? .left : dc > 0 ? .right : dr < 0 ? .up : .down)
        }
    }

    /// The first cell holding a right (or wrong) answer.
    func cell(correct: Bool) throws -> Int {
        let s = model.state
        return try #require(s.board.indices.first { s.board[$0] != nil && s.isCorrectValue(s.board[$0]) == correct })
    }

    func events<T: EventPayload>(_: T.Type) async throws -> [T] {
        await model.recording?.value
        return try await store.events(for: guest).compactMap { try $0.decode(T.self) }
    }
}

@MainActor @Test func startArmsTheClocks() throws {
    let h = try MunchersHarness()
    #expect(!h.model.state.started && h.model.tickTask == nil)
    h.model.start()
    #expect(h.model.state.started)
    #expect(h.model.state.timers.map(\.kind) == [.spawn, .enemyPlan])
    let firstDeadline = try #require(h.model.state.nextTimerAt)
    #expect(abs(firstDeadline - 4_000.0) < 0.001, "first deadline \(firstDeadline)")
    #expect(h.model.tickTask != nil)
}

@MainActor @Test func paceSlowsOrStopsTheMonsters() throws {
    let store = try SQLiteStore.inMemory()
    let slow = MunchersModel(
        operation: .mul, baseNumber: 3, progression: false, pace: .slow, store: store,
        profileID: store.guestProfile.id, clock: TestClock().battleClock, rng: SeededRandom(seed: 3))
    slow.start()
    #expect(slow.state.pace == .slow)
    let d = MunchersSettings.defaults
    // Started at the test clock's 1 000 ms.
    #expect(slow.state.timers.map(\.kind) == [.spawn, .enemyPlan])
    #expect(slow.state.timers.map(\.at) == [
        1_000 + d.spawnIntervalMs * GamePace.slowFactor, 1_000 + d.enemyMoveIntervalMs * GamePace.slowFactor,
    ])

    let untimed = MunchersModel(
        operation: .mul, baseNumber: 3, progression: false, pace: .off, store: store,
        profileID: store.guestProfile.id, clock: TestClock().battleClock, rng: SeededRandom(seed: 3))
    untimed.start()
    #expect(untimed.state.started)
    #expect(untimed.state.timers.isEmpty)
    #expect(untimed.tickTask == nil)
}

@MainActor @Test func theClockLoopPlaysWhatTheReducerPlays() async throws {
    let h = try MunchersHarness()
    h.model.start()
    // The same game straight through the reducer, ticking at each deadline.
    var rng = SeededRandom(seed: 3)
    var state = MunchersState(operation: .mul, baseNumber: 3, rng: &rng)
    state = stepMunchers(state, .start(now: 1_000), rng: &rng).state
    for _ in 0..<12 {
        let at = try #require(state.nextTimerAt)
        state = stepMunchers(state, .tick(now: at), rng: &rng).state
        await h.advance(to: at)
        #expect(h.model.state == state)
    }
    #expect(!h.model.state.enemies.isEmpty)
}

@MainActor @Test func aRightAnswerIsRecordedAndChimes() async throws {
    let h = try MunchersHarness()
    h.model.start()
    let target = try h.cell(correct: true)
    let value = try #require(h.model.state.board[target])
    h.clock.now = 1_800
    h.walk(to: target)
    h.model.eat()

    #expect(h.model.state.score == 5)
    #expect(h.model.state.babyDragons.count == 1)
    #expect(h.sounds.played == [.correct])
    #expect(try await h.events(ProblemAttempted.self) == [
        ProblemAttempted(nodeID: 0, operandA: 3, operandB: value / 3, op: "mul", answer: value, outcome: "child", timeMs: 800),
    ])
    #expect(try await h.events(WrongAnswerTapped.self).isEmpty)
    // A second munch of the same cell does nothing.
    h.model.eat()
    #expect(try await h.events(ProblemAttempted.self).count == 1)
}

@MainActor @Test func aWrongAnswerShowsTheMessageAndCostsALifeWhenClosed() async throws {
    let h = try MunchersHarness()
    h.model.start()
    let target = try h.cell(correct: false)
    let value = try #require(h.model.state.board[target])
    let fact = try #require(Munchers.nearestFact(to: value, operation: .mul, baseNumber: 3))
    h.clock.now = 2_500
    h.walk(to: target)
    h.model.tap(target)

    #expect(h.model.state.wrongAnswer == MunchersWrongAnswer(operation: .mul, baseNumber: 3, value: value))
    #expect(MunchersModel.message(for: try #require(h.model.state.wrongAnswer)) == "\(value) is not a multiple of 3")
    #expect(h.sounds.played == [.wrong])
    #expect(try await h.events(ProblemAttempted.self) == [
        ProblemAttempted(
            nodeID: 0, operandA: 3, operandB: fact.operandB, op: "mul", answer: fact.answer, outcome: "ai", timeMs: 1_500),
    ])
    #expect(try await h.events(WrongAnswerTapped.self) == [
        WrongAnswerTapped(
            nodeID: 0, operandA: 3, operandB: fact.operandB, op: "mul", correctAnswer: fact.answer, tappedValue: value,
            timeMs: 1_500),
    ])

    h.model.dismissWrongAnswer()
    #expect(h.model.state.wrongAnswer == nil)
    #expect(h.model.state.lives == 2)
}

@MainActor @Test func standingStillGetsCaughtThreeTimesAndTheScoreIsRecorded() async throws {
    let h = try MunchersHarness(highScore: 40)
    h.model.start()
    var t = 1_000.0
    while !h.model.state.gameOver, t < 200_000 {
        t = try #require(h.model.state.nextTimerAt)
        await h.advance(to: t)
    }
    #expect(h.model.state.gameOver && h.model.state.lives == 0)
    #expect(!h.model.won)
    #expect(h.sounds.played == [.caught, .caught, .caught])
    #expect(!h.model.state.isNewHighScore && h.model.state.highScore == 40)
    #expect(try await h.events(MunchersGameEnded.self) == [
        MunchersGameEnded(score: 0, won: false, progression: false, level: 1),
    ])
    // Nothing left to wait for once the last gobble beat is over.
    await h.advance(to: t + 10_000)
    #expect(h.model.state.nextTimerAt == nil && h.model.tickTask == nil)
}

@MainActor @Test func swipesWaitOutTheGobbleBeatButTheArrowsDoNot() async throws {
    let h = try MunchersHarness()
    h.model.start()
    // Let the monsters come until one catches the muncher.
    for _ in 0..<200 where h.model.state.caughtAt == nil {
        await h.advance(to: try #require(h.model.state.nextTimerAt))
    }
    try #require(h.model.state.caughtAt != nil)
    let caughtAt = h.model.muncherCell
    h.model.steer(.left)
    #expect(h.model.muncherCell == caughtAt)
    h.model.move(.up)
    #expect(h.model.muncherCell == Munchers.step(from: caughtAt, .up))
    // Eating is refused while frozen.
    h.model.eat()
    #expect(try await h.events(ProblemAttempted.self).isEmpty)
}

@MainActor @Test func theHighScoreIsTheBestFinishedGame() async throws {
    let store = try SQLiteStore.inMemory()
    let guest = store.guestProfile.id
    #expect(await MunchersModel.highScore(store: store, profileID: guest) == 0)
    for score in [35, 120, 60] {
        try await store.record(MunchersGameEnded(score: score, won: false, progression: true, level: 2), for: guest)
    }
    #expect(await MunchersModel.highScore(store: store, profileID: guest) == 120)
    #expect(await MunchersModel.highScore(store: nil, profileID: nil) == 0)
}

@MainActor @Test func aCampaignTitlesEachLevel() throws {
    let h = try MunchersHarness(progression: true)
    #expect(h.model.state.levels.count == 8)
    #expect(h.model.title(base: 4) == "Multiples of 4")
    #expect(MunchersModel.title(.div, base: 6) == "Dividing by 6")
}

/// The issue's 60 fps check wants the oldest iOS 18 iPad, which this Mac
/// can't run; this pins the model's share of a frame instead: a dispatch
/// (reducer, observation, re-arming the tick) must be far under 16.7 ms.
@MainActor @Test func aDispatchIsCheapNextToAFrame() throws {
    let h = try MunchersHarness(progression: true)
    h.model.start()
    let moves: [MunchersDirection] = [.up, .left, .down, .right]
    let n = 2_000
    let elapsed = ContinuousClock().measure {
        for i in 0..<n { h.model.move(moves[i % 4]) }
    }
    let perMoveMs = (Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15) / Double(n)
    print("munchers model: \(perMoveMs * 1000) µs a dispatch")
    #expect(perMoveMs < 2, "\(perMoveMs) ms a dispatch")
    h.model.stop()
}

private extension MunchersModel {
    var muncherCell: Int { state.muncher }
}
