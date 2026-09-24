import Foundation
import OSLog
import Store
import Sync

/// One child's stats in the parent view. They come from the server, so they
/// include play from every device, offline play too once it has synced; play
/// still queued on this device is called out rather than guessed at.
@MainActor
@Observable
final class ChildStatsModel {
    enum Notice: Equatable {
        case sessionExpired
        /// The server no longer has this child in the family.
        case notFound
        /// Couldn't reach the server (or it failed). Stats already shown stay.
        case unavailable
    }

    let child: Profile
    /// The last stats loaded; kept when a refresh fails.
    private(set) var stats: ChildStats?
    private(set) var isLoading = false
    private(set) var notice: Notice?
    /// This child has play on this device that hasn't uploaded yet, so the
    /// stats don't include it until the next sync.
    private(set) var hasUnsyncedPlay = false

    private let store: any Store
    private let service: any ChildStatsService
    private let uploadKinds: Set<EventKind>
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "ChildStats")

    init(
        child: Profile, store: any Store, service: any ChildStatsService,
        uploadKinds: Set<EventKind> = Set(SyncKinds.all.map(\.storeKind))
    ) {
        self.child = child
        self.store = store
        self.service = service
        self.uploadKinds = uploadKinds
    }

    func load() async {
        guard !isLoading else { return }
        guard let remoteID = child.remoteID else {
            notice = .notFound
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            stats = try await service.stats(childID: remoteID)
            notice = nil
        } catch {
            notice = Self.notice(for: error)
        }
        // After the fetch, so an upload that finished meanwhile isn't reported
        // as still waiting.
        do {
            hasUnsyncedPlay = try await !store.pendingEvents(for: child.id, kinds: uploadKinds, limit: 1).isEmpty
        } catch {
            log.error("Couldn't read the queue: \(error)")
        }
    }

    private static func notice(for error: ChildStatsError) -> Notice {
        switch error {
        case .sessionExpired: .sessionExpired
        case .notFound: .notFound
        case .unavailable: .unavailable
        }
    }
}
