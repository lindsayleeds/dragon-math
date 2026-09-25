import API
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Store
import Testing
@testable import DragonAcademy

// MARK: - The model

final class RecordingDeletionService: AccountDeletionService, @unchecked Sendable {
    private let lock = NSLock()
    var result: Result<AccountDeletionResult, AccountDeletionError> = .success(
        AccountDeletionResult(deletedChildIDs: [42], unlinkedChildIDs: [43], appleTokenRevoked: true))
    private(set) var calls: [(identityToken: String, rawNonce: String, authorizationCode: String?)] = []

    func deleteAccount(identityToken: String, rawNonce: String, authorizationCode: String?)
        async throws(AccountDeletionError) -> AccountDeletionResult
    {
        let result = lock.withLock {
            calls.append((identityToken, rawNonce, authorizationCode))
            return self.result
        }
        return try result.get()
    }
}

@MainActor
struct DeletionHarness {
    let apple = RecordingAppleProvider()
    let service = RecordingDeletionService()
    let sessions = InMemoryParentSessionStore(ParentSession(token: "parent.jwt"))
    let changes = SessionChanges()
    let store: SQLiteStore
    let model: AccountDeletionModel

    init() throws {
        store = try .inMemory()
        apple.result = .success(AppleCredential(identityToken: "fresh-apple-token", authorizationCode: "auth-code"))
        let changes = changes
        let dependencies = ParentAccessDependencies(
            sessionStore: sessions,
            deviceAuthenticator: ScriptedDeviceAuthenticator(.success),
            appleCredentials: apple,
            signIn: RecordingSignInService(),
            sessionChanged: { await changes.record($0) },
            accountDeletion: service)
        model = AccountDeletionModel(dependencies: dependencies, store: store, makeNonce: { "raw-nonce" })
    }

    /// Both confirmations, ready for the last tap.
    func confirmTwice() {
        model.start()
        model.continueToConfirm()
    }
}

@MainActor
@Suite struct AccountDeletionModelTests {
    @Test func asksTwiceBeforeAnythingIsSent() throws {
        let h = try DeletionHarness()
        #expect(h.model.step == .idle)
        h.model.start()
        #expect(h.model.step == .explaining)
        h.model.continueToConfirm()
        #expect(h.model.step == .confirming)
        #expect(h.apple.hashedNonces.isEmpty)
        #expect(h.service.calls.isEmpty)
    }

    @Test func confirmingOutOfOrderDoesNothing() async throws {
        let h = try DeletionHarness()
        await h.model.confirmDeletion()
        h.model.start()
        await h.model.confirmDeletion() // still only the first confirmation
        #expect(h.model.step == .explaining)
        #expect(h.service.calls.isEmpty)
    }

    @Test func cancellingEitherConfirmationSendsNothing() throws {
        let h = try DeletionHarness()
        h.model.start()
        h.model.cancel()
        #expect(h.model.step == .idle)
        h.confirmTwice()
        h.model.cancel()
        #expect(h.model.step == .idle)
        #expect(h.service.calls.isEmpty)
        #expect(try h.sessions.load() != nil)
    }

    @Test func reauthenticatesWithAppleAndSendsTheFreshTokenCodeAndNonce() async throws {
        let h = try DeletionHarness()
        h.confirmTwice()
        await h.model.confirmDeletion()

        #expect(h.apple.hashedNonces == [Nonce.sha256Hex("raw-nonce")])
        let call = try #require(h.service.calls.first)
        #expect(call.identityToken == "fresh-apple-token")
        #expect(call.rawNonce == "raw-nonce")
        #expect(call.authorizationCode == "auth-code")
        #expect(h.model.step == .deleted(appleTokenRevoked: true))
        #expect(h.model.isFinished)
    }

    @Test func onSuccessForgetsTheSessionAndTheDeletedAndUnlinkedChildren() async throws {
        let h = try DeletionHarness()
        let deleted = try await h.store.addChildProfile(remoteID: 42, displayName: "Ada")
        let unlinked = try await h.store.addChildProfile(remoteID: 43, displayName: "Bo")
        let other = try await h.store.addChildProfile(remoteID: 99, displayName: "Cy")
        try await h.store.record(NodeWon(nodeID: 3), for: deleted.id)
        try await h.store.record(NodeWon(nodeID: 4), for: unlinked.id)
        try await h.store.record(NodeWon(nodeID: 5), for: h.store.guestProfile.id)

        h.confirmTwice()
        await h.model.confirmDeletion()

        #expect(try h.sessions.load() == nil)
        #expect(await h.changes.all == [nil])
        #expect(try await h.store.profiles() == [h.store.guestProfile, other])
        #expect(try await h.store.events(for: deleted.id).isEmpty)
        #expect(try await h.store.events(for: unlinked.id).isEmpty)
        #expect(try await h.store.events(for: h.store.guestProfile.id).count == 1)
    }

