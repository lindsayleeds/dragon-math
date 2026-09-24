import Foundation
import GameRules
import Store
import Sync

/// Drives the Proving Grounds screens: pick × or ÷, pick a digit, play the
/// timed drill (`ProvingDrill`), see the medal. A medal run is recorded as a
/// `ProvingMedalEarned` Store event — which is what the level grid's medals and
/// best times are derived from — and Sync is nudged to upload it.
@MainActor @Observable
final class ProvingGroundsModel {
    enum Screen: Equatable {
        case mode
        case level
        case play
        case result
    }

    /// How a finished run compares with what the profile had before it.
    struct RunSummary: Equatable {
        var result: ProvingResult
        /// First medal on this level, or better than any before.
        var isBestMedal: Bool
        /// A medal run faster than any before on this level.
        var isBestTime: Bool
    }

    struct Feedback: Equatable {
        var id: Int
        var correct: Bool
    }

    /// Answers are at most 3 digits (the largest is 12 × 12 = 144).
    static let maxInputLength = 3

    private(set) var screen: Screen = .mode
    private(set) var mode: ProvingMode = .mul
    private(set) var digit = 2
    private(set) var drill: ProvingDrill?
    private(set) var input = ""
    /// Bumped on every answer, so the problem card can pulse.
    private(set) var feedback = Feedback(id: 0, correct: true)
    private(set) var bests: [String: ProvingBest] = [:]
    private(set) var lastRun: RunSummary?
    /// The Store write of the last medal, for tests to await.
    private(set) var lastWrite: Task<Void, Never>?

    let settings: ProvingGroundsSettings
    private let store: (any Store)?
    private let profileID: Profile.ID?
    private let sync: SyncEngine?
    private let clock: @MainActor () -> Double
    private let sleep: @Sendable (Double) async throws -> Void
    private let seed: UInt64?
    private var runs = 0
    private var correctionTask: Task<Void, Never>?

    /// - Parameters:
    ///   - clock: monotonic milliseconds (any epoch).
    ///   - sleep: waits the given milliseconds; tests make it instant.
    ///   - seed: a fixed problem order for tests; nil = system randomness.
    init(
        store: (any Store)?, profileID: Profile.ID?, sync: SyncEngine?,
        settings: ProvingGroundsSettings = .defaults,
        clock: @escaping @MainActor () -> Double = ProvingGroundsModel.monotonicMs,
        sleep: @escaping @Sendable (Double) async throws -> Void = { try await Task.sleep(for: .milliseconds($0)) },
        seed: UInt64? = nil
    ) {
        self.store = store
        self.profileID = profileID
        self.sync = sync
        self.settings = settings
        self.clock = clock
        self.sleep = sleep
        self.seed = seed
    }

    private static let origin = ContinuousClock.now
    static func monotonicMs() -> Double {
        let d = origin.duration(to: .now).components
        return Double(d.seconds) * 1000 + Double(d.attoseconds) / 1e15
    }

    // MARK: - Reading

    /// Medals and best times from the Store's events.
    func load() async {
        guard let store, let profileID else { return }
        if let progress = try? await store.progress(for: profileID) {
            bests = progress.provingBests
        }
    }

    func best(_ mode: ProvingMode, _ digit: Int) -> ProvingBest? {
        bests[Self.level(mode, digit)]
    }

    func bestMedal(_ mode: ProvingMode, _ digit: Int) -> Medal? {
        best(mode, digit).flatMap { Medal(rawValue: $0.medal) }
    }

    static func level(_ mode: ProvingMode, _ digit: Int) -> String { "\(mode.rawValue)-\(digit)" }

    func elapsedSec() -> Double { drill?.elapsedSec(now: clock()) ?? 0 }

    var correction: ProvingFact? {
        if case .correcting(let fact, _) = drill?.phase { return fact }
        return nil
    }

    // MARK: - Navigation

    func choose(_ mode: ProvingMode) {
        self.mode = mode
        screen = .level
    }

    func start(_ digit: Int) {
        correctionTask?.cancel()
        self.digit = digit
        runs += 1
        if let seed {
            var rng = SeededRandom(seed: seed &+ UInt64(runs - 1))
            drill = ProvingDrill(mode: mode, digit: digit, settings: settings, now: clock(), rng: &rng)
        } else {
            var rng = SystemRandomSource()
            drill = ProvingDrill(mode: mode, digit: digit, settings: settings, now: clock(), rng: &rng)
        }
        input = ""
        lastRun = nil
        screen = .play
    }

    func retry() { start(digit) }

    func pickAnother() { screen = .level }

    /// One step back; from the drill this abandons the run (nothing is recorded).
    func back() {
        correctionTask?.cancel()
        switch screen {
        case .mode: break
        case .level: screen = .mode
        case .play, .result:
            drill = nil
            screen = .level
        }
    }

    // MARK: - Playing

    enum Key: Hashable {
        case digit(Int)
        case delete
        case ok
    }

    func press(_ key: Key) {
        guard screen == .play, correction == nil else { return }
        switch key {
        case .digit(let d):
            if input.count < Self.maxInputLength { input += String(d) }
        case .delete:
            if !input.isEmpty { input.removeLast() }
        case .ok:
            submit()
        }
    }

    private func submit() {
        guard var drill, let value = Int(input) else { return }
        let outcome = drill.answer(value, now: clock())
        guard outcome != .ignored else { return }
        self.drill = drill
        input = ""
        feedback = Feedback(id: feedback.id + 1, correct: outcome == .correct)
        if drill.result != nil {
            finish()
        } else if let at = drill.nextTimerAt {
            scheduleTick(at: at)
        }
    }

    /// Ends the correction pause at `at` (the drill decides whether the run
    /// goes on or ends there).
    private func scheduleTick(at: Double) {
        correctionTask?.cancel()
        let wait = max(0, at - clock())
        correctionTask = Task { [weak self, sleep] in
            do { try await sleep(wait) } catch { return }
            self?.tick()
        }
    }

    func tick() {
        guard var drill else { return }
        drill.tick(now: max(clock(), drill.nextTimerAt ?? 0))
        self.drill = drill
        if drill.result != nil { finish() }
    }

    private func finish() {
        guard let result = drill?.result, screen == .play else { return }
        let level = Self.level(mode, digit)
        let prior = bests[level]
        var summary = RunSummary(result: result, isBestMedal: false, isBestTime: false)
        if let medal = result.medal {
            let elapsedMs = Int((result.elapsedSec * 1000).rounded())
            summary.isBestMedal = prior.flatMap { Medal(rawValue: $0.medal) }.map { medal > $0 } ?? true
            summary.isBestTime = prior.map { elapsedMs < $0.bestMs } ?? true
            bests[level] = ProvingBest(
                medal: summary.isBestMedal ? medal.rawValue : prior?.medal ?? medal.rawValue,
                bestMs: min(elapsedMs, prior?.bestMs ?? elapsedMs))
            record(ProvingMedalEarned(
                mode: mode.rawValue, digit: digit, medal: medal.rawValue, elapsedMs: max(1, elapsedMs),
                wrongCount: result.wrongCount))
        }
        lastRun = summary
        screen = .result
    }

    private func record(_ event: ProvingMedalEarned) {
        guard let store, let profileID else { return }
        let sync = sync
        lastWrite = Task {
            do {
                try await store.record(event, for: profileID)
                sync?.requestSync()
            } catch {
                // The medal still shows this session; there's nothing a kid can do.
            }
        }
    }
}
