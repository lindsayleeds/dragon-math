import AVFoundation

/// What the app is playing, which decides the audio session category.
public enum AudioSessionMode: Sendable, Equatable {
    /// Sound effects only: `.ambient`, so they go quiet with the silent
    /// switch (and the Ring/Silent setting) and mix with other apps' audio.
    case effects
    /// A spoken clip (a spelling word, a phonics sound): `.playback` in the
    /// `.spokenAudio` mode, so it plays with the silent switch on. A kid can't
    /// hear the word they're asked to spell otherwise. It mixes with other
    /// apps rather than stopping their audio.
    case spoken
}

/// The app's audio session, behind a protocol so `AudioPlayer`'s switching is
/// testable without one.
@MainActor
public protocol AudioSessionControlling: AnyObject {
    /// Sets the category for `mode` and activates the session.
    func activate(_ mode: AudioSessionMode) throws
}

#if os(iOS)
/// `AVAudioSession.sharedInstance()`.
@MainActor
public final class SystemAudioSession: AudioSessionControlling {
    private var configuredBuffer = false

    public init() {}

    public func activate(_ mode: AudioSessionMode) throws {
        let session = AVAudioSession.sharedInstance()
        switch mode {
        case .effects:
            try session.setCategory(.ambient, mode: .default, options: [])
        case .spoken:
            try session.setCategory(.playback, mode: .spokenAudio, options: [.mixWithOthers])
        }
        if !configuredBuffer {
            // A short IO buffer, so an effect starts within a few ms of the tap.
            try? session.setPreferredIOBufferDuration(0.005)
            configuredBuffer = true
        }
        try session.setActive(true)
    }
}
#endif

/// No session to manage: macOS (where `swift test` runs) and previews.
@MainActor
public final class NoAudioSession: AudioSessionControlling {
    public init() {}
    public func activate(_ mode: AudioSessionMode) throws {}
}
