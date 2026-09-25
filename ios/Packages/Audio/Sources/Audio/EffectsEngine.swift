import AVFoundation

/// Plays sound effects from buffers loaded ahead of time. Behind a protocol so
/// `AudioPlayer` is testable without audio hardware.
@MainActor
public protocol EffectsEngine: AnyObject {
    /// Decodes every file into memory, ready to play at once. Effects missing
    /// from `files` stay silent.
    func load(_ files: [SoundEffect: URL]) throws
    /// Starts the effect now, over whatever else is playing. Never blocks.
    func play(_ effect: SoundEffect)
}

public enum AudioError: Error, Equatable {
    /// The effect files don't share one format, so one voice pool can't play
    /// them all. ios/Sounds renders every file the same (manifest.json).
    case mixedFormats(SoundEffect)
    /// A buffer couldn't be made for a file.
    case unreadable(SoundEffect)
    /// AVAudioPlayer refused to start a clip.
    case couldNotPlay(URL)
}

/// Which voice plays next: round robin, so a new effect takes the voice that
/// started longest ago. With enough voices that one has long finished; if it
/// hasn't (a burst of taps) the oldest sound is the one cut off.
struct VoicePool: Equatable {
    let count: Int
    private var nextIndex = 0

    init(count: Int) {
        precondition(count > 0)
        self.count = count
    }

    mutating func next() -> Int {
        defer { nextIndex = (nextIndex + 1) % count }
        return nextIndex
    }
}

/// The low-latency player: one `AVAudioEngine`, a pool of
/// `AVAudioPlayerNode` voices into its main mixer, and every effect decoded
/// into an `AVAudioPCMBuffer` up front (through `AVAudioFile`, which trims the
/// AAC priming frames). Playing is scheduling a buffer that's already in memory
/// on an idle voice, so nothing touches the disk or a decoder on a tap.
///
/// The engine stops by itself when the session's configuration changes (a
/// category switch for a spoken clip, a route change) or it's interrupted;
/// `play` restarts it, so no notification handling is needed.
@MainActor
public final class AVAudioEngineEffects: EffectsEngine {
    /// Enough for every effect of a busy moment (a yip over a victory over a
    /// growl) without cutting one off.
    public static let defaultVoiceCount = 8

    let engine = AVAudioEngine()
    private let voices: [AVAudioPlayerNode]
    private var pool: VoicePool
    private var buffers: [SoundEffect: AVAudioPCMBuffer] = [:]
    private var connectedFormat: AVAudioFormat?

    public init(voiceCount: Int = AVAudioEngineEffects.defaultVoiceCount) {
        voices = (0..<voiceCount).map { _ in AVAudioPlayerNode() }
        pool = VoicePool(count: voiceCount)
        for voice in voices { engine.attach(voice) }
    }

    /// Renders into buffers on demand instead of to the speaker (manual
    /// rendering), for tests. Call before `load`.
    func renderOffline(format: AVAudioFormat) throws {
        try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
    }

    public func load(_ files: [SoundEffect: URL]) throws {
        var loaded: [SoundEffect: AVAudioPCMBuffer] = [:]
        var format: AVAudioFormat?
        // A fixed order, so a mixed-format error always names the same file.
        for effect in SoundEffect.allCases {
            guard let url = files[effect] else { continue }
            let buffer = try Self.readBuffer(url, effect: effect)
            if let format, buffer.format != format { throw AudioError.mixedFormats(effect) }
            format = buffer.format
            loaded[effect] = buffer
        }
        buffers = loaded
        guard let format else { return }
        if connectedFormat != format {
            let wasRunning = engine.isRunning
            engine.stop()
            for voice in voices {
                engine.connect(voice, to: engine.mainMixerNode, format: format)
            }
            connectedFormat = format
            if wasRunning { try engine.start() }
        }
        engine.prepare()
    }

    public func play(_ effect: SoundEffect) {
        guard let buffer = buffers[effect], ensureRunning() else { return }
        let voice = voices[pool.next()]
        // stop() drops whatever the voice still had queued, so a busy voice
        // is reused cleanly.
        voice.stop()
        voice.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        voice.play()
    }

    /// Starts the engine if something stopped it; false if it won't start
    /// (e.g. mid-interruption), in which case the effect is skipped.
    private func ensureRunning() -> Bool {
        if engine.isRunning { return true }
        do {
            try engine.start()
            return true
        } catch {
            return false
        }
    }

    /// The whole file, decoded to the engine's PCM format.
    nonisolated static func readBuffer(_ url: URL, effect: SoundEffect) throws -> AVAudioPCMBuffer {
        let file = try AVAudioFile(forReading: url)
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))
        else { throw AudioError.unreadable(effect) }
        try file.read(into: buffer)
        return buffer
    }
}
