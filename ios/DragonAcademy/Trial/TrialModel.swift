import Foundation
import GameRules
import Observation
import OSLog
import Store

/// Drives one Dragon's Trial: owns the `TrialSession`, the one pending tick,
/// and recording the placement when the last problem is done. The Swift form
/// of src/hooks/useDragonTrial.js plus the finish in DragonTrialPage.jsx.
///
/// Timing is `BattleModel`'s: every dispatch re-arms a single cancellable
/// sleep until `nextTimerAt`, and a late wake-up is harmless.
@Observable @MainActor
final class TrialModel {
    private(set) var session: TrialSession<AnyRandomSource>
    var trial: TrialState { session.trial }
    /// Set when the trial is done: the scores and where the kid starts.
    private(set) var outcome: TrialOutcome?

    /// The sleep waiting for the next deadline. Internal so tests can wait for it.
    @ObservationIgnored private(set) var tickTask: Task<Void, Never>?
    /// The placement being recorded; internal so tests can wait for it.
    @ObservationIgnored private(set) var recording: Task<Void, Never>?

    @ObservationIgnored private let clock: BattleClock
    @ObservationIgnored private let onComplete: @MainActor (TrialOutcome) async -> Void

    /// - Parameters:
    ///   - settings: the `trial` section of the synced rule settings, or the defaults.
    ///   - rng: `SystemRandomSource` for live play, `SeededRandom` in tests.
    ///   - onComplete: records the placement; called once.
    init(
        settings: TrialSettings = .defaults,
        rng: some RandomSource,
        clock: BattleClock = .live(),
        onComplete: @escaping @MainActor (TrialOutcome) async -> Void
    ) {
        session = TrialSession(settings: settings, rng: AnyRandomSource(rng))
        self.clock = clock
        self.onComplete = onComplete
    }

    // MARK: - Input

    /// Starts the first problem's clock. Only the first call does anything.
    func start() {
        send(.start(now: clock.now()))
    }

    func tap(_ cell: Int) {
        send(.tap(now: clock.now(), cell: cell))
    }

    /// "Too hard for me."
    func skip() {
        send(.skip(now: clock.now()))
    }

    /// Stops the pending tick, e.g. when the screen goes away.
    func stop() {
        tickTask?.cancel()
        tickTask = nil
    }

    /// Re-arms the tick after `stop()`.
    func resume() {
        guard session.started else { return }
        rearm()
    }

    /// The `onComplete` the app uses: a `TrialCompleted` event for the profile
    /// (so the map's frontier moves, it survives relaunch and queues for
    /// upload), then a sync request, which sends nothing for a guest.
    static func recordingPlacement(
        in store: (any Store)?, for profileID: Profile.ID?, requestSync: @escaping @MainActor () -> Void
    ) -> @MainActor (TrialOutcome) async -> Void {
        { outcome in
            if let store, let profileID {
                do {
                    try await store.record(TrialCompleted(outcome), for: profileID)
                } catch {
                    Logger(subsystem: "dev.placeholder.dragonacademy", category: "Trial")
                        .error("Couldn't record the trial placement: \(error)")
                }
            }
            requestSync()
        }
    }

    // MARK: - What the screen shows

    var gridMode: BattleModel.GridMode {
        if trial.status != .playing { return .over }
        if session.blanking { return .blank }
        return .ready
    }

    /// "problem 3 of 12" — the total grows once the probe is decided.
    var progressText: (number: Int, total: Int) { (trial.index + 1, trial.sequence.count) }

    // MARK: - Driving the session

    private func send(_ event: TrialEvent) {
        for effect in session.send(event) {
            // Sounds (yip, growl) wait for the Audio work; only the finish matters here.
            if case .completed(let outcome) = effect, self.outcome == nil {
                self.outcome = outcome
                recording = Task { await onComplete(outcome) }
            }
        }
        rearm()
    }

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

extension TrialCompleted {
    /// The Store's record of a trial outcome.
    init(_ outcome: TrialOutcome) {
        var perOp: [String: OpResult] = [:]
        for op in trialOps {
            let r = outcome[op]
            perOp[op.rawValue] = OpResult(score: r.score, band: r.band.rawValue, problemsAsked: r.problemsAsked)
        }
        self.init(targetNodeID: outcome.targetNodeID, perOp: perOp)
    }
}

extension TrialSettings {
    /// The `trial` section of the last synced GET /api/rule-settings, decoded
    /// as served; the defaults before the first sync or if it doesn't decode.
    static func synced(from store: (any Store)?) async -> TrialSettings {
        struct Document: Decodable { let trial: TrialSettings }
        guard let cached = try? await store?.cachedContent("rule_settings"),
            let doc = try? JSONDecoder().decode(Document.self, from: cached.json)
        else { return .defaults }
        return doc.trial
    }
}
