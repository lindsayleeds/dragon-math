import Foundation
import GameRules
import OSLog
import Store
import Sync

/// Drives the Egg Hatchery: one `HatcheryRound` of twelve problems on the
/// facts the kid picked in the Learning Lair, its timers (the hatch, the "try
/// again", the hint offer), and recording a finished round. A finished round
/// is recorded as twelve `ProblemAttempted` events (sync kind `attempt`) and
/// one `DragonsCollected` (sync `dragons_collected`), like the web's
/// POST /api/game-result and /api/dragons/collect; a round the kid quits
/// records nothing, as on the web.
@MainActor @Observable
final class EggHatcheryModel {
    /// What a round draws from: the synced catalog's dragon ids (nil = the
    /// fallback art range) and the synced tunables.
    struct Context: Equatable {
        var pool: [Int]?
        var settings: EggHatcherySettings = .defaults
    }

    let operation: BattleOp
    let baseNumber: Int
    private(set) var round: HatcheryRound?
    /// The "are you sure?" card is up.
    var confirmingQuit = false
    /// The Store writes of the finished round, for tests to await.
    private(set) var lastWrite: Task<Void, Never>?

    private let store: (any Store)?
    private let profileID: Profile.ID?
    private let sync: SyncEngine?
    private let clock: @MainActor () -> Double
    private let sleep: @Sendable (Double) async throws -> Void
    private var rng: ModelRandom
    private var timer: Task<Void, Never>?
    private var recorded = false
    private var left = false

    /// - Parameters:
    ///   - clock: monotonic milliseconds (any epoch).
    ///   - sleep: waits the given milliseconds; tests make it instant.
    ///   - seed: a fixed round for tests; nil = system randomness.
    init(
        facts: LairFacts, store: (any Store)?, profileID: Profile.ID?, sync: SyncEngine?,
        clock: @escaping @MainActor () -> Double = ProvingGroundsModel.monotonicMs,
        sleep: @escaping @Sendable (Double) async throws -> Void = { try await Task.sleep(for: .milliseconds($0)) },
        seed: UInt64? = nil
    ) {
        operation = facts.operation
        // The lair always hands this game a number; 1 keeps a bad route playable.
        baseNumber = min(12, max(1, facts.number ?? 1))
        self.store = store
        self.profileID = profileID
        self.sync = sync
        self.clock = clock
        self.sleep = sleep
        rng = ModelRandom(seeded: seed.map(SeededRandom.init(seed:)))
    }

    // MARK: - Starting

    /// Reads the synced catalog and settings, then starts the round. Anything
    /// missing or unreadable falls back, so this works offline and for guests.
    func load() async {
        guard round == nil else { return }
        let context = await Self.context(from: store)
        guard round == nil else { return }
        start(context)
    }

    func start(_ context: Context) {
        timer?.cancel()
        recorded = false
        round = HatcheryRound(
            operation: operation, baseNumber: baseNumber, pool: context.pool, settings: context.settings,
            now: clock(), rng: &rng)
        rearm()
    }

    static func context(from store: (any Store)?) async -> Context {
        var context = Context()
        guard let store else { return context }
        let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "EggHatchery")
        do {
            if let doc = try await store.cachedContent(.dragonCatalog) {
                let ids = doc.dragons.map(\.dragonId)
                if !ids.isEmpty { context.pool = ids }
            }
        } catch {
            log.error("Couldn't read the dragon catalog: \(error)")
        }
        do {
            if let doc = try await store.cachedContent(.ruleSettings) {
                // Through the wire JSON, decoded the way the golden tests decode it.
                context.settings = try JSONDecoder()
                    .decode(EggHatcherySettings.self, from: JSONEncoder().encode(doc.eggHatchery)).validated()
            }
        } catch {
            log.error("Couldn't read the egg hatchery settings: \(error)")
        }
        return context
    }

    // MARK: - Reading

    var current: HatcheryProblem? { round?.current }
    var result: HatcheryResult? { round?.result }
    var hatchedCount: Int { round?.hatchedCount ?? 0 }
    var choices: [Int] { round?.choices ?? [] }

    /// The button solved with, while its egg cracks.
    var hatchingButton: Int? {
        if case .hatching(let button, _) = round?.phase { return button }
        return nil
    }

    /// The button just missed, while it's marked.
    var wrongButton: Int? {
        if case .asking(let button?, _) = round?.phase { return button }
        return nil
    }

    /// "Need a hand?" shows (or "Hide hint", with the hint open).
    var showsHintButton: Bool { (round?.hintOffered ?? false) || (round?.hintShown ?? false) }

    // MARK: - Playing

    func tap(_ button: Int) {
        guard var round, !confirmingQuit, !left else { return }
        _ = round.answer(button, now: clock())
        self.round = round
        rearm()
    }

    func toggleHint() {
        guard var round else { return }
        round.toggleHint(rng: &rng)
        self.round = round
    }

    /// Runs the deadlines that are due.
    func tick() { advance(to: clock()) }

    /// Leaves the round: nothing more happens and nothing is recorded.
    func quit() {
        left = true
        timer?.cancel()
        timer = nil
        confirmingQuit = false
    }

    /// One sleep until the round's next deadline, re-armed after every change.
    private func rearm() {
        timer?.cancel()
        timer = nil
        guard let at = round?.nextTimerAt else { return }
        let wait = max(0, at - clock())
        timer = Task { [weak self, sleep] in
            do { try await sleep(wait) } catch { return }
            guard !Task.isCancelled, let self else { return }
            // No earlier than `at`, so an instant test sleep still reaches
            // the deadline it waited for.
            self.advance(to: max(self.clock(), at))
        }
    }

    private func advance(to now: Double) {
        guard var round, !left else { return }
        round.tick(now: now, rng: &rng)
        self.round = round
        if round.result != nil { record() }
        rearm()
    }

    // MARK: - Recording

    private func record() {
        guard !recorded, let round, round.result != nil, let store, let profileID else { return }
        recorded = true
        let attempts = round.attempts.map {
            ProblemAttempted(
                nodeID: 0, operandA: $0.problem.operand1, operandB: $0.problem.operand2, op: round.operation.rawValue,
                answer: $0.problem.correctAnswer, outcome: "child", timeMs: Int($0.timeMs.rounded()))
        }
        let dragons = DragonsCollected(dragonIDs: round.dragons.map(\.dragonID))
        let sync = sync
        lastWrite = Task {
            do {
                for attempt in attempts { try await store.record(attempt, for: profileID) }
                if !dragons.dragonIDs.isEmpty { try await store.record(dragons, for: profileID) }
                sync?.requestSync()
            } catch {
                // The dragons still show this session; there's nothing a kid can do.
                Logger(subsystem: "dev.placeholder.dragonacademy", category: "EggHatchery")
                    .error("Couldn't record the round: \(error)")
            }
        }
    }
}

/// The round's randomness: a fixed seed for tests, else the system's.
private struct ModelRandom: RandomSource {
    var seeded: SeededRandom?
    var system = SystemRandomSource()

    mutating func next() -> Double {
        if seeded != nil { return seeded!.next() }
        return system.next()
    }
}
