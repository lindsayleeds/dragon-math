import API
import Foundation
import OSLog
import Store

/// What the server deleted (App Store Review Guideline 5.1.1(v); the rules are
/// server/lib/accountDeletion.js).
struct AccountDeletionResult: Equatable, Sendable {
    /// Children who had no other grown-up: gone with the account.
    var deletedChildIDs: [Int]
    /// Children shared with another grown-up: kept, only unlinked from this one.
    var unlinkedChildIDs: [Int]
    /// Whether the server revoked the Sign in with Apple grant.
    var appleTokenRevoked: Bool
}

enum AccountDeletionError: Error, Equatable {
    /// 401: Apple's token couldn't be verified or is another Apple Account's.
    case rejected
    /// 403: the account doesn't sign in with Apple; it's deleted on the web.
    case notAppleAccount
    /// 404: the account no longer exists.
    case alreadyDeleted
    /// No connection, a 5xx, or anything the contract doesn't describe.
    case unavailable
}

/// Deletes the signed-in parent's account on the server.
protocol AccountDeletionService: Sendable {
    func deleteAccount(identityToken: String, rawNonce: String, authorizationCode: String?)
        async throws(AccountDeletionError) -> AccountDeletionResult
}

/// `POST /api/account/delete` through the generated client. It goes out with
/// whatever `SessionTokens` holds, which is the parent's session while the
/// parent view is open; a kid's token would be refused (403), never obeyed.
struct APIAccountDeletionService: AccountDeletionService {
    let api: any APIProtocol

    func deleteAccount(identityToken: String, rawNonce: String, authorizationCode: String?)
        async throws(AccountDeletionError) -> AccountDeletionResult
    {
        let output: Operations.DeleteParentAccount.Output
        do {
            output = try await api.deleteParentAccount(body: .json(.init(
                identityToken: identityToken, nonce: rawNonce, authorizationCode: authorizationCode)))
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let body = try? ok.body.json else { throw .unavailable }
            return AccountDeletionResult(
                deletedChildIDs: body.deletedChildIds,
                unlinkedChildIDs: body.unlinkedChildIds,
                appleTokenRevoked: body.appleTokenRevoked)
        case .unauthorized, .badRequest:
            throw .rejected
        case .forbidden:
            throw .notAppleAccount
        case .notFound:
            throw .alreadyDeleted
        case .badGateway, .serviceUnavailable, .undocumented:
            throw .unavailable
        }
    }
}

/// Deletes nothing; for previews and UI checks (`-ParentAccessFakes YES`).
struct FakeAccountDeletionService: AccountDeletionService {
    func deleteAccount(identityToken: String, rawNonce: String, authorizationCode: String?)
        async throws(AccountDeletionError) -> AccountDeletionResult
    {
        AccountDeletionResult(deletedChildIDs: [], unlinkedChildIDs: [], appleTokenRevoked: true)
    }
}

/// The delete-account flow in the parent view: explain what goes, ask again,
/// then Sign in with Apple once more — the server wants a fresh Apple token for
/// this account (the proof it's the parent) and its authorization code (to
/// revoke the app's Apple grant). On success the device forgets everything the
/// account left here: the Keychain session, `SessionTokens` (via
/// `sessionChanged`) and the local profiles and queued events of every child
/// the server deleted or unlinked. The guest profile stays; it was never the
/// account's.
@MainActor
@Observable
final class AccountDeletionModel {
    enum Step: Equatable {
        case idle
        /// First confirmation: what will be deleted.
        case explaining
        /// Second confirmation: it can't be undone.
        case confirming
        case deleting
        case deleted(appleTokenRevoked: Bool)
    }

    enum Notice: Equatable {
        case appleFailed
        case failed(AccountDeletionError)
    }

    private(set) var step: Step = .idle
    private(set) var notice: Notice?

    private let appleCredentials: any AppleCredentialProvider
    private let service: any AccountDeletionService
    private let sessionStore: any ParentSessionStore
    private let sessionChanged: @Sendable (ParentSession?) async -> Void
    private let store: (any Store)?
    private let makeNonce: () -> String
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "AccountDeletion")

    init(
        dependencies: ParentAccessDependencies,
        store: (any Store)?,
        makeNonce: @escaping () -> String = { Nonce.random() }
    ) {
        appleCredentials = dependencies.appleCredentials
        service = dependencies.accountDeletion
        sessionStore = dependencies.sessionStore
        sessionChanged = dependencies.sessionChanged
        self.store = store
        self.makeNonce = makeNonce
    }

    var isFinished: Bool {
        if case .deleted = step { true } else { false }
    }

    func start() {
        guard step == .idle else { return }
        notice = nil
        step = .explaining
    }

    func continueToConfirm() {
        guard step == .explaining else { return }
        step = .confirming
    }

    /// Backs out of either confirmation; nothing has been sent.
    func cancel() {
        guard step == .explaining || step == .confirming else { return }
        step = .idle
    }

    /// The second "yes": re-authenticate with Apple, delete, forget.
    func confirmDeletion() async {
        guard step == .confirming else { return }
        notice = nil
        step = .deleting

        let rawNonce = makeNonce()
        let credential: AppleCredential
        do {
            credential = try await appleCredentials.credential(hashedNonce: Nonce.sha256Hex(rawNonce))
        } catch .cancelled {
            step = .confirming
            return
        } catch {
            notice = .appleFailed
            step = .confirming
            return
        }

        let result: AccountDeletionResult
        do {
            result = try await service.deleteAccount(
                identityToken: credential.identityToken, rawNonce: rawNonce,
                authorizationCode: credential.authorizationCode)
        } catch .alreadyDeleted {
            // Nothing left to delete on the server; still forget the session.
            await forget(childIDs: [])
            step = .deleted(appleTokenRevoked: false)
            return
        } catch {
            notice = .failed(error)
            step = .confirming
            return
        }

        await forget(childIDs: Set(result.deletedChildIDs + result.unlinkedChildIDs))
        step = .deleted(appleTokenRevoked: result.appleTokenRevoked)
    }

    private func forget(childIDs: Set<Int>) async {
        do {
            try sessionStore.clear()
        } catch {
            log.error("Couldn't clear the parent session after deletion: \(error)")
        }
        await sessionChanged(nil)
        guard let store, !childIDs.isEmpty else { return }
        do {
            try await store.removeChildProfiles(remoteIDs: childIDs)
        } catch {
            log.error("Couldn't remove deleted children's local data: \(error)")
        }
    }
}
