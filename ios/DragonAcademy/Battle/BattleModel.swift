import Foundation
import GameRules
import Observation
import OSLog
import Store

/// Drives one battle: owns the `BattleSession`, the one pending tick, and what
/// happens when the match ends. The Swift form of src/hooks/useBattle.js plus
/// the win handling in BattlePage.jsx.
///
/// Timing follows the BattleSession docs: every dispatch re-arms a single
/// cancellable sleep until `nextTimerAt`, and a late wake-up is harmless.
@Observable @MainActor
final class BattleModel {
    let nodeID: Int
    /// The map node whose battle this is.
    let node: MapNode

    private(set) var session: BattleSession<AnyRandomSource>
    var state: BattleState { session.state }

    /// The sleep waiting for the next deadline; nil when nothing is pending.
    /// Internal so tests can wait for it.
    @ObservationIgnored private(set) var tickTask: Task<Void, Never>?
    /// The last win being recorded; internal so tests can wait for it.
    @ObservationIgnored private(set) var winRecording: Task<Void, Never>?

    @ObservationIgnored private let clock: BattleClock
    @ObservationIgnored private let onWin: @MainActor (NodeWin) async -> Void
    /// Set once the current match's win has been handed to `onWin`, so a
    /// match is recorded once however many events follow it.
    @ObservationIgnored private var recordedWin = false
    @ObservationIgnored private var started = false

    /// What a won match reports.
    struct NodeWin: Equatable {
        var nodeID: Int
        var stars: Int
    }

    /// - Parameters:
    ///   - rng: `SystemRandomSource` for live play, `SeededRandom` in tests.
    ///   - onWin: records the win; called once per won match.
    init(
        nodeID: Int,
        rng: some RandomSource,
        clock: BattleClock = .live(),
        onWin: @escaping @MainActor (NodeWin) async -> Void
    ) {
        self.nodeID = nodeID
        // A node that isn't on the map plays node 1's battle, as on the web.
        let node = GameMap.node(nodeID) ?? GameMap.nodes[0]
        self.node = node
        session = BattleSession(config: node.battleConfig, layout: node.battleLayout, rng: AnyRandomSource(rng))
        self.clock = clock
        self.onWin = onWin
    }

    // MARK: - Input

    /// Starts the clocks and the opponent. Only the first call does anything.
    func start() {
        guard !started else { return }
        started = true
        send(.start(now: clock.now()))
    }

    func tap(_ cell: Int) {
        guard started else { return }
        send(.tap(now: clock.now(), cell: cell))
    }

    /// A fresh match on the same node.
    func retry() {
        guard started else { return }
        recordedWin = false
        send(.retry(now: clock.now()))
    }

    /// Stops the pending tick, e.g. when the battle screen goes away.
    func stop() {
        tickTask?.cancel()
        tickTask = nil
    }

    /// Re-arms the tick after `stop()`; deadlines that passed meanwhile fire
    /// on the first tick, at their own times.
    func resume() {
        guard started else { return }
        rearm()
    }

    /// The `onWin` the app uses: a `NodeWon` event for the profile in the
    /// Store (so it survives relaunch and queues for upload), then a sync
    /// request, which returns at once and sends nothing for a guest.
    static func recordingWins(
        in store: (any Store)?, for profileID: Profile.ID?, requestSync: @escaping @MainActor () -> Void
    ) -> @MainActor (NodeWin) async -> Void {
        { win in
            if let store, let profileID {
                do {
                    try await store.record(NodeWon(nodeID: win.nodeID, stars: win.stars), for: profileID)
                } catch {
                    Logger(subsystem: "dev.placeholder.dragonacademy", category: "Battle")
                        .error("Couldn't record node \(win.nodeID) won: \(error)")
                }
            }
            requestSync()
        }
    }

    // MARK: - What the screen shows

    enum GridMode: String {
        /// Tappable.
        case ready
        /// Between problems: numbers hidden.
        case blank
        /// The wrong-tap pause.
        case locked
        /// The match is over.
        case over
    }

    var gridMode: GridMode {
        if state.status != .playing { return .over }
        if state.blanking { return .blank }
        if state.gridLocked { return .locked }
        return .ready
    }

    /// "1 + 2", the problem without its answer.
    var problemText: String {
        let p = state.problem
        return "\(p.a) \(p.op.symbol) \(p.b)"
    }

    /// Stars for a won match, as BattlePage.jsx's `computeStars`: 3 if the
    /// opponent got fewer than half the target, 2 if under three quarters,
    /// else 1.
    static func stars(aiScore: Int, target: Int) -> Int {
        let ai = Double(aiScore), t = Double(target)
        if ai < t * 0.5 { return 3 }
        if ai < t * 0.75 { return 2 }
        return 1
    }

    // MARK: - Driving the session

    private func send(_ event: BattleEvent) {
        // Effects are sounds and attempt/wrong-tap logging; the Audio module
        // and those event kinds haven't landed yet, so nothing uses them.
        _ = session.send(event)
        if state.status == .won && !recordedWin {
            recordedWin = true
            let win = NodeWin(nodeID: nodeID, stars: Self.stars(aiScore: state.aiScore, target: state.target))
            winRecording = Task { await onWin(win) }
        }
        rearm()
    }

    /// One sleep for the earliest deadline, re-armed after every dispatch.
    private func rearm() {
        tickTask?.cancel()
        tickTask = nil
        guard let at = session.nextTimerAt else { return }
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
}

/// Where a battle gets the time and how it waits. Times are ms on any epoch,
/// the numbers BattleSession wants.
struct BattleClock: Sendable {
    /// The current time in ms.
    var now: @MainActor @Sendable () -> Double
    /// Returns at or after the given time (ms), or throws when cancelled.
    var sleepUntil: @Sendable (Double) async throws -> Void

    /// The real clock: ms since this clock was made.
    static func live() -> BattleClock {
        let clock = ContinuousClock()
        let epoch = clock.now
        let now: @Sendable () -> Double = {
            let d = clock.now - epoch
            return Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
        }
        return BattleClock(
            now: now,
            sleepUntil: { at in
                try await Task.sleep(for: .milliseconds(Swift.max(0, at - now())))
            })
    }
}

/// A `RandomSource` of any concrete type, so the model needn't be generic over
/// its generator.
struct AnyRandomSource: RandomSource {
    private var base: any RandomSource

    init(_ base: some RandomSource) {
        self.base = base
    }

    mutating func next() -> Double {
        base.next()
    }
}
