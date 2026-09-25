import Foundation
import GameRules
import OSLog
import Store
import Sync

/// Where a phonics sound's recorded clip is: project.yml bundles the web's
/// public/audio/phonics as `phonics/`, one `<element key>.mp3` per element, so
/// every sound plays offline (PhonicsClipsTests checks each one is there).
enum PhonicsClips {
    static let folder = "phonics"

    static func url(for key: String, in bundle: Bundle = .main) -> URL? {
        bundle.url(forResource: key, withExtension: "mp3", subdirectory: folder)
    }
}

/// Drives one Dragon Phonics sound game — Sound Match (`choose`) or Sound
/// Spell (`type-it`) — the SwiftUI side of src/hooks/usePhonicsRound.js. The
/// round is dealt by GameRules' `Phonics.buildRound`; this sequences it: play,
/// feedback, the next sound, the end card.
///
/// A finished round is recorded as one `PhonicsAttempted` per question (sync
/// kind `phonics_attempt`), as the web posts the round to
/// POST /api/phonics/attempts when it ends; a round the kid leaves early
/// records nothing, as on the web.
@MainActor @Observable
final class PhonicsModel {
    enum Phase: Equatable {
        /// Waiting for an answer to `current`.
        case play
        /// Showing whether the answer was right.
        case feedback
        /// The end card.
        case done
    }

    /// One answer.
    struct Result: Equatable {
        let item: PhonicsItem
        let correct: Bool
        /// The tile tapped (Sound Match).
        let chosen: PhonicsElement?
        /// What was typed (Sound Spell).
        let typed: String?
        let attempt: PhonicsAttemptRecord

        /// What the kid answered, as shown: "you said ch".
        var said: String? { typed ?? chosen?.g }
    }

    let mode: PhonicsRoundMode
    let stages: PhonicsStages
    private(set) var items: [PhonicsItem] = []
    private(set) var index = 0
    private(set) var phase = Phase.play
    private(set) var results: [Result] = []
    /// Bumped for every deal, so the prompt for question 1 of a new round
    /// plays even though `index` is 0 again.
    private(set) var round = 0
    /// The Store writes of the finished round, for tests to await.
    private(set) var lastWrite: Task<Void, Never>?

    private let store: (any Store)?
    private let profileID: Profile.ID?
    private let sync: SyncEngine?
    private let clock: @MainActor () -> Double
    private var rng: PhonicsRandom
    /// When the prompt finished playing, so the response time measures
    /// thinking rather than listening; nil while it plays.
    private var promptDoneAt: Double?
    private var recordedRound: Int?

    /// - Parameters:
    ///   - clock: monotonic milliseconds (any epoch).
    ///   - seed: a fixed deal for tests; nil = system randomness.
    init(
        mode: PhonicsRoundMode, stages: PhonicsStages, store: (any Store)?, profileID: Profile.ID?, sync: SyncEngine?,
        clock: @escaping @MainActor () -> Double = ProvingGroundsModel.monotonicMs, seed: UInt64? = nil
    ) {
        self.mode = mode
        self.stages = stages
        self.store = store
        self.profileID = profileID
        self.sync = sync
        self.clock = clock
        rng = PhonicsRandom(seeded: seed.map(SeededRandom.init(seed:)))
        deal()
    }

    // MARK: - Reading

    var current: PhonicsItem? { items.indices.contains(index) ? items[index] : nil }
    var total: Int { items.count }
    var correctCount: Int { results.filter(\.correct).count }
    var lastResult: Result? { phase == .feedback ? results.last : nil }
    /// Identifies the prompt to play: changes for each new question.
    var promptID: String { "\(round):\(index)" }
    /// Out of five, as the web's end card.
    var stars: Int { total == 0 ? 0 : Int((Double(correctCount) / Double(total) * 5).rounded()) }

    // MARK: - Playing

    /// The prompt started (again): the response clock waits for it to end.
    func promptStarted() {
        if phase == .play { promptDoneAt = nil }
    }

