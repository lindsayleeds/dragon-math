import Audio
import Foundation
import GameRules
import Observation
import OSLog
import Store
import Sync

/// Drives one Stepping Stones crossing for the Learning Lair — the state of
/// src/components/SteppingStones.jsx. The rule (hops, what a tap does) is
/// GameRules' `SteppingStonesCrossing`; this adds the web's beats (stamp the
/// number, hop, or plunge and start over), the run timer, and recording.
///
/// Every pad tapped is recorded as the web's practice-game attempt
/// (`ProblemAttempted`, node 0, baseNumber × hop) and a wrong one also as a
/// `WrongAnswerTapped`; both upload as telemetry. A finished crossing is a
/// `SteppingStonesCrossed` event, which the per-number best times are read
/// from (on the web that board lives in localStorage). Sounds are the web's:
/// correct on a right pad, a splash as the otter drops in, win at the far bank.
@MainActor @Observable
final class SteppingStonesModel {
    /// The web's beats, in ms (SteppingStones.jsx).
    enum Timing {
        /// The number flashes onto the rock this long before the hop.
        static let stamp = 60.0
        /// The otter's leap onto a rock or pad.
        static let hop = 160.0
        /// The otter sinks and the splash plays out.
        static let sink = 750.0
        /// Pause on the near bank before the next attempt.
        static let reset = 600.0
    }

    /// Where the otter is drawn.
    enum Otter: Equatable {
        /// On the near bank, left of the first rock.
        case start
        /// On rock `index`.
        case rock(Int)
        /// On the `index`th pad of the current hop (a wrong leap).
        case pad(Int)
    }

    /// One row of the best-times board.
    struct BoardEntry: Equatable {
        var ms: Int
        /// This run's time.
        var isCurrent: Bool
    }

    /// How a won crossing compares with the best time before it.
    enum Verdict: Equatable {
        case first
        case newRecord(previousMs: Int)
        case tied(previousMs: Int)
        case slower(bestMs: Int)
    }

    struct Result: Equatable {
        var elapsedMs: Int
        var restarts: Int
        var verdict: Verdict?
        /// The top ten times for this number, this run's marked.
        var board: [BoardEntry]
    }

    nonisolated static let boardSize = 10
    /// Practice games record their attempts under node 0, as on the web.
    static let nodeID = 0

    let baseNumber: Int
    let path: [StonePosition]
    private(set) var crossing: SteppingStonesCrossing

    /// Rocks shown as landed (numbered). Trails `crossing.landed` through a
    /// fall so the rocks keep their numbers while the otter sinks.
    private(set) var shownLanded = 0
    /// A rock whose number is being stamped on.
    private(set) var stamping: (index: Int, value: Int)?
    private(set) var otter: Otter = .start
    private(set) var otterHopping = false
    private(set) var otterSinking = false
    /// Bumped when the otter reappears on the near bank (no slide back).
    private(set) var otterGeneration = 0
    /// "Oops! Back to the start!"
    private(set) var showReset = false
    /// Input is locked during a beat.
    private(set) var busy = false
    private(set) var result: Result?

    /// The last tap's beats and writes, for tests to await.
    private(set) var lastTap: Task<Void, Never>?

