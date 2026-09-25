import Foundation
import Observation

/// The kid Settings "Sound effects" switch, kept in UserDefaults for the
/// device. On until someone turns it off. It silences effects only: spoken
/// clips are the lesson, so they always play.
@Observable @MainActor
public final class SoundSettings {
    /// The UserDefaults key. Never rename it: a renamed key turns sound back on
    /// for everyone who turned it off.
    public static let effectsEnabledKey = "audio.effectsEnabled"

    @ObservationIgnored private let defaults: UserDefaults

    public var effectsEnabled: Bool {
        didSet { defaults.set(effectsEnabled, forKey: Self.effectsEnabledKey) }
    }

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        effectsEnabled = defaults.object(forKey: Self.effectsEnabledKey) as? Bool ?? true
    }
}
