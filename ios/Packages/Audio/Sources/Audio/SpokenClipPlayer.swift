import AVFoundation

/// Plays spoken clips (spelling words, phonics sounds), one at a time. Behind
/// a protocol so `AudioPlayer` is testable without audio hardware.
@MainActor
public protocol SpokenClipPlayer: AnyObject {
    /// Plays the clip at a local file URL and returns when it has finished,
    /// or been stopped: by `stop()`, by the next clip, or by cancelling the
    /// calling task.
    func play(_ url: URL) async throws
    func stop()
}

/// `AVAudioPlayer`, which is plenty for a word: clips are started on a tap, not
/// timed against anything, so they don't need the effects engine.
@MainActor
public final class AVSpokenClipPlayer: SpokenClipPlayer {
    private var current: (player: AVAudioPlayer, finished: FinishSignal)?

    public init() {}

    public func play(_ url: URL) async throws {
        stop()
        let player = try AVAudioPlayer(contentsOf: url)
        let finished = FinishSignal()
        player.delegate = finished
        current = (player, finished)
        guard player.play() else {
            current = nil
            throw AudioError.couldNotPlay(url)
        }
        await withTaskCancellationHandler {
            await finished.wait()
        } onCancel: {
            Task { @MainActor in finished.fire() }
        }
        if current?.finished === finished {
            player.stop()
            current = nil
        }
    }

    public func stop() {
        guard let current else { return }
        self.current = nil
        current.player.stop()
        // stop() doesn't call the delegate.
        current.finished.fire()
    }
}

/// The delegate, as a one-shot signal `play` waits on. AVAudioPlayer calls it
/// on the main actor.
@MainActor
private final class FinishSignal: NSObject, AVAudioPlayerDelegate {
    private var fired = false
    private var waiter: CheckedContinuation<Void, Never>?

    func wait() async {
        if fired { return }
        await withCheckedContinuation { waiter = $0 }
    }

    func fire() {
        fired = true
        let waiter = waiter
        self.waiter = nil
        waiter?.resume()
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        fire()
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: (any Error)?) {
        fire()
    }
}