    private let store: (any Store)?
    private let profileID: Profile.ID?
    private let sync: SyncEngine?
    private let clock: @MainActor () -> Double
    private let sleep: @Sendable (Double) async throws -> Void
    @ObservationIgnored private let playSound: @MainActor (SoundEffect) -> Void
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "SteppingStones")
    private var runStart: Double
    private var hopShownAt: Double

    /// - Parameters:
    ///   - clock: monotonic milliseconds (any epoch).
    ///   - sleep: waits the given milliseconds; tests make it instant.
    ///   - seed: a fixed crossing for tests; nil = system randomness.
    ///   - playSound: `AudioPlayer.play`.
    init(
        baseNumber: Int, store: (any Store)?, profileID: Profile.ID?, sync: SyncEngine?,
        settings: SteppingStonesSettings = .defaults,
        clock: @escaping @MainActor () -> Double = ProvingGroundsModel.monotonicMs,
        sleep: @escaping @Sendable (Double) async throws -> Void = { try await Task.sleep(for: .milliseconds($0)) },
        seed: UInt64? = nil,
        playSound: @escaping @MainActor (SoundEffect) -> Void = { _ in }
    ) {
        self.baseNumber = baseNumber
        self.store = store
        self.profileID = profileID
        self.sync = sync
        self.clock = clock
        self.sleep = sleep
        self.playSound = playSound
        let crossing: SteppingStonesCrossing
        if let seed {
            var rng = SeededRandom(seed: seed)
            crossing = SteppingStonesCrossing(baseNumber: baseNumber, settings: settings, rng: &rng)
        } else {
            var rng = SystemRandomSource()
            crossing = SteppingStonesCrossing(baseNumber: baseNumber, settings: settings, rng: &rng)
        }
        self.crossing = crossing
        path = SteppingStones.buildPath(crossing.hops.count)
        let start = clock()
        runStart = start
        hopShownAt = start
    }

    var numStones: Int { crossing.hops.count }
    var streak: Int { crossing.streak }
    var restarts: Int { crossing.restarts }

    /// The hop whose pads are showing, if any are (none during a beat).
    var offeredHop: SteppingStoneHop? { busy || result != nil ? nil : crossing.currentHop }

    /// The run's time so far (frozen once won).
    func elapsedMs() -> Double {
        result.map { Double($0.elapsedMs) } ?? max(0, clock() - runStart)
    }

    /// Taps the `index`th pad of the offered hop.
    func tap(_ index: Int) {
        guard !busy, result == nil, let hop = crossing.currentHop, hop.choices.indices.contains(index) else { return }
        let now = clock()
        let hopNumber = crossing.landed + 1
        let tapped = hop.choices[index].value
        let timeMs = Int((now - hopShownAt).rounded())
        let outcome = crossing.tap(index)
        busy = true
        switch outcome {
        case .ignored:
            busy = false
        case .landed(let rock, let won):
            let attempt = ProblemAttempted(
                nodeID: Self.nodeID, operandA: baseNumber, operandB: hopNumber, op: BattleOp.mul.rawValue,
                answer: hop.target, outcome: "child", timeMs: timeMs)
            let runMs = Int((now - runStart).rounded())
            stamping = (rock, tapped)
            playSound(.correct)
            lastTap = Task { [weak self] in
                guard let self else { return }
                await self.record([attempt])
                await self.land(on: rock, won: won, runMs: runMs)
            }
        case .fell:
            let events: [any EventPayload] = [
                ProblemAttempted(
                    nodeID: Self.nodeID, operandA: baseNumber, operandB: hopNumber, op: BattleOp.mul.rawValue,
                    answer: hop.target, outcome: "ai", timeMs: timeMs),
                WrongAnswerTapped(
                    nodeID: Self.nodeID, operandA: baseNumber, operandB: hopNumber, op: BattleOp.mul.rawValue,
                    correctAnswer: hop.target, tappedValue: tapped, timeMs: timeMs),
            ]
            otter = .pad(index)
            otterHopping = true
            lastTap = Task { [weak self] in
                guard let self else { return }
                await self.record(events)
                await self.fall()
            }
        }
    }

    // MARK: - Beats

    private func land(on rock: Int, won: Bool, runMs: Int) async {
        await pause(Timing.stamp)
        otter = .rock(rock)
        otterHopping = true
        await pause(Timing.hop)
        shownLanded = rock + 1
        stamping = nil
        otterHopping = false
        if won {
            await finish(runMs: runMs)
        } else {
            hopShownAt = clock()
        }
        busy = false
    }

    private func fall() async {
        await pause(Timing.hop)
        otterHopping = false
        otterSinking = true
        playSound(.splash)
        await pause(Timing.sink)
        otterSinking = false
        otter = .start
        otterGeneration += 1
        shownLanded = 0
        showReset = true
        runStart = clock()
        await pause(Timing.reset)
        showReset = false
        hopShownAt = clock()
        busy = false
    }

    private func pause(_ ms: Double) async {
        try? await sleep(ms)
    }

    private func finish(runMs: Int) async {
        let prior = await priorTimes()
        let crossed = SteppingStonesCrossed(baseNumber: baseNumber, elapsedMs: runMs, restarts: crossing.restarts)
        await record([crossed])
        result = Self.result(elapsedMs: runMs, restarts: crossing.restarts, prior: prior)
        playSound(.win)
    }

    /// The finish screen for a run of `elapsedMs` against `prior` times for the
    /// same number (the web's verdict, compared to the tenth shown).
    nonisolated static func result(elapsedMs: Int, restarts: Int, prior: [Int]) -> Result {
        let verdict: Verdict
        if let best = prior.min() {
            let mine = tenths(elapsedMs), theirs = tenths(best)
            verdict = mine < theirs ? .newRecord(previousMs: best)
                : mine == theirs ? .tied(previousMs: best) : .slower(bestMs: best)
        } else {
            verdict = .first
        }
        let entries = prior.map { BoardEntry(ms: $0, isCurrent: false) } + [BoardEntry(ms: elapsedMs, isCurrent: true)]
        // Stable: an earlier run with the same time stays ahead, as on the web.
        let board = entries.enumerated()
            .sorted { ($0.element.ms, $0.offset) < ($1.element.ms, $1.offset) }
            .prefix(boardSize).map(\.element)
        return Result(elapsedMs: elapsedMs, restarts: restarts, verdict: verdict, board: Array(board))
    }

    nonisolated private static func tenths(_ ms: Int) -> Int { Int((Double(ms) / 100).rounded()) }

    // MARK: - Store

    /// This profile's earlier crossing times for this number, oldest first.
    private func priorTimes() async -> [Int] {
        guard let store, let profileID else { return [] }
        do {
            return try await store.events(for: profileID)
                .compactMap { try $0.decode(SteppingStonesCrossed.self) }
                .filter { $0.baseNumber == baseNumber }
                .map(\.elapsedMs)
        } catch {
            log.error("stepping stones: couldn't read past crossings: \(error)")
            return []
        }
    }

    private func record(_ events: [any EventPayload]) async {
        guard let store, let profileID else { return }
        do {
            for event in events { try await store.record(event, for: profileID) }
            sync?.requestSync()
        } catch {
            // The crossing still plays; there's nothing a kid can do.
            log.error("stepping stones: couldn't record: \(error)")
        }
    }
}
