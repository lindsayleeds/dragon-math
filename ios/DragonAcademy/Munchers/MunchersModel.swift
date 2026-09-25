import Audio
import Foundation
import GameRules
import Observation
import OSLog
import Store
import Sync

/// Drives one game of Dragon Munchers — what src/components/DragonMunchers.jsx
/// wraps around the reducer: it owns the `MunchersState`, keeps one sleep
/// armed for the reducer's next deadline (re-armed after every dispatch, as
/// BattleModel does), turns taps, arrows, swipes and keys into events, and
/// performs the effects — sounds, and the finished game's score.
///
/// Recording (the web records none of this but the score):
/// - every number eaten is a `ProblemAttempted` for the fact it stands for
///   (node 0, `base op k = answer`, the nearest correct answer for a wrong
///   one), and a wrong one also a `WrongAnswerTapped`; both are telemetry;
/// - a game that ends is a `MunchersGameEnded`, which uploads as the
///   `game_score` sync kind for the leaderboard (the web's POST
///   /api/leaderboard/dragon-munchers) and is where the high score is read
///   from. A game quit midway records no score, as on the web.
@Observable @MainActor
final class MunchersModel {
    /// Practice games record their attempts under node 0, as on the web.
    static let nodeID = 0

    private(set) var state: MunchersState

    /// The sleep waiting for the next deadline; nil when nothing is pending.
    /// Internal so tests can wait for it.
    @ObservationIgnored private(set) var tickTask: Task<Void, Never>?
    /// The last recording (attempts, the finished game); tests wait for it.
    @ObservationIgnored private(set) var recording: Task<Void, Never>?

    @ObservationIgnored private var rng: AnyRandomSource
    @ObservationIgnored private let clock: BattleClock
    @ObservationIgnored private let store: (any Store)?
    @ObservationIgnored private let profileID: Profile.ID?
    @ObservationIgnored private let sync: SyncEngine?
    @ObservationIgnored private let playSound: @MainActor (SoundEffect) -> Void
    @ObservationIgnored private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Munchers")
    /// When the current number hunt began: the start, the last eat, a new
    /// level or a dismissed message. An attempt's time is measured from it.
    @ObservationIgnored private var huntStartedAt: Double = 0

    /// - Parameters:
    ///   - baseNumber: the base for a single-base game; a campaign
    ///     (`progression`) plays its own bases and keeps this only as a fallback.
    ///   - highScore: the kid's best so far (`MunchersModel.highScore(store:profileID:)`).
    ///   - rng: `SystemRandomSource` for live play, `SeededRandom` in tests.
    ///   - playSound: `AudioPlayer.play`.
    init(
        operation: BattleOp, baseNumber: Int, progression: Bool, highScore: Int = 0,
        settings: MunchersSettings = .defaults,
        store: (any Store)? = nil, profileID: Profile.ID? = nil, sync: SyncEngine? = nil,
        clock: BattleClock = .live(),
        rng: some RandomSource = SystemRandomSource(),
        playSound: @escaping @MainActor (SoundEffect) -> Void = { _ in }
    ) {
        var rng = AnyRandomSource(rng)
        state = MunchersState(
            operation: operation, baseNumber: baseNumber, progression: progression, highScore: highScore,
            settings: settings, rng: &rng)
        self.rng = rng
        self.clock = clock
        self.store = store
        self.profileID = profileID
        self.sync = sync
        self.playSound = playSound
    }

    // MARK: - Input

    /// Leaves the start screen; the clocks begin.
    func start() {
        huntStartedAt = clock.now()
        send(.start(now: clock.now()))
    }

    /// The on-screen arrows: they move the muncher even while play is frozen,
    /// as on the web ("Frozen" in src/rules/munchers.js).
    func move(_ direction: MunchersDirection) {
        send(.move(now: clock.now(), direction: direction))
    }

    /// A swipe on the board or an arrow key: ignored while frozen, as the
    /// web's touch and keyboard handlers are.
    func steer(_ direction: MunchersDirection) {
        guard !state.isFrozen else { return }
        move(direction)
    }

    /// Eats the number under the muncher (the space bar).
    func eat() {
        send(.eat(now: clock.now()))
    }

    /// A tap on the muncher's own cell eats; on a neighbour, steps there.
    func tap(_ cell: Int) {
        send(.tapCell(now: clock.now(), cell: cell))
    }

    /// Closes the wrong-answer message, at the cost of a life.
    func dismissWrongAnswer() {
        huntStartedAt = clock.now()
        send(.dismissWrongAnswer(now: clock.now()))
    }

    /// Leaves the level-cleared splash for the next base.
    func advanceLevel() {
        huntStartedAt = clock.now()
        send(.advanceLevel(now: clock.now()))
    }

    /// Stops the pending tick, e.g. when the screen goes away.
    func stop() {
        tickTask?.cancel()
        tickTask = nil
    }

