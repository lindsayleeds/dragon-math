import API
import Foundation
import OSLog

/// Everything the parent-access flow talks to, swappable for fakes.
struct ParentAccessDependencies: Sendable {
    var sessionStore: any ParentSessionStore
    var deviceAuthenticator: any DeviceAuthenticator
    var appleCredentials: any AppleCredentialProvider
    var signIn: any ParentSignInService
    /// Told after a session is saved, cleared or found expired, so the app's
    /// shared `SessionTokens` (API client and Sync) follow the Keychain.
    var sessionChanged: @Sendable (ParentSession?) async -> Void = { _ in }

    @MainActor
    static func live(
        api: any APIProtocol,
        sessionStore: any ParentSessionStore,
        sessionChanged: @escaping @Sendable (ParentSession?) async -> Void
    ) -> Self {
        Self(
            sessionStore: sessionStore,
            deviceAuthenticator: LocalDeviceAuthenticator(),
            appleCredentials: SystemAppleCredentialProvider(),
            signIn: APIParentSignInService(api: api),
            sessionChanged: sessionChanged
        )
    }

    /// Every step succeeds without the system or the server. Previews use it,
    /// and so does the app when launched with `-ParentAccessFakes YES`.
    static func fake(sessionStore: any ParentSessionStore = InMemoryParentSessionStore()) -> Self {
        Self(
            sessionStore: sessionStore,
            deviceAuthenticator: FakeDeviceAuthenticator(),
            appleCredentials: FakeAppleCredentialProvider(),
            signIn: FakeParentSignInService()
        )
    }
}

/// The way from the kid's home screen to the parent view: parental gate, then
/// Face ID/Touch ID/passcode, then — only if no session is stored — Sign in
/// with Apple. The gate and device check run on every entry, signed in or not,
/// so a child holding a signed-in device still can't get through (ADR 0007).
/// One model per presentation; closing the flow throws it away.
@MainActor
@Observable
final class ParentAccessModel {
    enum Step: Equatable {
        case gate
        case deviceAuth
        case signIn
        case parentHome
        /// The flow is over without reaching the parent view; the view dismisses.
        case closed
    }

    enum Notice: Equatable {
        case gateWrong
        case device(DeviceAuthResult)
        case appleFailed
        case signIn(ParentSignInError)
    }

    private(set) var step: Step = .gate
    private(set) var gate: ParentalGate
    private(set) var notice: Notice?
    private(set) var isWorking = false
    var gateAnswer = ""

    private let dependencies: ParentAccessDependencies
    private var rng: AnyRandomNumberGenerator
    private let now: () -> Date
    private let makeNonce: () -> String
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "ParentAccess")

    init(
        dependencies: ParentAccessDependencies,
        rng: some RandomNumberGenerator = SystemRandomNumberGenerator(),
        now: @escaping () -> Date = { .now },
        makeNonce: @escaping () -> String = { Nonce.random() }
    ) {
        self.dependencies = dependencies
        var rng = AnyRandomNumberGenerator(rng)
        gate = ParentalGate(using: &rng)
        self.rng = rng
        self.now = now
        self.makeNonce = makeNonce
    }

    func submitGateAnswer() {
        guard step == .gate else { return }
        let outcome = gate.submit(gateAnswer, using: &rng)
        switch outcome {
        case .empty:
            return
        case .passed:
            notice = nil
            step = .deviceAuth
        case .wrong:
            notice = .gateWrong
        case .lockedOut:
            notice = nil
            step = .closed
        }
        gateAnswer = ""
    }

    func authenticateDevice() async {
        guard step == .deviceAuth, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        let reason = String(localized: "Confirm you're a grown-up to open the parent area.",
                            comment: "Face ID / passcode prompt reason")
        let result = await dependencies.deviceAuthenticator.authenticate(reason: reason)
        guard result == .success else {
            notice = .device(result)
            return
        }
        notice = nil
        step = await storedSession() == nil ? .signIn : .parentHome
    }

    func signInWithApple() async {
        guard step == .signIn, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        notice = nil
        let rawNonce = makeNonce()
        let credential: AppleCredential
        do {
            credential = try await dependencies.appleCredentials.credential(hashedNonce: Nonce.sha256Hex(rawNonce))
        } catch .cancelled {
            return
        } catch {
            notice = .appleFailed
            return
        }
        let session: ParentSession
        do {
            session = try await dependencies.signIn.signIn(identityToken: credential.identityToken, rawNonce: rawNonce)
        } catch {
            notice = .signIn(error)
            return
        }
        do {
            try dependencies.sessionStore.save(session)
        } catch {
            // Still signed in for this visit; they'll be asked again next time.
            log.error("Couldn't save the parent session: \(error)")
        }
        await dependencies.sessionChanged(session)
        step = .parentHome
    }

    func signOut() async {
        guard step == .parentHome else { return }
        do {
            try dependencies.sessionStore.clear()
        } catch {
            log.error("Couldn't clear the parent session: \(error)")
        }
        await dependencies.sessionChanged(nil)
        notice = nil
        step = .signIn
    }

    /// The stored session if it's still good; an expired one is removed.
    private func storedSession() async -> ParentSession? {
        let session: ParentSession?
        do {
            session = try dependencies.sessionStore.load()
        } catch {
            log.error("Couldn't read the parent session: \(error)")
            return nil
        }
        guard let session else { return nil }
        if session.isExpired(now: now()) {
            try? dependencies.sessionStore.clear()
            await dependencies.sessionChanged(nil)
            return nil
        }
        return session
    }
}

/// Lets the model hold whichever generator it was given.
struct AnyRandomNumberGenerator: RandomNumberGenerator {
    private var base: any RandomNumberGenerator

    init(_ base: some RandomNumberGenerator) {
        self.base = base
    }

    mutating func next() -> UInt64 { base.next() }
}
