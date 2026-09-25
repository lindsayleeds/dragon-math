import Foundation

/// Every sound effect the kid screens play, one file each in ios/Sounds (see
/// its README and manifest.json, which a test keeps in step with this list).
/// None takes parameters, so an effect is just its name.
public enum SoundEffect: String, CaseIterable, Sendable {
    /// A right answer (phonics, spelling, munchers, stepping stones, memorize).
    case correct
    /// A wrong answer (the same games).
    case wrong
    /// Stepping Stones: fell in the river.
    case splash
    /// Stepping Stones: crossed the river.
    case win
    /// Dragon Munchers: a monster caught you.
    case caught
    /// Battle / Dragon Trial: the child solved it.
    case yip
    /// Battle: the opponent solved it.
    case growl
    /// Battle won / Dragon Trial passed.
    case victory
    /// Battle lost.
    case defeat

    /// The file's name in ios/Sounds and in the app bundle.
    public var fileName: String { "\(rawValue).m4a" }

    /// The bundled file, or nil if the bundle doesn't have it.
    public func url(in bundle: Bundle) -> URL? {
        bundle.url(forResource: rawValue, withExtension: "m4a")
    }
}