    /// The prompt finished playing (or couldn't play).
    func promptFinished() {
        if phase == .play { promptDoneAt = clock() }
    }

    /// Sound Match: the kid tapped a tile.
    func tap(_ element: PhonicsElement) {
        guard let item = current else { return }
        answer(correct: element.key == item.element.key, chosen: element, typed: nil)
    }

    /// Sound Spell: the kid typed an answer. A blank answer is ignored.
    func submit(typed: String) {
        guard let item = current, !typed.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        answer(correct: Phonics.isAcceptedSpelling(item.element, typed: typed), chosen: nil, typed: typed)
    }

    /// Only one answer per question counts: a second tap while the feedback
    /// shows is dropped, never scored against the next sound.
    private func answer(correct: Bool, chosen: PhonicsElement?, typed: String?) {
        guard phase == .play, let item = current else { return }
        let responseMs = promptDoneAt.map { Int((clock() - $0).rounded()) }
        let attempt = Phonics.attempt(
            element: item.element, mode: mode.rawValue, correct: correct, chosenElement: chosen, typed: typed,
            responseMs: responseMs)
        results.append(Result(item: item, correct: correct, chosen: chosen, typed: typed, attempt: attempt))
        phase = .feedback
    }

    /// From the feedback to the next sound, or to the end card after the last.
    func next() {
        guard phase == .feedback else { return }
        if index + 1 >= items.count {
            phase = .done
            record()
        } else {
            index += 1
            promptDoneAt = nil
            phase = .play
        }
    }

    /// A fresh round on the same mode and stages.
    func playAgain() {
        deal()
    }

    private func deal() {
        items = Phonics.buildRound(mode: mode, stages: stages, rng: &rng)
        index = 0
        results = []
        promptDoneAt = nil
        round += 1
        phase = items.isEmpty ? .done : .play
    }

    // MARK: - Recording

    private func record() {
        guard recordedRound != round, !results.isEmpty, let store, let profileID else { return }
        recordedRound = round
        let events = results.map {
            PhonicsAttempted(
                elementKey: $0.attempt.elementKey, mode: $0.attempt.mode, correct: $0.attempt.correct,
                chosen: $0.attempt.chosen, responseMs: $0.attempt.responseMs)
        }
        let sync = sync
        lastWrite = Task {
            do {
                for event in events { try await store.record(event, for: profileID) }
                sync?.requestSync()
            } catch {
                // The round still shows; there's nothing a kid can do.
                Logger(subsystem: "dev.placeholder.dragonacademy", category: "Phonics")
                    .error("Couldn't record the phonics round: \(error)")
            }
        }
    }

    // MARK: - Showing

    /// The example word the feedback shows and says: Sound Hunt's own word,
    /// else the element's first.
    nonisolated static func example(for item: PhonicsItem) -> String {
        item.word ?? item.element.words.first ?? item.element.g
    }

    /// The word split around the element's letters, so the feedback can pick
    /// them out ("sh" in "ship"); nil when no spelling appears literally (a
    /// magic-e frame). The web's `highlight`.
    nonisolated static func highlight(_ word: String, element: PhonicsElement) -> (before: String, match: String, after: String)? {
        let lower = word.lowercased()
        for spelling in element.accepts {
            let s = spelling.lowercased()
            if s.contains("_") || s.contains("-") { continue }
            guard let range = lower.range(of: s) else { continue }
            let start = lower.distance(from: lower.startIndex, to: range.lowerBound)
            let length = s.count
            let chars = Array(word)
            guard start + length <= chars.count else { continue }
            return (String(chars[..<start]), String(chars[start..<(start + length)]), String(chars[(start + length)...]))
        }
        return nil
    }
}

/// A seeded source for tests, the system generator for play.
private struct PhonicsRandom: RandomSource {
    var seeded: SeededRandom?
    var system = SystemRandomSource()

    mutating func next() -> Double {
        if seeded != nil { return seeded!.next() }
        return system.next()
    }
}
