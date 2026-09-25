import Audio
import GameRules

/// Which file each battle sound plays: the reducer's `BattleSound`s as in
/// useBattle.js's `SOUNDS`, and the end-of-match sounds BattlePage.jsx plays.
extension SoundEffect {
    init(_ sound: BattleSound) {
        switch sound {
        case .yip: self = .yip
        case .growl: self = .growl
        }
    }

    /// The sound for a match that just ended with `status`; nil while playing.
    init?(endOfMatch status: BattleStatus) {
        switch status {
        case .won: self = .victory
        case .lost: self = .defeat
        case .playing: return nil
        }
    }
}
