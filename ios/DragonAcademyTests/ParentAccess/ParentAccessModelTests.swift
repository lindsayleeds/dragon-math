import Foundation
import Testing
@testable import DragonAcademy

@MainActor
private struct Harness {
    let sessions: InMemoryParentSessionStore
    let device: ScriptedDeviceAuthenticator
    let apple = RecordingAppleProvider()
    let server = RecordingSignInService()
    let changes = SessionChanges()
    let model: ParentAccessModel

    init(stored: ParentSession? = nil, device: ScriptedDeviceAuthenticator = .init(.success),
         now: Date = Date(timeIntervalSince1970: 1_800_000_000)) {
        sessions = InMemoryParentSessionStore(stored)
        self.device = device
        model = ParentAccessModel(
            dependencies: ParentAccessDependencies(
                sessionStore: sessions, deviceAuthenticator: device,
                appleCredentials: apple, signIn: server,
                sessionChanged: { [changes] in await changes.record($0) }),
            rng: TestRNG(),
            now: { now },
            makeNonce: { "raw-nonce-1" }
        )
    }

    func passGate() {
        model.gateAnswer = String(model.gate.challenge.answer)
        model.submitGateAnswer()
    }
}

@MainActor @Test func firstVisitWalksGateThenDeviceThenApple() async throws {
    let h = Harness()
    #expect(h.model.step == .gate)

    h.passGate()
    #expect(h.model.step == .deviceAuth)
    await h.model.authenticateDevice()
    #expect(h.model.step == .signIn)
    await h.model.signInWithApple()

    #expect(h.model.step == .parentHome)
    #expect(h.apple.hashedNonces == [Nonce.sha256Hex("raw-nonce-1")])
    #expect(h.server.calls.map(\.identityToken) == ["apple-token"])
    #expect(h.server.calls.map(\.rawNonce) == ["raw-nonce-1"])
    #expect(try h.sessions.load() == ParentSession(token: "server.jwt.token"))
    #expect(await h.changes.all == [ParentSession(token: "server.jwt.token")])
}

@MainActor @Test func aStoredSessionSkipsSignInButNotTheGateOrDevice() async {
    let h = Harness(stored: ParentSession(token: "kept"))
    #expect(h.model.step == .gate)
    await h.model.authenticateDevice()   // not reachable before the gate
    #expect(h.device.prompts == 0)

    h.passGate()
    await h.model.authenticateDevice()

    #expect(h.device.prompts == 1)
    #expect(h.model.step == .parentHome)
    #expect(h.server.calls.isEmpty)
    #expect(await h.changes.all.isEmpty)
}

@MainActor @Test func anExpiredSessionIsDroppedAndAsksForSignIn() async throws {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let h = Harness(stored: ParentSession(token: fakeJWT(exp: now.addingTimeInterval(-60))), now: now)
    h.passGate()
    await h.model.authenticateDevice()
    #expect(h.model.step == .signIn)
    #expect(try h.sessions.load() == nil)
    #expect(await h.changes.all == [nil])
}

@MainActor @Test func cancellingDeviceAuthKeepsTheParentViewShut() async {
    let h = Harness(stored: ParentSession(token: "kept"), device: .init(.cancelled, .failed, .success))
    h.passGate()

    await h.model.authenticateDevice()
    #expect(h.model.step == .deviceAuth)
    #expect(h.model.notice == .device(.cancelled))
    await h.model.authenticateDevice()
    #expect(h.model.step == .deviceAuth)
    #expect(h.model.notice == .device(.failed))

    await h.model.authenticateDevice()
    #expect(h.model.step == .parentHome)
    #expect(h.model.notice == nil)
}

@MainActor @Test func noPasscodeMeansNoWayIn() async {
    let h = Harness(stored: ParentSession(token: "kept"), device: .init(.unavailable))
    h.passGate()
    await h.model.authenticateDevice()
    await h.model.authenticateDevice()
    #expect(h.model.step == .deviceAuth)
    #expect(h.model.notice == .device(.unavailable))
}

@MainActor @Test func threeWrongGateAnswersCloseTheFlow() {
    let h = Harness()
    for _ in 0..<2 {
        h.model.gateAnswer = String(h.model.gate.challenge.answer + 1)
        h.model.submitGateAnswer()
        #expect(h.model.step == .gate)
        #expect(h.model.notice == .gateWrong)
        #expect(h.model.gateAnswer.isEmpty)
    }
    h.model.gateAnswer = "0"
    h.model.submitGateAnswer()
    #expect(h.model.step == .closed)
    #expect(h.device.prompts == 0)
}

@MainActor @Test func cancellingAppleIsQuietAndFailuresAreShown() async throws {
    let h = Harness()
    h.passGate()
    await h.model.authenticateDevice()

    h.apple.result = .failure(.cancelled)
    await h.model.signInWithApple()
    #expect(h.model.step == .signIn)
    #expect(h.model.notice == nil)
    #expect(h.server.calls.isEmpty)

    h.apple.result = .failure(.failed)
    await h.model.signInWithApple()
    #expect(h.model.notice == .appleFailed)

    h.apple.result = .success(AppleCredential(identityToken: "apple-token"))
    h.server.result = .failure(.rejected)
    await h.model.signInWithApple()
    #expect(h.model.step == .signIn)
    #expect(h.model.notice == .signIn(.rejected))
    #expect(try h.sessions.load() == nil)
}

@MainActor @Test func signingOutClearsTheStoredSession() async throws {
    let h = Harness(stored: ParentSession(token: "kept"))
    h.passGate()
    await h.model.authenticateDevice()

    await h.model.signOut()

    #expect(h.model.step == .signIn)
    #expect(try h.sessions.load() == nil)
    #expect(await h.changes.all == [nil])
}

/// "Stays signed in across launches": a new model (a later launch) over the same
/// store goes straight from device auth to the parent view.
@MainActor @Test func aSessionSavedOnOneVisitIsUsedOnTheNext() async throws {
    let first = Harness()
    first.passGate()
    await first.model.authenticateDevice()
    await first.model.signInWithApple()

    let later = ParentAccessModel(
        dependencies: .fake(sessionStore: first.sessions), rng: TestRNG(seed: 9))
    later.gateAnswer = String(later.gate.challenge.answer)
    later.submitGateAnswer()
    await later.authenticateDevice()
    #expect(later.step == .parentHome)
}

actor SessionChanges {
    private(set) var all: [ParentSession?] = []
    func record(_ session: ParentSession?) { all.append(session) }
}

/// The app's shared token follows sign-in and sign-out.
@MainActor @Test func sessionTokensFollowSignInAndOut() async {
    let tokens = SessionTokens()
    let sessions = InMemoryParentSessionStore()
    var deps = ParentAccessDependencies.fake(sessionStore: sessions)
    deps.sessionChanged = { await tokens.set($0?.token) }
    let model = ParentAccessModel(dependencies: deps, rng: TestRNG())
    model.gateAnswer = String(model.gate.challenge.answer)
    model.submitGateAnswer()
    await model.authenticateDevice()
    await model.signInWithApple()
    #expect(await tokens.current() == "fake.parent.session")
    await model.signOut()
    #expect(await tokens.current() == nil)
}
