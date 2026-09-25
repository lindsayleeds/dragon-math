import Foundation
import GameRules
import Store
import Sync
import Testing
@testable import DragonAcademy

private let loginToken = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a9b"
private let familyToken = "00000000-0000-4000-8000-000000000001"
private let kidURL = URL(string: "https://mydragonmath.com/k/\(loginToken)")!

/// A JWT-shaped token carrying `claims`; the signature is junk.
private func jwt(_ claims: String) -> String {
    let base64url = Data(claims.utf8).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    return "eyJhbGciOiJIUzI1NiJ9.\(base64url).c2ln"
}

private func kidJWT(_ id: Int) -> String { jwt(#"{"id":\#(id),"account_type":"child","exp":4102444800}"#) }
private let parentJWT = jwt(#"{"id":9,"account_type":"parent","exp":4102444800}"#)

private let sparky = RemoteChild(id: 42, username: "sparky", realName: nil, avatar: "🐉")
private let ember = RemoteChild(id: 43, username: "ember", realName: nil, avatar: "🦊")

/// The server's kid sign-in routes, scripted.
private final class StubKidSignIn: KidSignInService, @unchecked Sendable {
    private let lock = NSLock()
    var login: Result<KidAccount, KidSignInError> = .success(
        KidAccount(session: KidSession(token: kidJWT(42), childID: 42), child: sparky))
    var familyKids: Result<[RemoteChild], KidSignInError> = .success([sparky, ember])
    private(set) var calls: [String] = []

    private func record(_ call: String) { lock.withLock { calls.append(call) } }

    func signIn(loginToken: String) async throws(KidSignInError) -> KidAccount {
        record("child-login \(loginToken)")
        return try login.get()
    }

    func family(familyToken: String) async throws(KidSignInError) -> [RemoteChild] {
        record("family \(familyToken)")
        return try familyKids.get()
    }

    func signIn(childID: Int, familyToken: String) async throws(KidSignInError) -> KidAccount {
        record("family-login \(childID) \(familyToken)")
        let kid = try familyKids.get().first { $0.id == childID }
        guard let kid else { throw .notFound(message: "gone") }
        return KidAccount(session: KidSession(token: kidJWT(childID), childID: childID, familyToken: familyToken),
                          child: kid)
    }
}

/// The parent's family on the server.
private struct StubFamily: FamilyService {
    let kids: [RemoteChild]
    func children() async throws(FamilyError) -> [RemoteChild] { kids }
    func createChild(name: String?) async throws(FamilyError) -> RemoteChild { throw .unavailable }
    func setTelemetryOptOut(_ optOut: Bool, childID: Int) async throws(FamilyError) -> Bool { throw .unavailable }
    func setGamePace(_ pace: GamePace, childID: Int) async throws(FamilyError) -> GamePace { throw .unavailable }
}

@MainActor
private struct Harness {
    let store: SQLiteStore
    let player: CurrentPlayer
    let service = StubKidSignIn()
    let sessions: InMemoryKidSessionStore
    let tokens: SessionTokens
    let model: KidSignInModel

    init(parentSignedIn: Bool = false, family: [RemoteChild] = [], storedKid: KidSession? = nil) throws {
        store = try SQLiteStore.inMemory()
        player = CurrentPlayer(
            store: store, family: StubFamily(kids: family), parentSignedIn: parentSignedIn,
            signedInKidID: storedKid?.childID)
        sessions = InMemoryKidSessionStore(storedKid)
        let tokens = SessionTokens(token: parentSignedIn ? parentJWT : storedKid?.token)
        self.tokens = tokens
        model = KidSignInModel(
            service: service, sessions: sessions, store: store, player: player,
            sessionChanged: { await tokens.set($0) })
    }
}

@Suite @MainActor struct KidSignInModelTests {
    // MARK: Kid links

    @Test func aKidLinkSignsTheGuestDeviceInAsThatKid() async throws {
        let h = try Harness()
        await h.player.refresh()
        #expect(h.player.mode == .guest)

        await h.model.handle(try #require(KidLink(url: kidURL)))

        #expect(h.service.calls == ["child-login \(loginToken)"])
        #expect(h.model.phase == .closed)
        #expect(h.player.mode == .kid)
        let profile = try #require(h.player.profile)
        #expect(profile.remoteID == 42)
        #expect(profile.displayName == "sparky")
        #expect(profile.avatar == "🐉")
        // Kept for the next launch, and handed to the API client and Sync.
        #expect(try h.sessions.load() == KidSession(token: kidJWT(42), childID: 42))
        #expect(await h.tokens.current() == kidJWT(42))
        // A kid's token only ever uploads that kid's queue.
        #expect(await h.tokens.syncSession() == .child(42))
    }

    @Test func anotherKidsCodeReplacesTheSession() async throws {
        let h = try Harness(storedKid: KidSession(token: kidJWT(42), childID: 42))
        await h.player.refresh()
        #expect(h.player.profile == nil)  // sparky has no profile on this fresh store yet
        h.service.login = .success(KidAccount(session: KidSession(token: kidJWT(43), childID: 43), child: ember))

        await h.model.handle(.kid(token: loginToken))

        #expect(h.player.profile?.remoteID == 43)
        #expect(h.player.signedInKidID == 43)
        #expect(try h.sessions.load()?.childID == 43)
        #expect(await h.tokens.syncSession() == .child(43))
    }

    @Test func aKidModeDeviceReopensOnTheSignedInKid() async throws {
        let stored = KidSession(token: kidJWT(42), childID: 42)
        let h = try Harness(storedKid: stored)
        _ = try await h.store.saveChildProfile(remoteID: 42, displayName: "sparky", avatar: "🐉")

        await h.player.refresh()

        #expect(h.player.mode == .kid)
        #expect(h.player.profile?.remoteID == 42)
    }

    @Test func expiredKidSessionsAreDroppedAtLaunch() throws {
        let expired = KidSession(token: jwt(#"{"id":42,"account_type":"child","exp":1000}"#), childID: 42)
        let sessions = InMemoryKidSessionStore(expired)

        #expect(KidSignInModel.storedSession(in: sessions) == nil)
        #expect(try sessions.load() == nil)
    }

    @Test(arguments: [
        (KidSignInError.notFound(message: "We couldn't find that link. Ask for a fresh one."),
         KidSignInModel.Notice.notFound(message: "We couldn't find that link. Ask for a fresh one.")),
        (.notAKid, .notAKid),
        (.brokenLink, .brokenLink),
        (.rateLimited, .rateLimited),
        (.unavailable, .unavailable),
    ])
    func aFailedSignInLeavesTheDeviceAsItWas(error: KidSignInError, notice: KidSignInModel.Notice) async throws {
        let h = try Harness()
        h.service.login = .failure(error)

        await h.model.handle(.kid(token: loginToken))

        #expect(h.model.phase == .failed)
        #expect(h.model.notice == notice)
        #expect(h.player.mode == .guest)
        #expect(try h.sessions.load() == nil)
        #expect(await h.tokens.current() == nil)
    }

    @Test func aUniversalLinkOpensTheSignIn() async throws {
        let h = try Harness()
        #expect(h.model.open(kidURL))
        #expect(!h.model.open(URL(string: "https://mydragonmath.com/parent")!))
    }

    // MARK: Family links

    @Test func aFamilyLinkListsTheKidsThenSignsInTheOneChosen() async throws {
        let h = try Harness()

        await h.model.handle(.family(token: familyToken))
        #expect(h.model.phase == .choosing(familyToken: familyToken, kids: [sparky, ember]))

        await h.model.choose(ember)

        #expect(h.service.calls == ["family \(familyToken)", "family-login 43 \(familyToken)"])
        #expect(h.model.phase == .closed)
        #expect(h.player.profile?.remoteID == 43)
        #expect(try h.sessions.load() == KidSession(token: kidJWT(43), childID: 43, familyToken: familyToken))
    }

    @Test func switchingKidsListsTheFamilyLinkAgain() async throws {
        let h = try Harness(storedKid: KidSession(token: kidJWT(43), childID: 43, familyToken: familyToken))

        await h.model.switchKid()

        #expect(h.model.phase == .choosing(familyToken: familyToken, kids: [sparky, ember]))
    }

    @Test func switchingKidsWithoutAFamilyLinkScans() async throws {
        let h = try Harness(storedKid: KidSession(token: kidJWT(42), childID: 42))

        await h.model.switchKid()

        #expect(h.model.phase == .scanning)
    }

    // MARK: With a parent signed in

    @Test func onAFamilyDeviceAKidInTheFamilyIsJustPicked() async throws {
        let h = try Harness(parentSignedIn: true, family: [sparky, ember])
        await h.player.refresh()

        await h.model.handle(.kid(token: loginToken))

        #expect(h.model.phase == .closed)
        #expect(h.player.mode == .family)
        #expect(h.player.profile?.remoteID == 42)
        // The parent's session stays: it uploads for every kid in the family.
        #expect(await h.tokens.current() == parentJWT)
        #expect(try h.sessions.load() == nil)
    }

    @Test func onAFamilyDeviceAKidOutsideTheFamilyIsTurnedAway() async throws {
        let h = try Harness(parentSignedIn: true, family: [ember])
        await h.player.refresh()

        await h.model.handle(.kid(token: loginToken))

        #expect(h.model.notice == .notInFamily)
        #expect(h.player.isPicking)
        #expect(await h.tokens.current() == parentJWT)
        // No profile for them: the parent's session would upload it.
        #expect(try await h.store.profiles().allSatisfy { $0.remoteID != 42 })
    }

    @Test func aParentSigningInReplacesTheKidSession() async throws {
        let h = try Harness()
        await h.model.handle(.kid(token: loginToken))
        #expect(h.player.mode == .kid)

        h.model.parentSignedIn()
        await h.player.parentSessionChanged(signedIn: true)

        #expect(try h.sessions.load() == nil)
        #expect(h.player.mode == .family)
        #expect(h.player.signedInKidID == nil)
    }

    @Test func goingBackToGuestForgetsTheKid() async throws {
        let h = try Harness()
        await h.model.handle(.kid(token: loginToken))

        await h.model.signOutKid()

        #expect(h.player.mode == .guest)
        #expect(h.player.profile == h.store.guestProfile)
        #expect(try h.sessions.load() == nil)
        #expect(await h.tokens.current() == nil)
    }

    // MARK: The scanner

    @Test func aScannedKidCodeSignsIn() async throws {
        let h = try Harness()
        let camera = FakeCodeScanner()
        h.model.scan()
        let scan = CodeScanModel(scanner: camera) { await h.model.scanned($0) }
        await scan.start()
        #expect(scan.status == .scanning)
        #expect(camera.isRunning)

        camera.show(kidURL.absoluteString)
        try await waitUntil { h.model.phase == .closed }

        #expect(h.player.profile?.remoteID == 42)
        #expect(h.service.calls == ["child-login \(loginToken)"])
    }

    @Test func anyOtherCodeKeepsScanningWithAHint() async throws {
        let h = try Harness()
        let camera = FakeCodeScanner()
        h.model.scan()
        let scan = CodeScanModel(scanner: camera) { await h.model.scanned($0) }
        await scan.start()

        camera.show("WIFI:S:Classroom;T:WPA;P:secret;;")
        try await waitUntil { h.model.notice == .notACode }

        #expect(h.model.phase == .scanning)
        #expect(h.service.calls.isEmpty)
    }

    @Test func theSameCodeSeenAgainIsReadOnce() async throws {
        let reads = Reads()
        let camera = FakeCodeScanner()
        let scan = CodeScanModel(scanner: camera) { reads.codes.append($0) }
        await scan.start()

        for _ in 0..<5 { camera.show("hello") }
        camera.show("world")
        try await waitUntil { reads.codes.count == 2 }

        #expect(reads.codes == ["hello", "world"])
        scan.stop()
        #expect(!camera.isRunning)
    }

    @Test(arguments: [(CodeScannerStatus.denied, CodeScanModel.Status.denied), (.unavailable, .unavailable)])
    func noCameraSaysSo(camera: CodeScannerStatus, status: CodeScanModel.Status) async {
        let scanner = FakeCodeScanner(status: camera)
        let scan = CodeScanModel(scanner: scanner) { _ in }

        await scan.start()

        #expect(scan.status == status)
        #expect(!scanner.isRunning)
    }
}

// MARK: - Sync's token

@Suite struct SessionTokensSyncTests {
    @Test func syncGetsTheTokenOfTheSessionItChecked() async {
        let tokens = SessionTokens(token: kidJWT(42))
        #expect(await tokens.syncToken() == nil)  // not checked yet

        #expect(await tokens.syncSession() == .child(42))
        #expect(await tokens.syncToken() == kidJWT(42))
    }

    @Test func aNewKidMidSyncGetsNoTokenUntilSyncChecksAgain() async {
        let tokens = SessionTokens(token: kidJWT(42))
        _ = await tokens.syncSession()

        // Another kid's code, while Sync is uploading kid 42's queue.
        await tokens.set(kidJWT(43))

        #expect(await tokens.syncToken() == nil)
        #expect(await tokens.current() == kidJWT(43))  // the rest of the app has it at once
        #expect(await tokens.syncSession() == .child(43))
        #expect(await tokens.syncToken() == kidJWT(43))
    }

    @Test func aParentReplacingAKidMidSyncAlsoWaitsForTheNextCheck() async {
        let tokens = SessionTokens(token: kidJWT(42))
        _ = await tokens.syncSession()

        await tokens.set(parentJWT)

        #expect(await tokens.syncToken() == nil)
        #expect(await tokens.syncSession() == .parent)
        #expect(await tokens.syncToken() == parentJWT)
    }
}

@MainActor
private final class Reads {
    var codes: [String] = []
}

/// Polls `condition` (tasks the model starts finish on their own schedule).
@MainActor
private func waitUntil(_ condition: () -> Bool) async throws {
    for _ in 0..<200 {
        if condition() { return }
        try await Task.sleep(for: .milliseconds(10))
    }
    Issue.record("Timed out waiting")
}
