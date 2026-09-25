import AVFoundation
import Foundation
import Testing
@testable import Audio

/// The rendered effects in the repo's ios/Sounds, read in place (the app
/// bundles the same files through project.yml).
enum SoundFiles {
    static let directory = URL(filePath: #filePath)
        .deletingLastPathComponent()  // AudioTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // Audio
        .deletingLastPathComponent()  // Packages
        .deletingLastPathComponent()  // ios
        .appending(path: "Sounds")

    static func bundleOfSounds() throws -> Bundle {
        try #require(Bundle(url: directory))
    }

    static var all: [SoundEffect: URL] {
        Dictionary(uniqueKeysWithValues: SoundEffect.allCases.map { ($0, directory.appending(path: $0.fileName)) })
    }
}

struct SoundFilesTests {
    struct Manifest: Decodable {
        struct Format: Decodable {
            var sampleRate: Double
            var channels: Int
        }

        struct Effect: Decodable {
            var file: String
        }

        var format: Format
        var effects: [String: Effect]
    }

    func manifest() throws -> Manifest {
        try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: SoundFiles.directory.appending(path: "manifest.json")))
    }

    @Test func everyRenderedEffectHasACaseAndEveryCaseAFile() throws {
        let manifest = try manifest()
        #expect(Set(manifest.effects.keys) == Set(SoundEffect.allCases.map(\.rawValue)))
        for effect in SoundEffect.allCases {
            #expect(manifest.effects[effect.rawValue]?.file == effect.fileName)
            #expect(FileManager.default.fileExists(atPath: SoundFiles.directory.appending(path: effect.fileName).path))
        }
    }

    @Test func everyFileDecodesToTheManifestFormat() throws {
        let format = try manifest().format
        for (effect, url) in SoundFiles.all {
            let buffer = try AVAudioEngineEffects.readBuffer(url, effect: effect)
            #expect(buffer.frameLength > 0, "\(effect)")
            #expect(buffer.format.sampleRate == format.sampleRate, "\(effect)")
            #expect(Int(buffer.format.channelCount) == format.channels, "\(effect)")
        }
    }
}

/// The real engine and voice pool, rendered offline instead of to a speaker.
@MainActor
struct AVAudioEngineEffectsTests {
    let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!

    func makeEngine() throws -> AVAudioEngineEffects {
        let effects = AVAudioEngineEffects(voiceCount: 2)
        try effects.renderOffline(format: format)
        try effects.load(SoundFiles.all)
        return effects
    }

    /// The peak level of the next `frames` frames.
    func renderPeak(_ effects: AVAudioEngineEffects, frames: AVAudioFrameCount = 4096) throws -> Float {
        let buffer = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames))
        let status = try effects.engine.renderOffline(frames, to: buffer)
        #expect(status == .success)
        let samples = UnsafeBufferPointer(start: buffer.floatChannelData![0], count: Int(buffer.frameLength))
        return samples.map(abs).max() ?? 0
    }

    @Test func loadsEveryEffect() throws {
        _ = try makeEngine()
    }

    @Test func silentUntilAnEffectPlays() throws {
        let effects = try makeEngine()
        try effects.engine.start()
        #expect(try renderPeak(effects) == 0)
        effects.play(.yip)
        #expect(try renderPeak(effects) > 0.01)
    }

    @Test func theFirstRenderAfterPlayHasSound() throws {
        // No start() here: play starts the engine itself, and the sound is in
        // the very next render (no decoding or scheduling delay).
        let effects = try makeEngine()
        effects.play(.correct)
        #expect(try renderPeak(effects, frames: 512) > 0.001)
    }

    @Test func moreEffectsThanVoicesStillPlay() throws {
        let effects = try makeEngine()
        for effect in [SoundEffect.yip, .growl, .victory, .defeat] {
            effects.play(effect)
        }
        #expect(try renderPeak(effects) > 0.01)
    }

    @Test func anEffectThatWasntLoadedIsSilent() throws {
        let effects = AVAudioEngineEffects(voiceCount: 2)
        try effects.renderOffline(format: format)
        try effects.load([.yip: SoundFiles.all[.yip]!])
        effects.play(.growl)
        try effects.engine.start()
        #expect(try renderPeak(effects) == 0)
    }
}

/// The real clip player, on a rendered effect standing in for a word.
@MainActor
struct AVSpokenClipPlayerTests {
    let clip = SoundFiles.directory.appending(path: SoundEffect.yip.fileName)

    @Test func returnsWhenTheClipEnds() async throws {
        try await AVSpokenClipPlayer().play(clip)
    }

    @Test func stopEndsTheClip() async throws {
        let player = AVSpokenClipPlayer()
        let long = SoundFiles.directory.appending(path: SoundEffect.caught.fileName)
        let playing = Task { try await player.play(long) }
        await Task.yield()
        let started = ContinuousClock.now
        player.stop()
        try await playing.value
        #expect(ContinuousClock.now - started < .seconds(1))
    }

    @Test func cancellingTheCallerEndsTheClip() async throws {
        let long = SoundFiles.directory.appending(path: SoundEffect.caught.fileName)
        let player = AVSpokenClipPlayer()
        let playing = Task { try await player.play(long) }
        await Task.yield()
        let started = ContinuousClock.now
        playing.cancel()
        try await playing.value
        #expect(ContinuousClock.now - started < .seconds(1))
    }

    @Test func aMissingFileThrows() async {
        await #expect(throws: (any Error).self) {
            try await AVSpokenClipPlayer().play(SoundFiles.directory.appending(path: "nope.m4a"))
        }
    }
}