    @Test func reportsAnUnrevokedAppleGrant() async throws {
        let h = try DeletionHarness()
        h.service.result = .success(AccountDeletionResult(deletedChildIDs: [], unlinkedChildIDs: [], appleTokenRevoked: false))
        h.confirmTwice()
        await h.model.confirmDeletion()
        #expect(h.model.step == .deleted(appleTokenRevoked: false))
    }

    @Test func closingApplesSheetGoesBackToTheFinalConfirmation() async throws {
        let h = try DeletionHarness()
        h.apple.result = .failure(.cancelled)
        h.confirmTwice()
        await h.model.confirmDeletion()
        #expect(h.model.step == .confirming)
        #expect(h.model.notice == nil)
        #expect(h.service.calls.isEmpty)
        #expect(try h.sessions.load() != nil)
    }

    @Test func appleFailingKeepsTheAccountAndSaysSo() async throws {
        let h = try DeletionHarness()
        h.apple.result = .failure(.failed)
        h.confirmTwice()
        await h.model.confirmDeletion()
        #expect(h.model.notice == .appleFailed)
        #expect(h.service.calls.isEmpty)
    }

    @Test(arguments: [AccountDeletionError.rejected, .notAppleAccount, .unavailable])
    func aServerErrorKeepsEverythingLocal(error: AccountDeletionError) async throws {
        let h = try DeletionHarness()
        let child = try await h.store.addChildProfile(remoteID: 42, displayName: "Ada")
        h.service.result = .failure(error)
        h.confirmTwice()
        await h.model.confirmDeletion()

        #expect(h.model.step == .confirming)
        #expect(h.model.notice == .failed(error))
        #expect(try h.sessions.load() != nil)
        #expect(await h.changes.all.isEmpty)
        #expect(try await h.store.profiles().contains(child))

        // Trying again goes through.
        h.service.result = .success(AccountDeletionResult(deletedChildIDs: [42], unlinkedChildIDs: [], appleTokenRevoked: true))
        await h.model.confirmDeletion()
        #expect(h.model.isFinished)
        #expect(h.model.notice == nil)
    }

    @Test func anAccountAlreadyGoneStillSignsOut() async throws {
        let h = try DeletionHarness()
        h.service.result = .failure(.alreadyDeleted)
        h.confirmTwice()
        await h.model.confirmDeletion()
        #expect(h.model.step == .deleted(appleTokenRevoked: false))
        #expect(try h.sessions.load() == nil)
        #expect(await h.changes.all == [nil])
    }
}

// MARK: - The API call

private final class StubTransport: ClientTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [(request: HTTPRequest, body: Data?)] = []
    let status: HTTPResponse.Status
    let json: String

    init(status: HTTPResponse.Status = .ok, json: String) {
        self.status = status
        self.json = json
    }

    var requests: [(request: HTTPRequest, body: Data?)] { lock.withLock { sent } }

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let data: Data? = if let body { try await Data(collecting: body, upTo: 1 << 20) } else { nil }
        lock.withLock { sent.append((request, data)) }
        var response = HTTPResponse(status: status)
        response.headerFields[.contentType] = "application/json; charset=utf-8"
        return (response, HTTPBody(json))
    }
}

private func deletionService(_ transport: StubTransport) -> APIAccountDeletionService {
    APIAccountDeletionService(api: DragonAPIClient(baseURL: URL(string: "http://localhost:3001")!,
                                                   transport: transport) { "parent.jwt" }.api)
}

@Test func postsTheAppleCredentialAndReadsWhatWasDeleted() async throws {
    let transport = StubTransport(json: #"{"deleted_child_ids": [42], "unlinked_child_ids": [43], "apple_token_revoked": true}"#)

    let result = try await deletionService(transport).deleteAccount(
        identityToken: "apple.id.token", rawNonce: "raw", authorizationCode: "code")

    #expect(result == AccountDeletionResult(deletedChildIDs: [42], unlinkedChildIDs: [43], appleTokenRevoked: true))
    let sent = try #require(transport.requests.first)
    #expect(sent.request.method == .post)
    #expect(sent.request.path == "/api/account/delete")
    #expect(sent.request.headerFields[.authorization] == "Bearer parent.jwt")
    let body = try JSONSerialization.jsonObject(with: try #require(sent.body)) as? [String: String]
    #expect(body == ["identity_token": "apple.id.token", "nonce": "raw", "authorization_code": "code"])
}

@Test(arguments: [
    (HTTPResponse.Status.unauthorized, AccountDeletionError.rejected),
    (.badRequest, .rejected),
    (.forbidden, .notAppleAccount),
    (.notFound, .alreadyDeleted),
    (.badGateway, .unavailable),
    (.serviceUnavailable, .unavailable),
    (.internalServerError, .unavailable),
])
func mapsDeletionErrors(status: HTTPResponse.Status, expected: AccountDeletionError) async {
    let transport = StubTransport(status: status, json: #"{"error": "nope"}"#)
    await #expect(throws: expected) {
        try await deletionService(transport).deleteAccount(identityToken: "t", rawNonce: "n", authorizationCode: nil)
    }
}
