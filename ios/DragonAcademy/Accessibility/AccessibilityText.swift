import GameRules
import SwiftUI

// What VoiceOver reads for the main screens' composite controls (#168): pure
// builders, so the words are tested rather than only heard. Each returns the
// localized string; the views hand it to `.accessibilityLabel` and friends.

/// A map node: its label is the node's name, then these.
enum MapNodeAccessibility {
    /// Locked, not won yet, or won. The UI tests read this value.
    static func value(_ state: MapNodeState) -> String {
        switch state {
        case .locked: String(localized: "locked", comment: "Accessibility value of a map node that can't be played yet.")
        case .available: String(localized: "not won yet", comment: "Accessibility value of a map node that hasn't been won.")
        case .won: String(localized: "won", comment: "Accessibility value of a map node that has been won.")
        }
    }

    /// What tapping does, and "your next quest" on the node marked "you →".
    /// Beside the iPad detail panel (`tapSelects`, #135) a tap only selects.
    static func hint(_ state: MapNodeState, isBoss: Bool, isCurrent: Bool, tapSelects: Bool = false) -> String {
        if tapSelects {
            return String(
                localized: "Shows it in the panel.",
                comment: "Accessibility hint of a map node beside the detail panel, where a tap selects it.")
        }
        if state == .locked {
            return String(
                localized: "Win the nodes before it to unlock it.",
                comment: "Accessibility hint of a locked map node.")
        }
        let action = isBoss
            ? String(localized: "Starts a boss battle.", comment: "Accessibility hint of a playable boss node.")
            : String(localized: "Starts a battle.", comment: "Accessibility hint of a playable map node.")
        guard isCurrent else { return action }
        return String(
            localized: "Your next quest. \(action)",
            comment: "Accessibility hint of the map node to play next; the argument says what tapping it starts.")
    }
}

/// The map header's "3 / 41 quests", which VoiceOver would read as "3 slash
/// 41".
enum QuestCountAccessibility {
    static func label(won: Int, total: Int) -> String {
        String(
            localized: "\(won) of \(total) quests won",
            comment: "Accessibility label of the map's quest count: nodes won, nodes on the map.")
    }
}

/// One side of the battle scoreboard.
enum ScoreAccessibility {
    static func label(name: String, score: Int, target: Int, paused: Bool) -> String {
        paused
            ? String(
                localized: "\(name): \(score) of \(target), paused",
                comment: "Accessibility label of a battle score card while the opponent is held: name, score, target.")
            : String(
                localized: "\(name): \(score) of \(target)",
                comment: "Accessibility label of a battle score card: name, score, target.")
    }
}

/// A `StarRating`, for callers that don't say something more specific.
enum StarRatingAccessibility {
    static func label(filled: Int, total: Int) -> String {
        String(
            localized: "\(filled) of \(total) stars",
            comment: "Accessibility label of a row of stars: stars filled, stars in the row.")
    }
}
