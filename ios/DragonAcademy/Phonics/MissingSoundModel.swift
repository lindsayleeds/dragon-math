import Foundation
import GameRules
import OSLog
import Store
import Sync

/// Drives one round of Missing Sound — hear a word, tap the piece that fills
/// its blank — the SwiftUI side of src/components/DragonPhonics.jsx. The words
/// and each word's tiles come from GameRules' `PhonicsWords`, dealt together
/// in the golden draw order (the picks, then each word's tiles in turn).
///
/// A finished round records one `PhonicsAttempted` (mode `missing-sound`) per
/// word whose blank is a curriculum element, so this game feeds the same
/// mastery as the other three; a round left early records nothing, as on the
/// web. The level's best score is remembered per profile on this device, as
/// the web keeps it per browser.
@MainActor @Observable
final class MissingSoundModel {
    typealias Phase = PhonicsModel.Phase

    /// One word of the round.
    struct Item: Equatable {
        let entry: PhonicsWordEntry
        /// The tiles, answer included.
        let options: [String]
    }

    /// One answer.
    struct Result: Equatable {
        let item: Item
        /// The tile tapped.
        let chosen: String
        let correct: Bool
        /// What it records; nil when the blank is no curriculum element.
        let attempt: PhonicsAttemptRecord?
    }

    let level: PhonicsLevel
    private(set) var items: [Item] = []
    private(set) var index = 0
    private(set) var phase = Phase.play
    private(set) var results: [Result] = []
    /// Bumped for every deal, so word 1 of a new round is spoken.
    private(set) var round = 0
    /// The level's best score, and whether this round just beat it; set when
    /// a round ends.
    private(set) var best: Int?
    private(set) var isNewBest = false
    /// The Store writes of the finished round, for tests to await.
    private(set) var lastWrite: Task<Void, Never>?

    private let store: (any Store)?
    private let profileID: Profile.ID?
    private let sync: SyncEngine?
    private let bests: UserDefaults?
    private var rng: MissingSoundRandom
    private var recordedRound: Int?

    /// - Parameters:
    ///   - bests: where the level's best score is kept; nil keeps none.
    ///   - seed: a fixed deal for tests; nil = system randomness.
    init(
        level: PhonicsLevel, store: (any Store)?, profileID: Profile.ID?, sync: SyncEngine?,
        bests: UserDefaults? = .standard, seed: UInt64? = nil
    ) {
        self.level = level
        self.store = store
        self.profileID = profileID
        self.sync = sync
        self.bests = bests
        rng = MissingSoundRandom(seeded: seed.map(SeededRandom.init(seed:)))
        deal()
    }

    // MARK: - Reading

    var current: Item? { items.indices.contains(index) ? items[index] : nil }
    var total: Int { items.count }
    var correctCount: Int { results.filter(\.correct).count }
    var lastResult: Result? { phase == .feedback ? results.last : nil }
    /// Identifies the word to speak: changes for each new word.
    var promptID: String { "\(round):\(index)" }
    /// Out of five, as the web's end card.
    var stars: Int { total == 0 ? 0 : Int((Double(correctCount) / Double(total) * 5).rounded()) }

    // MARK: - Playing

    /// The kid tapped a tile. Only the first tap per word counts.
    func tap(_ option: String) {
        guard phase == .play, let item = current else { return }
        results.append(Result(
            item: item, chosen: option, correct: option == item.entry.answer,
            attempt: PhonicsWords.attempt(for: item.entry, option: option)))
        phase = .feedback
    }

    /// From the feedback to the next word, or to the end card after the last.
    func next() {
        guard phase == .feedback else { return }
        if index + 1 >= items.count {
            phase = .done
            finish()
        } else {
            index += 1
            phase = .play
        }
    }

    /// A fresh round on the same level.
    func playAgain() {
        deal()
    }

    private func deal() {
        let words = PhonicsWords.pickWords(level: level.key, rng: &rng)
        items = words.map { Item(entry: $0, options: PhonicsWords.buildOptions($0, count: level.options, rng: &rng)) }
        index = 0
        results = []
        best = nil
        isNewBest = false
        round += 1
        phase = items.isEmpty ? .done : .play
    }

    // MARK: - Finishing

    private func finish() {
        guard recordedRound != round else { return }
        recordedRound = round
        updateBest()
        record()
    }

    /// The web's per-level high score: a first round sets it without calling
    /// it "new".
    private func updateBest() {
        let key = Self.bestKey(level: level.key, profileID: profileID)
        let prior = bests?.object(forKey: key) as? Int
        if let prior, correctCount <= prior {
            best = prior
            isNewBest = false
        } else {
            bests?.set(correctCount, forKey: key)
            best = correctCount
            isNewBest = prior != nil
        }
    }

    nonisolated static func bestKey(level: String, profileID: Profile.ID?) -> String {
        "phonics.best.\(profileID.map { "\($0)" } ?? "none").\(level)"
    }

    private func record() {
        let events = results.compactMap(\.attempt).map {
            PhonicsAttempted(
                elementKey: $0.elementKey, mode: $0.mode, correct: $0.correct, chosen: $0.chosen,
                responseMs: $0.responseMs)
        }
        guard !events.isEmpty, let store, let profileID else { return }
        let sync = sync
        lastWrite = Task {
            do {
                for event in events { try await store.record(event, for: profileID) }
                sync?.requestSync()
            } catch {
                // The round still shows; there's nothing a kid can do.
                Logger(subsystem: "dev.placeholder.dragonacademy", category: "Phonics")
                    .error("Couldn't record the Missing Sound round: \(error)")
            }
        }
    }
}

/// A seeded source for tests, the system generator for play.
private struct MissingSoundRandom: RandomSource {
    var seeded: SeededRandom?
    var system = SystemRandomSource()

    mutating func next() -> Double {
        if seeded != nil { return seeded!.next() }
        return system.next()
    }
}
