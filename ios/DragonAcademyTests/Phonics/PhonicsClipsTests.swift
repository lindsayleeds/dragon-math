import AVFoundation
import Foundation
import GameRules
import Testing
@testable import DragonAcademy

/// project.yml bundles public/audio/phonics; every curriculum element must
/// find its clip there, so each sound plays offline.
struct PhonicsClipsTests {
    @Test func everyElementHasABundledClip() {
        let missing = PhonicsElement.all.map(\.key).filter { PhonicsClips.url(for: $0) == nil }
        #expect(missing.isEmpty, "no clip for \(missing)")
        #expect(PhonicsClips.url(for: "sh")?.deletingLastPathComponent().lastPathComponent == PhonicsClips.folder)
    }

    @Test func theClipsAreAudioThePlayerCanOpen() throws {
        // A sample from each stage: AVAudioPlayer (what `speak` uses) reads it.
        for stage in PhonicsStage.all {
            let key = try #require(stage.elements.first).key
            let player = try AVAudioPlayer(contentsOf: try #require(PhonicsClips.url(for: key)))
            #expect(player.duration > 0.1, "\(key)")
        }
    }
}
