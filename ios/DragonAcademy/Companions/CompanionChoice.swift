import GameRules
import Store

/// Which companion a profile takes into battle, and changing it. The choice
/// is a `CompanionChosen` event in the Store, so it survives relaunch and
/// uploads with the rest of the queue (`companion_chosen`); the latest one
/// recorded wins.
enum CompanionChoice {
    /// The companion for a profile with this progress: its latest choice if
    /// it's still befriended, else Pip.
    static func current(in progress: ProfileProgress) -> Companion {
        let chosen = Companion.named(progress.companionID)
        return chosen.isBefriended(nodesWon: progress.nodesWon) ? chosen : .pip
    }

    /// The companion `profileID` takes into battle now; Pip without a store.
    static func current(in store: (any Store)?, for profileID: Profile.ID?) async throws -> Companion {
        guard let store, let profileID else { return .pip }
        return current(in: try await store.progress(for: profileID))
    }

    /// Records `companion` as the profile's choice and requests a sync.
    /// Nothing is recorded for a companion the kid hasn't befriended, or for
    /// the one they already have.
    ///
    /// - Returns: whether a choice was recorded.
    @discardableResult
    static func choose(
        _ companion: Companion, in store: any Store, for profileID: Profile.ID,
        requestSync: @MainActor () -> Void
    ) async throws -> Bool {
        let progress = try await store.progress(for: profileID)
        guard companion.isBefriended(nodesWon: progress.nodesWon), companion != current(in: progress) else {
            return false
        }
        try await store.record(CompanionChosen(companionID: companion.id), for: profileID)
        await requestSync()
        return true
    }
}
