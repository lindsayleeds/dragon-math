import Foundation
import GameRules
import OSLog
import Store

/// A kid's phonics mastery, judged on the device from their own
/// `PhonicsAttempted` events — the iOS side of src/hooks/usePhonicsProgress.js.
///
/// The web asks the server (GET /api/phonics/mastery); the app judges locally
/// with GameRules' `PhonicsMastery`, the Swift port of the server's rule that
/// passes the same golden cases, so the Sound Map works offline and a kid's
/// map agrees with their parent's report on the attempts both have seen.
@MainActor @Observable
final class PhonicsProgress {
    /// The verdict of every element attempted on this device.
    private(set) var mastery: [String: PhonicsElementMastery] = [:]
    /// The pairs this kid mixes up, strongest first.
    private(set) var confusions: [PhonicsConfusion] = []
    /// False until the first load finishes.
    private(set) var loaded = false

    private let store: (any Store)?
    private let profileID: Profile.ID?
    private let now: () -> Date

    init(store: (any Store)?, profileID: Profile.ID?, now: @escaping () -> Date = Date.init) {
        self.store = store
        self.profileID = profileID
        self.now = now
    }

    /// Every curriculum element with its verdict, and the stage rollups.
    var overview: PhonicsMasteryOverview { PhonicsMasteryOverview(mastery) }

    /// What a round weights its picks by; nil before the first load, so a
    /// round dealt that early is unweighted, as on the web.
    var states: [String: PhonicsMasteryState]? { loaded ? PhonicsMastery.states(mastery) : nil }

    /// The Needs Practice sounds (learning or stale, weakest first); nil when
    /// there are none.
    var review: [String]? { Phonics.reviewTargets(states) }

    /// Re-judges from the Store: on appear, and after a round is recorded.
    func reload() async {
        guard let store, let profileID else {
            loaded = true
            return
        }
        do {
            let events = try await store.events(for: profileID)
            apply(Self.attempts(from: events))
        } catch {
            // The games still play, unweighted; the map shows what it had.
            Logger(subsystem: "dev.placeholder.dragonacademy", category: "Phonics")
                .error("Couldn't read phonics attempts: \(error)")
        }
        loaded = true
    }

    private func apply(_ attempts: [PhonicsMasteryAttempt]) {
        let nowMs = now().timeIntervalSince1970 * 1000
        mastery = PhonicsMastery.classifyAll(attempts, nowMs: nowMs)
        confusions = PhonicsMastery.confusionPairs(attempts)
    }

    /// The rule's rows from a profile's events: every `PhonicsAttempted`,
    /// timed by when it was recorded (a round records as it ends, so its
    /// answers share a time and keep their order).
    nonisolated static func attempts(from events: [StoredEvent]) -> [PhonicsMasteryAttempt] {
        events.compactMap { event in
            guard let attempt = try? event.decode(PhonicsAttempted.self) else { return nil }
            return PhonicsMasteryAttempt(
                elementKey: attempt.elementKey, mode: attempt.mode, correct: attempt.correct,
                chosen: attempt.chosen, atMs: event.occurredAt.timeIntervalSince1970 * 1000)
        }
    }
}
