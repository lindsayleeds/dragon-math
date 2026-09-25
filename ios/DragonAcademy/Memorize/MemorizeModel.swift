import Foundation
import GameRules
import Observation
import OSLog
import Store
import Sync

/// The Memorize screen's state for one profile: which passages it has, how
/// far each is mastered, and recording a completed passage.
///
/// Progress is the Store's (derived from events, ADR 0003): completing a
/// passage records an event and asks Sync to upload it, and never waits on the
/// network. A server passage's mastery is the higher of what the server last
/// said and what this device has recorded for that same revision since, so a
/// completion shows at once and still counts while it waits to upload.
@MainActor @Observable
final class MemorizeModel {
    enum LoadState: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    let profile: Profile
    private let store: (any Store)?
    private let sync: SyncEngine?
    private let source: any MemorizePassageSource
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Memorize")

    private(set) var serverPassages: [MemorizePassage] = []
    private(set) var loadState: LoadState = .loading
    private(set) var progress = ProfileProgress()

    init(profile: Profile, store: (any Store)?, sync: SyncEngine?, source: any MemorizePassageSource) {
        self.profile = profile
        self.store = store
        self.sync = sync
        self.source = source
    }

    /// The bundled samples, offered to the guest and to a child whose book is
    /// empty or couldn't be opened.
    var samples: [MemorizePassage] {
        profile.kind == .guest || serverPassages.isEmpty ? MemorizePassage.samples : []
    }

    /// Whether this profile has a server passage book at all.
    var hasPassageBook: Bool { profile.kind == .child }

    func load() async {
        guard hasPassageBook else {
            loadState = .loaded
            return
        }
        loadState = .loading
        do {
            serverPassages = try await source.passages(for: profile)
            loadState = .loaded
        } catch {
            log.error("memorize: couldn't load passages: \(error)")
            loadState = .failed(
                (error as? LocalizedError)?.errorDescription
                    ?? String(localized: "We couldn't open your passage book. Check your connection, then try again."))
        }
    }

    /// Follows the Store's progress until the calling task is cancelled.
    func observeProgress() async {
        guard let store else { return }
        do {
            for try await progress in store.observeProgress(for: profile.id) {
                self.progress = progress
            }
        } catch {
            log.error("memorize: progress stopped: \(error)")
        }
    }

    /// 0 none, 1 easy, 2 medium, 3 hard.
    func mastery(of passage: MemorizePassage) -> Int {
        switch passage.source {
        case .server(let id, let revision):
            max(passage.serverMastery, progress.memorizeLevel(passageID: id, revision: revision))
        case .sample(let id):
            progress.memorizedSamples[id] ?? 0
        }
    }

    /// Records that the whole passage was completed at `difficulty`, then asks
    /// Sync to upload it (server passages only; samples stay on the device).
    func complete(_ passage: MemorizePassage, at difficulty: MemorizeDifficulty) async {
        guard let store else { return }
        do {
            switch passage.source {
            case .server(let id, let revision):
                try await store.record(
                    MemorizePassageCompleted(
                        passageID: id, difficulty: difficulty.rawValue, body: passage.body, revision: revision),
                    for: profile.id)
                sync?.requestSync()
            case .sample(let id):
                try await store.record(
                    MemorizeSampleCompleted(sampleID: id, difficulty: difficulty.rawValue), for: profile.id)
            }
        } catch {
            log.error("memorize: couldn't record a completion: \(error)")
        }
    }
}

extension MemorizeModel {
    /// What the passage list shows under a passage.
    static func masteryLabel(_ level: Int) -> String {
        switch level {
        case 1: String(localized: "Easy complete")
        case 2: String(localized: "Medium complete")
        case 3: String(localized: "Hard complete")
        default: String(localized: "Not completed")
        }
    }
}
