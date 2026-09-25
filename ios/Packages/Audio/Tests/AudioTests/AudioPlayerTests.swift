import Foundation
import Testing
@testable import Audio

@MainActor
final class FakeEffects: EffectsEngine {
    var loaded: [[SoundEffect: URL]] = []
    var played: [SoundEffect] = []
    var loadError: (any Error)?

    func load(_ files: [SoundEffect: URL]) throws {
        loaded.append(files)
        if let loadError { throw loadError }
    }

    func play(_ effect: SoundEffect) {
        played.append(effect)
    }
}

/// Clips play until the test finishes them (or they're stopped).
@MainActor
final class FakeSpeaker: SpokenClipPlayer {
    var started: [URL] = []
    private var playing: CheckedContinuation<Void, Never>?

    var isPlaying: Bool { playing != nil }

    func play(_ url: URL) async throws {
        stop()
        started.append(url)
        await withCheckedContinuation { playing = $0 }
    }

    func stop() {
        finish()
    }

    func finish() {
        let continuation = playing
        playing = nil
        continuation?.resume()
    }
}

@MainActor
final class FakeSession: AudioSessionControlling {
    var modes: [AudioSessionMode] = []
    func activate(_ mode: AudioSessionMode) throws { modes.append(mode) }
}

@MainActor
struct AudioPlayerTests {
    let effects = FakeEffects()
    let speaker = FakeSpeaker()
    let session = FakeSession()
    let defaults = UserDefaults(suiteName: "AudioPlayerTests.\(UUID())")!
    let files: [SoundEffect: URL] = Dictionary(uniqueKeysWithValues: SoundEffect.allCases.map {
        ($0, URL(filePath: "/sounds/\($0.fileName)"))
    })
    let clip = URL(filePath: "/clips/cat.mp3")

    func makePlayer() -> AudioPlayer {
        let files = files
        return AudioPlayer(
            effects: effects, speaker: speaker, session: session,
            settings: SoundSettings(defaults: defaults), effectFiles: { files })
    }

    /// Lets a started `speak` task reach the speaker.
    func waitUntilSpeaking() async {
        while !speaker.isPlaying { await Task.yield() }
    }

    @Test func prepareSetsUpTheEffectsSessionAndLoadsEveryEffectOnce() {
        let audio = makePlayer()
        audio.prepare()
        audio.prepare()
        #expect(session.modes == [.effects])
        #expect(effects.loaded == [files])
    }

    @Test func playsAnEffect() {
        let audio = makePlayer()
        audio.prepare()
        audio.play(.correct)
        audio.play(.yip)
        #expect(effects.played == [.correct, .yip])
    }

    @Test func thefirstEffectPreparesIfTheAppHasnt() {
        let audio = makePlayer()
        audio.play(.growl)
        #expect(session.modes == [.effects])
        #expect(effects.loaded.count == 1)
        #expect(effects.played == [.growl])
    }

    @Test func aLoadFailureLeavesTheAppPlayable() {
        effects.loadError = AudioError.unreadable(.win)
        let audio = makePlayer()
        audio.prepare()
        audio.play(.win)
        #expect(effects.played == [.win])
    }

    @Test func effectsOffSilencesEffects() {
        let audio = makePlayer()
        audio.prepare()
        audio.settings.effectsEnabled = false
        audio.play(.correct)
        #expect(effects.played.isEmpty)
        audio.settings.effectsEnabled = true
        audio.play(.wrong)
        #expect(effects.played == [.wrong])
    }

    @Test func aClipPlaysThroughTheSilentSwitchThenEffectsFollowItAgain() async throws {
        let audio = makePlayer()
        audio.prepare()
        let speaking = Task { try await audio.speak(clip) }
        await waitUntilSpeaking()
        #expect(session.modes == [.effects, .spoken])
        speaker.finish()
        try await speaking.value
        #expect(session.modes == [.effects, .spoken, .effects])
        #expect(speaker.started == [clip])
    }

    @Test func effectsOffNeverSilencesAClip() async throws {
        let audio = makePlayer()
        audio.settings.effectsEnabled = false
        let speaking = Task { try await audio.speak(clip) }
        await waitUntilSpeaking()
        #expect(speaker.started == [clip])
        speaker.finish()
        try await speaking.value
    }

    @Test func aNewClipStopsTheLastWithoutDroppingBackToEffectsInBetween() async throws {
        let audio = makePlayer()
        let other = URL(filePath: "/clips/dog.mp3")
        let first = Task { try await audio.speak(clip) }
        await waitUntilSpeaking()
        let second = Task { try await audio.speak(other) }
        // The second clip stops the first as it starts.
        try await first.value
        await waitUntilSpeaking()
        #expect(session.modes == [.spoken])
        speaker.finish()
        try await second.value
        #expect(session.modes == [.spoken, .effects])
        #expect(speaker.started == [clip, other])
    }

    @Test func stopSpeakingEndsTheClip() async throws {
        let audio = makePlayer()
        let speaking = Task { try await audio.speak(clip) }
        await waitUntilSpeaking()
        audio.stopSpeaking()
        try await speaking.value
        #expect(session.modes == [.spoken, .effects])
    }

    @Test func bundledEffectsFindsEachFileByName() throws {
        let bundle = try SoundFiles.bundleOfSounds()
        let found = AudioPlayer.bundledEffects(in: bundle)
        #expect(Set(found.keys) == Set(SoundEffect.allCases))
        for (effect, url) in found {
            #expect(url.lastPathComponent == effect.fileName)
        }
    }
}

@MainActor
struct SoundSettingsTests {
    let defaults = UserDefaults(suiteName: "SoundSettingsTests.\(UUID())")!

    @Test func effectsStartOn() {
        #expect(SoundSettings(defaults: defaults).effectsEnabled)
    }

    @Test func theSwitchSurvivesARelaunch() {
        let settings = SoundSettings(defaults: defaults)
        settings.effectsEnabled = false
        #expect(defaults.object(forKey: "audio.effectsEnabled") as? Bool == false)
        #expect(SoundSettings(defaults: defaults).effectsEnabled == false)
        settings.effectsEnabled = true
        #expect(SoundSettings(defaults: defaults).effectsEnabled)
    }
}

struct VoicePoolTests {
    @Test func takesTheVoiceThatStartedLongestAgo() {
        var pool = VoicePool(count: 3)
        #expect((0..<7).map { _ in pool.next() } == [0, 1, 2, 0, 1, 2, 0])
    }
}
