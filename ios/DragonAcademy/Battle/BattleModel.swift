import Audio
import Foundation
import GameRules
import Observation
import OSLog
import Store

/// Drives one battle: owns the `BattleSession`, the one pending tick, and what
/// happens when the match ends. The Swift form of src/hooks/useBattle.js plus
/// the win handling in BattlePage.jsx, including the dragon prize a win hands
/// out (<DragonPrizeReveal performance="high">).
///
/// A boss node (#140) opens on its intro — the web's map card for a boss —
/// and waits for `fight()`; a first win over a boss befriends its companion,
/// celebrated before the result (`stage`).
///
/// Timing follows the BattleSession docs: every dispatch re-arms a single
/// cancellable sleep until `nextTimerAt`, and a late wake-up is harmless.
@Observable @MainActor
final class BattleModel {
    let nodeID: Int
    /// The map node whose battle this is.
    let node: MapNode
    /// The companion the kid brought; its Bond Power is the one this battle
    /// can use (`useBondPower()`).
    let companion: Companion

    private(set) var session: BattleSession<AnyRandomSource>
    var state: BattleState { session.state }
    /// The current match's dragon prize.
    private(set) var prize: PrizeState = .none
    /// Where the screen is: the boss intro, the match, the befriending
    /// celebration, or the result card.
    private(set) var stage: Stage
    /// How the last match ended (stars, the boss's crown, who it
    /// befriended); nil while one is being played.
    private(set) var outcome: MatchOutcome?
    /// The companions the kid has, so a boss win befriends its companion only
    /// the first time. Grows when one is befriended here.
    private(set) var ownedCompanionIDs: Set<String>

    /// The sleep waiting for the next deadline; nil when nothing is pending.
    /// Internal so tests can wait for it.
    @ObservationIgnored private(set) var tickTask: Task<Void, Never>?
    /// The last win's prize draw and recording; internal so tests can wait
    /// for it.
    @ObservationIgnored private(set) var winRecording: Task<Void, Never>?

    @ObservationIgnored private let clock: BattleClock
    @ObservationIgnored private let onWin: @MainActor (NodeWin) async -> Void
    @ObservationIgnored private let playSound: @MainActor (SoundEffect) -> Void
    @ObservationIgnored private let loadPrizeContext: @MainActor () async -> PrizeContext
    /// Prizes draw from their own generator, so the battle's draws don't
    /// depend on how many dragons were won before.
    @ObservationIgnored private var prizeRNG: AnyRandomSource
    /// Bumped by every retry, so a slow prize draw can't land on the next match.
    @ObservationIgnored private var match = 0
    /// Set once the current match's win has been handed to `onWin`, so a
    /// match is recorded once however many events follow it.
    @ObservationIgnored private var recordedWin = false
    @ObservationIgnored private var started = false

    enum Stage: Equatable {
        /// A boss node, before the fight: "↯ boss battle ↯" and "⚔ fight
        /// the dragon" (MapPagePaper.jsx's node card for a boss).
        case bossIntro
        /// The match (still being played, or just ended and about to move on).
        case battle
        /// A first boss win: "You befriended …!" (BattlePage.jsx's
        /// CaptureOverlay), before the result.
        case befriended(Companion)
        /// The match is over: the result card.
        case result
    }

    /// What a won match reports.
    struct NodeWin: Equatable {
        var nodeID: Int
        var stars: Int
        /// The prize, one id per dragon won (a repeat appears twice).
        var dragonIDs: [Int] = []
    }

    /// - Parameters:
    ///   - companion: the kid's chosen companion; Pip when they never chose.
    ///   - ownedCompanionIDs: the companions the kid has befriended
    ///     (`Companion.befriended(nodesWon:)`); Pip alone by default.
    ///   - rng: `SystemRandomSource` for live play, `SeededRandom` in tests.
    ///   - prizeRNG: the prize draws' generator, likewise.
    ///   - prizeContext: what a prize draws from (`PrizeContext.load`); the
    ///     built-in odds and fallback range by default.
    ///   - onWin: records the win and its prize; called once per won match,
    ///     after the prize is drawn.
    ///   - playSound: `AudioPlayer.play`; the reducer's yips and growls, and
    ///     the victory or defeat when a match ends.
    init(
        nodeID: Int,
        companion: Companion = .pip,
        ownedCompanionIDs: Set<String> = [Companion.pip.id],
        rng: some RandomSource,
        prizeRNG: some RandomSource = SystemRandomSource(),
        clock: BattleClock = .live(),
        prizeContext: @escaping @MainActor () async -> PrizeContext = { PrizeContext() },
        onWin: @escaping @MainActor (NodeWin) async -> Void,
        playSound: @escaping @MainActor (SoundEffect) -> Void = { _ in }
    ) {
        self.nodeID = nodeID
        self.companion = companion
        self.ownedCompanionIDs = ownedCompanionIDs
        // A node that isn't on the map plays node 1's battle, as on the web.
        let node = GameMap.node(nodeID) ?? GameMap.nodes[0]
        self.node = node
        stage = node.isBoss ? .bossIntro : .battle
        session = BattleSession(config: node.battleConfig, layout: node.battleLayout, rng: AnyRandomSource(rng))
        self.clock = clock
        self.onWin = onWin
        self.playSound = playSound
        self.prizeRNG = AnyRandomSource(prizeRNG)
        loadPrizeContext = prizeContext
    }

