#if os(iOS)
import AVFoundation
import Testing
@testable import Audio

/// The silent-switch rule, on the real session (runs in the app's test plan on
/// the simulator; `swift test` on the Mac has no AVAudioSession).
@MainActor
struct SystemAudioSessionTests {
    @Test func effectsFollowTheSilentSwitch() throws {
        try SystemAudioSession().activate(.effects)
        #expect(AVAudioSession.sharedInstance().category == .ambient)
    }

    @Test func spokenClipsPlayThroughIt() throws {
        let session = SystemAudioSession()
        try session.activate(.spoken)
        #expect(AVAudioSession.sharedInstance().category == .playback)
        #expect(AVAudioSession.sharedInstance().mode == .spokenAudio)
        #expect(AVAudioSession.sharedInstance().categoryOptions.contains(.mixWithOthers))
        try session.activate(.effects)
        #expect(AVAudioSession.sharedInstance().category == .ambient)
    }
}
#endif
