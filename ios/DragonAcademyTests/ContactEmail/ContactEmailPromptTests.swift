import Foundation
import Testing
@testable import DragonAcademy

// The parent flow asks where progress emails go right after Sign in with Apple,
// and not when a stored session lets the parent straight in.

@MainActor
private func flow(stored: ParentSession? = nil) -> ParentAccessModel {
    let contact = FakeContactEmailService()
    return ParentAccessModel(
        dependencies: ParentAccessDependencies(
            sessionStore: InMemoryParentSessionStore(stored),
            deviceAuthenticator: ScriptedDeviceAuthenticator(.success),
            appleCredentials: RecordingAppleProvider(),
            signIn: RecordingSignInService(),
            contactEmail: contact),
        rng: TestRNG(),
        makeNonce: { "raw-nonce" })
}

@MainActor
private func throughGateAndDevice(_ model: ParentAccessModel) async {
    model.gateAnswer = String(model.gate.challenge.answer)
    model.submitGateAnswer()
    await model.authenticateDevice()
}

@MainActor @Test func signingInWithAppleAsksForTheContactEmail() async {
    let model = flow()
    await throughGateAndDevice(model)
    #expect(!model.asksForContactEmail)
    await model.signInWithApple()
    #expect(model.step == .parentHome)
    #expect(model.asksForContactEmail)
    #expect(model.contactEmailService is FakeContactEmailService)
}

@MainActor @Test func aStoredSessionDoesNotAskAgain() async {
    let model = flow(stored: ParentSession(token: "kept"))
    await throughGateAndDevice(model)
    #expect(model.step == .parentHome)
    #expect(!model.asksForContactEmail)
}
