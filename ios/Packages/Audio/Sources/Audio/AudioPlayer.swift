// Sound effects and spoken clips for the kid screens (docs/IOS_PLAN.md
// "Audio"). `AudioPlayer` is the whole interface: `play(.correct)` for an
// effect, `await speak(url)` for a spoken clip, and `settings` for the kid
// Settings switch.
import Foundation
import OSLog

/// The app's one audio entry point.
///
/// **Silent switch.** Effects play under the `.ambient` session category, so
/// they go quiet with the silent switch; a spoken clip switches the session to
/// `.playback` for as long as it plays (so the word is heard with the switch
/// on) and back to `.ambient` after. An effect that lands while a clip is
/// playing is heard too, since the session is `.playback` at that moment.
///
/// **Latency.** Effects come from buffers decoded by `prepare()`, played on a
/// pool of engine voices (`AVAudioEngineEffects`); call `prepare()` at launch.
///
/// **Effects toggle.** `settings.effectsEnabled` off makes `play` do nothing.
/// It never silences `speak`.
@MainActor
public final class AudioPlayer {
    public let settings: SoundSettings

    private let effects: any EffectsEngine
    private let speaker: any SpokenClipPlayer
    private let session: any AudioSessionControlling
    private let effectFiles: () -> [SoundEffect: URL]
    /// Clips still inside `speak`; the session is `.spoken` while it's above 0.
    private var speaking = 0
    private var prepared = false

    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Audio")

    /// - Parameter effectFiles: where each effect's file is; read by `prepare()`.
    public init(
        effects: any EffectsEngine,
        speaker: any SpokenClipPlayer,
        session: any AudioSessionControlling,
        settings: SoundSettings,
        effectFiles: @escaping () -> [SoundEffect: URL]
    ) {
        self.effects = effects
        self.speaker = speaker
        self.session = session
        self.settings = settings
        self.effectFiles = effectFiles
    }

    /// The real thing: the engine pool, AVAudioPlayer for clips, the shared
    /// audio session, and the effect files bundled in `bundle`.
    public static func live(bundle: Bundle = .main, defaults: UserDefaults = .standard) -> AudioPlayer {
        #if os(iOS)
        let session: any AudioSessionControlling = SystemAudioSession()
        #else
        let session: any AudioSessionControlling = NoAudioSession()
        #endif
        return AudioPlayer(
            effects: AVAudioEngineEffects(),
            speaker: AVSpokenClipPlayer(),
            session: session,
            settings: SoundSettings(defaults: defaults),
            effectFiles: { bundledEffects(in: bundle) })
    }

    /// Every effect whose file `bundle` has.
    public nonisolated static func bundledEffects(in bundle: Bundle) -> [SoundEffect: URL] {
        var files: [SoundEffect: URL] = [:]
        for effect in SoundEffect.allCases {
            files[effect] = effect.url(in: bundle)
        }
        return files
    }

    /// Sets up the session for effects and decodes every effect, so the first
    /// `play` is as quick as the rest. Only the first call does anything.
    /// Problems are logged, not thrown: the app plays on without sound.
    public func prepare() {
        guard !prepared else { return }
        prepared = true
        do {
            try session.activate(.effects)
        } catch {
            log.error("Couldn't set up the audio session: \(error)")
        }
        let files = effectFiles()
        if files.count < SoundEffect.allCases.count {
            let missing = SoundEffect.allCases.filter { files[$0] == nil }.map(\.rawValue)
            log.fault("Sound effect files missing from the bundle: \(missing)")
        }
        do {
            try effects.load(files)
        } catch {
            log.error("Couldn't load the sound effects: \(error)")
        }
    }

    /// Plays an effect now, unless effects are turned off. Returns at once.
    public func play(_ effect: SoundEffect) {
        guard settings.effectsEnabled else { return }
        if !prepared { prepare() }
        effects.play(effect)
    }

    /// Plays a spoken clip (a local file) through the silent switch and
    /// returns when it ends or is stopped. A new clip stops the one playing.
    public func speak(_ url: URL) async throws {
        speaking += 1
        if speaking == 1 { activate(.spoken) }
        defer {
            speaking -= 1
            if speaking == 0 { activate(.effects) }
        }
        try await speaker.play(url)
    }

    /// Stops the clip playing, if any.
    public func stopSpeaking() {
        speaker.stop()
    }

    private func activate(_ mode: AudioSessionMode) {
        do {
            try session.activate(mode)
        } catch {
            log.error("Couldn't switch the audio session to \(String(describing: mode)): \(error)")
        }
    }
}
