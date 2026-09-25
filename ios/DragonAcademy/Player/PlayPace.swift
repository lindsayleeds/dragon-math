import GameRules
import Store

extension Profile {
    /// The parent's game pace for this kid, as the rules take it (unknown
    /// stored values read as normal).
    var pace: GamePace { GamePace(normalizing: gamePace) }
}

/// The pace a battle or a Munchers game plays at (#167), read when the game
/// is set up.
enum PlayPace {
    /// `profile`'s pace as the Store has it now, since a parent may have
    /// changed it (or a sync brought it in) after the kid was picked; the
    /// profile's own value if the Store can't say, and normal with no profile.
    static func current(for profile: Profile?, in store: (any Store)?) async -> GamePace {
        guard let profile else { return .normal }
        guard let store, let stored = try? await store.profiles().first(where: { $0.id == profile.id }) else {
            return profile.pace
        }
        return stored.pace
    }
}
