// A battle and the generator it draws from, bundled so a caller doesn't have
// to thread `inout rng` through every step — the Swift form of what
// src/hooks/useBattle.js keeps in its ref. Still pure: no clock, no timers of
// its own. The caller owns time and scheduling.
//
// How a SwiftUI view model drives it (the hook's single-setTimeout pattern):
//
//   @Observable @MainActor final class BattleModel {
//       private(set) var battle: BattleSession<SystemRandomSource>
//       private var tickTask: Task<Void, Never>?
//       private let clock = ContinuousClock()
//       private let epoch = ContinuousClock.now
//
//       /// ms since the model was made; any epoch works, only differences matter.
//       private var now: Double {
//           let d = clock.now - epoch
//           return Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
//       }
//
//       func send(_ make: (Double) -> BattleEvent) {
//           let effects = battle.send(make(now))
//           perform(effects)          // sounds, attempt/wrongTap logging (+ node id)
//           rearm()
//       }
//
//       /// One sleep for the earliest deadline, re-armed after every dispatch
//       /// (not in onChange), so a burst of deadlines still fires on time.
//       private func rearm() {
//           tickTask?.cancel()
//           guard let at = battle.nextTimerAt else { return }
//           let delay = Swift.max(0, at - now)
//           tickTask = Task { [weak self] in
//               try? await Task.sleep(for: .milliseconds(delay))
//               guard !Task.isCancelled else { return }
//               self?.send { .tick(now: $0) }
//           }
//       }
//   }
//
// A late wake-up is harmless: timers fire at their own `at`, so one late tick
// replays exactly what on-time ticks would have. Cancel `tickTask` when the
// battle view goes away (and on scene backgrounding if the battle should pause
// — the rules themselves never pause).

/// A `BattleState` plus the generator it draws from.
public struct BattleSession<RNG: RandomSource> {
    public private(set) var state: BattleState
    public private(set) var rng: RNG

    /// A dealt, not-yet-started battle; send `.start(now:)` to begin.
    public init(
        config: BattleConfig,
        layout: BattleLayout,
        target: Int = problemsToWin,
        settings: BattleSettings = .defaults,
        rng: RNG
    ) {
        var rng = rng
        self.state = BattleState(config: config, layout: layout, target: target, settings: settings, rng: &rng)
        self.rng = rng
    }

    /// Resumes from an existing state and generator.
    public init(state: BattleState, rng: RNG) {
        self.state = state
        self.rng = rng
    }

    /// Applies one event and returns the effects the caller must perform.
    @discardableResult
    public mutating func send(_ event: BattleEvent) -> [BattleEffect] {
        let step = stepBattle(state, event, rng: &rng)
        if step.changed { state = step.state }
        return step.effects
    }

    /// When to send the next `.tick`; nil when nothing is pending.
    public var nextTimerAt: Double? { state.nextTimerAt }
}

extension BattleSession: Sendable where RNG: Sendable {}
extension BattleSession: Equatable where RNG: Equatable {}