    /// Re-arms the tick after `stop()`; deadlines that passed meanwhile fire on
    /// the first tick, at their own times.
    func resume() {
        rearm()
    }

    // MARK: - Derived, for the screen

    var won: Bool { state.gameOver && state.totalCorrect > 0 && state.correctEaten == state.totalCorrect }

    /// "Multiples of 3", for a base in this game's operation.
    func title(base: Int) -> String {
        Self.title(state.operation, base: base)
    }

    nonisolated static func title(_ operation: BattleOp, base: Int) -> String {
        switch operation {
        case .mul: String(localized: "Multiples of \(base)")
        case .add: String(localized: "Adding \(base)")
        case .sub: String(localized: "Subtracting \(base)")
        case .div: String(localized: "Dividing by \(base)")
        }
    }

    /// The wrong-answer message, worded as on the web.
    nonisolated static func message(for wrong: MunchersWrongAnswer) -> String {
        let (base, n) = (wrong.baseNumber, wrong.value)
        switch wrong.operation {
        case .mul: return String(localized: "\(n) is not a multiple of \(base)")
        case .add, .sub, .div:
            return String(localized: "\(base) \(wrong.operation.symbol) ? does not equal \(n)")
        }
    }

    // MARK: - Dispatch

    private func send(_ event: MunchersEvent) {
        let before = state
        let step = stepMunchers(state, event, rng: &rng)
        if step.changed { state = step.state }
        recordEaten(before: before, after: step.state, now: event.now)
        for effect in step.effects {
            switch effect {
            case .sound(let sound): playSound(SoundEffect(sound))
            case .saveHighScore:
                // The best is read back from the finished games themselves.
                break
            case .gameOver(let score):
                let s = step.state
                record([MunchersGameEnded(
                    score: score, won: s.totalCorrect > 0 && s.correctEaten == s.totalCorrect,
                    progression: s.progression, level: s.level + 1)])
            }
        }
        rearm()
    }

    /// One sleep for the earliest deadline, re-armed after every dispatch.
    private func rearm() {
        tickTask?.cancel()
        tickTask = nil
        guard let at = state.nextTimerAt else { return }
        let clock = clock
        tickTask = Task { [weak self] in
            do {
                try await clock.sleepUntil(at)
            } catch {
                return
            }
            guard !Task.isCancelled, let self else { return }
            self.send(.tick(now: clock.now()))
        }
    }

    // MARK: - Recording

    /// A number was eaten when `eaten` grew on the same level.
    private func recordEaten(before: MunchersState, after: MunchersState, now: Double) {
        guard after.level == before.level, after.eaten.count == before.eaten.count + 1,
              let cell = after.eaten.last, let value = before.board[cell],
              let fact = Munchers.nearestFact(to: value, operation: before.operation, baseNumber: before.currentBase)
        else { return }
        let timeMs = Int((now - huntStartedAt).rounded())
        huntStartedAt = now
        let base = before.currentBase, op = before.operation.rawValue
        if before.isCorrectValue(value) {
            record([ProblemAttempted(
                nodeID: Self.nodeID, operandA: base, operandB: fact.operandB, op: op, answer: fact.answer,
                outcome: "child", timeMs: timeMs)])
        } else {
            record([
                ProblemAttempted(
                    nodeID: Self.nodeID, operandA: base, operandB: fact.operandB, op: op, answer: fact.answer,
                    outcome: "ai", timeMs: timeMs),
                WrongAnswerTapped(
                    nodeID: Self.nodeID, operandA: base, operandB: fact.operandB, op: op,
                    correctAnswer: fact.answer, tappedValue: value, timeMs: timeMs),
            ])
        }
    }

    /// Writes in order, one recording after another.
    private func record(_ events: [any EventPayload]) {
        guard let store, let profileID else { return }
        let previous = recording
        let sync = sync, log = log
        recording = Task {
            await previous?.value
            do {
                for event in events { try await store.record(event, for: profileID) }
                sync?.requestSync()
            } catch {
                // The game still plays; there's nothing a kid can do.
                log.error("munchers: couldn't record: \(error)")
            }
        }
    }

    /// The kid's best finished game, from their `MunchersGameEnded` events.
    static func highScore(store: (any Store)?, profileID: Profile.ID?) async -> Int {
        guard let store, let profileID else { return 0 }
        do {
            return try await store.events(for: profileID)
                .compactMap { try $0.decode(MunchersGameEnded.self)?.score }
                .max() ?? 0
        } catch {
            return 0
        }
    }
}

extension SoundEffect {
    /// The reducer's sounds, which are the web's (ios/Sounds manifest).
    init(_ sound: MunchersSound) {
        switch sound {
        case .correct: self = .correct
        case .wrong: self = .wrong
        case .caught: self = .caught
        }
    }
}
