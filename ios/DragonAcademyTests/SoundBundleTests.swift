import Audio
import Foundation
import Testing

/// project.yml bundles ios/Sounds; `AudioPlayer.live()` looks each effect up
/// by name in the app bundle.
struct SoundBundleTests {
    @Test func theAppBundlesEverySoundEffect() {
        let found = AudioPlayer.bundledEffects(in: .main)
        #expect(Set(found.keys) == Set(SoundEffect.allCases))
    }
}
