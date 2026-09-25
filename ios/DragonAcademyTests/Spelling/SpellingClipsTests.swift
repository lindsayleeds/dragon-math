import AVFoundation
import Foundation
import GameRules
import Testing
@testable import DragonAcademy

/// project.yml bundles public/audio/spelling; every grade word must find its
/// clip there, so each one plays offline.
struct SpellingClipsTests {
    @Test func everyGradeWordHasABundledClip() {
        var missing: [String] = []
        for grade in SpellingGrade.all {
            for word in grade.words where SpellingClips.url(for: word) == nil {
                missing.append("grade \(grade.grade): \(word)")
            }
        }
        #expect(missing.isEmpty, "no clip for \(missing)")
    }

    @Test func aWordWithASentenceUsesItsPromptClip() throws {
        let word = try #require(Spelling.promptWords.first)
        let url = try #require(SpellingClips.url(for: word))
        #expect(url.deletingLastPathComponent().lastPathComponent == "prompts")
        let plain = try #require(SpellingClips.url(for: "cat"))
        #expect(plain.deletingLastPathComponent().lastPathComponent == SpellingClips.folder)
    }

    @Test func theClipsAreAudioThePlayerCanOpen() throws {
        // A sample from each grade: AVAudioPlayer (what `speak` uses) reads it.
        for grade in SpellingGrade.all {
            let url = try #require(SpellingClips.url(for: grade.words[0]))
            let player = try AVAudioPlayer(contentsOf: url)
            #expect(player.duration > 0.1, "\(grade.words[0])")
        }
    }
}
