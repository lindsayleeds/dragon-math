import AVFoundation
import Audio

/// Says a whole word for Sound Hunt and Missing Sound — the web's `speakWord`:
/// the word's bundled spelling clip when there is one (`SpellingClips`),
/// otherwise the device voice, a touch slow. Unlike a single sound, a word is
/// safe to hand to a speech synthesiser.
///
/// `say` returns once the word has finished (or was cut off), so a prompt's
/// response clock starts after the kid has heard the whole word.
@MainActor
final class PhonicsWordVoice: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    /// The utterance playing and who's waiting for it. Matched by utterance so
    /// a late "cancelled" for a stopped word can't end the next one early
    /// (held strongly, so no later utterance can share its identity).
    private var waiting: (utterance: AVSpeechUtterance, continuation: CheckedContinuation<Void, Never>)?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// The clip if bundled, else the device voice.
    func say(_ word: String, audio: AudioPlayer?) async {
        if let url = SpellingClips.url(for: word), let audio {
            stop()
            try? await audio.speak(url)
        } else {
            await synthesize(word)
        }
    }

    /// Always the device voice (the feedback's example word, as before).
    func synthesize(_ word: String) async {
        stop()
        let utterance = AVSpeechUtterance(string: word)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.85
        // The web's safety net: a voice that never reports the end still
        // lets the round go on.
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            self?.resume(ObjectIdentifier(utterance))
        }
        await withCheckedContinuation { continuation in
            waiting = (utterance, continuation)
            synthesizer.speak(utterance)
        }
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        if let utterance = waiting?.utterance { resume(ObjectIdentifier(utterance)) }
    }

    private func resume(_ id: ObjectIdentifier) {
        guard let waiting, ObjectIdentifier(waiting.utterance) == id else { return }
        self.waiting = nil
        waiting.continuation.resume()
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.resume(id) }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.resume(id) }
    }
}