    // MARK: - Input

    /// Starts the clocks and the opponent. Only the first call does anything,
    /// and on a boss node nothing happens until `fight()`.
    func start() {
        guard !started, stage == .battle else { return }
        begin()
    }

    /// Leaves the boss intro for the fight; the clocks start now.
    func fight() {
        guard !started, stage == .bossIntro else { return }
        stage = .battle
        begin()
    }

    /// From the befriending celebration on to the result card.
    func continueAfterBefriending() {
        guard case .befriended = stage else { return }
        stage = .result
    }

    private func begin() {
        started = true
        send(.start(now: clock.now()))
    }

    func tap(_ cell: Int) {
        guard started else { return }
        send(.tap(now: clock.now(), cell: cell))
    }

    /// Uses the companion's Bond Power (useBattle.js's `triggerBondPower`).
    /// The reducer refuses it while one is active, on cooldown, between
    /// problems, or once the match is over.
    func useBondPower() {
        guard started else { return }
        send(.bondPower(now: clock.now(), power: bondPower))
    }

    /// A fresh match on the same node.
    func retry() {
        guard started else { return }
        recordedWin = false
        match += 1
        prize = .none
        outcome = nil
        stage = .battle
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

    /// The `onWin` the app uses: a `NodeWon` event and a `DragonsCollected`
    /// event for the prize, for the profile in the Store (so they survive
    /// relaunch and queue for upload), then a sync request, which returns at
    /// once and sends nothing for a guest.
    static func recordingWins(
        in store: (any Store)?, for profileID: Profile.ID?, requestSync: @escaping @MainActor () -> Void
    ) -> @MainActor (NodeWin) async -> Void {
        { win in
            if let store, let profileID {
                let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Battle")
                do {
                    try await store.record(NodeWon(nodeID: win.nodeID, stars: win.stars), for: profileID)
                } catch {
                    log.error("Couldn't record node \(win.nodeID) won: \(error)")
                }
                if !win.dragonIDs.isEmpty {
                    do {
                        try await store.record(DragonsCollected(dragonIDs: win.dragonIDs), for: profileID)
                    } catch {
                        log.error("Couldn't record the prize \(win.dragonIDs): \(error)")
                    }
                }
            }
            requestSync()
        }
    }

    // MARK: - What the screen shows

    /// The Bond Power the companion brings.
    var bondPower: BondPower { companion.bondPower }

    /// Where the Bond Power button stands, as BattlePage.jsx's CompanionDock
    /// works it out.
    struct BondStatus: Equatable {
        enum Phase: Equatable {
            /// Tap to use it.
            case ready
            /// Its effect is on the board (or the shield is armed); the
            /// cooldown runs alongside.
            case active
            /// Used; waiting for the cooldown.
            case coolingDown
            /// The match is over.
            case unavailable
        }

        var phase: Phase
        /// Share of the cooldown still to run: 1 just after use, 0 when ready.
        var cooldownFraction: Double
        /// Whole seconds until it's ready again, rounded up; 0 when ready.
        var secondsLeft: Int

        /// The button takes taps only when ready. (The web leaves it enabled
        /// between problems too; the reducer refuses those, so it's the same.)
        var isEnabled: Bool { phase == .ready }
    }

    var bondStatus: BondStatus {
        let s = state
        let fraction = s.bondCooldownTotalMs > 0 ? min(1, max(0, s.bondCooldownMs / s.bondCooldownTotalMs)) : 0
        let seconds = Int((s.bondCooldownMs / 1000).rounded(.up))
        let phase: BondStatus.Phase =
            if s.status != .playing { .unavailable }
            else if s.isBondActive { .active }
            else if s.bondCooldownMs > 0 { .coolingDown }
            else { .ready }
        return BondStatus(phase: phase, cooldownFraction: fraction, secondsLeft: seconds)
    }

    /// What a Bond Power does to one grid cell, as BattlePage.jsx's cell
    /// classes. Nothing shows while the grid is blank.
    enum CellBond: Equatable {
        /// hint2x2: one of the glowing cells the answer is among.
        case hinted
        /// revealAnswer: the answer itself.
        case revealed
        /// mushroomGrove: covered, and inert until the next problem.
        case covered
        /// lightningStrike: zapped away, and inert until the next problem.
        case zapped
    }

    func cellBond(_ index: Int) -> CellBond? {
        let s = state
        if s.blanking { return nil }
        if s.mushroomCellIndices?.contains(index) == true { return .covered }
        if s.zappedCellIndices?.contains(index) == true { return .zapped }
        if s.revealCellIndex == index { return .revealed }
        if s.hintCellIndices?.contains(index) == true { return .hinted }
        return nil
    }

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

    /// Who the kid is up against: the boss dragon on a boss node, else the
    /// fox.
    var opponent: Opponent { Opponent(node: node) }

    // MARK: - Driving the session

    private func send(_ event: BattleEvent) {
        let wasPlaying = state.status == .playing
        // Attempt/wrong-tap logging isn't an event kind yet, so only the
        // sounds are used.
        for effect in session.send(event) {
            if case .sound(let sound) = effect { playSound(SoundEffect(sound)) }
        }
        // As BattlePage.jsx, which plays these when `status` changes.
        if wasPlaying, let ending = SoundEffect(endOfMatch: state.status) { playSound(ending) }
        if wasPlaying && state.status != .playing { finish() }
        if state.status == .won && !recordedWin, let stars = outcome?.stars {
            recordedWin = true
            let win = NodeWin(nodeID: nodeID, stars: stars)
            prize = .opening
            winRecording = Task { await drawPrize(for: win, match: match) }
        }
        rearm()
    }

    /// Works out how the match ended and moves on: to the befriending
    /// celebration for a first boss win, else to the result.
    private func finish() {
        let outcome = matchOutcome(
            nodeID: nodeID, won: state.status == .won, aiScore: state.aiScore, target: state.target,
            ownedCompanionIDs: ownedCompanionIDs)
        self.outcome = outcome
        if let companion = outcome.befriends {
            // Owned from now on: the NodeWon recorded for this win is what
            // befriends it (`Companion.befriended(nodesWon:)`), so a replay
            // here doesn't celebrate again.
            ownedCompanionIDs.insert(companion.id)
            stage = .befriended(companion)
        } else {
            stage = .result
        }
    }

    /// Draws the win's prize (a `high` performance, as BattlePage.jsx asks),
    /// shows it, then hands the win and its dragons to `onWin`. A retry while
    /// this runs still records the won match, but the reveal isn't shown on
    /// the new one.
    private func drawPrize(for win: NodeWin, match: Int) async {
        let context = await loadPrizeContext()
        let count = rollPrizeCount(.high, rng: &prizeRNG, settings: context.settings)
        let drawn = drawDragonPrize(catalog: context.catalog, count: count, rng: &prizeRNG, settings: context.settings)
        if match == self.match {
            prize = .revealed(PrizeCard.cards(for: drawn, owned: context.owned))
        }
        var win = win
        win.dragonIDs = drawn.map(\.dragonID)
        await onWin(win)
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

/// Who the kid battles, as BattlePage.jsx picks it: a boss node's dragon (its
/// name, and its art where the map has one) or, anywhere else, the regular
/// opponent. The web's regular opponent is a goblin (👺); iOS uses a fox,
/// keeping to CLAUDE.md's nature-forward, no-dark-themes rule.
struct Opponent: Equatable {
    var isBoss: Bool
    /// The score card's name: the boss's node label, or "fox".
    var name: LocalizedStringResource
    /// The emoji on the score card when there's no art, and on the cell the
    /// opponent grabs: 🐉 for a boss, as the web.
    var icon: String
    /// The boss's vector imageset (`Boss…`), if it has one.
    var art: String?

    init(node: MapNode) {
        if node.isBoss {
            isBoss = true
            name = node.localizedLabel
            icon = "🐉"
            art = node.bossArt
        } else {
            isBoss = false
            name = LocalizedStringResource("fox", comment: "Name of the computer opponent on regular battle nodes.")
            icon = "🦊"
            art = nil
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
