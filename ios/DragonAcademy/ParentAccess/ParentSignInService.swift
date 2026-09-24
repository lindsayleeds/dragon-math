import API
import Foundation

enum ParentSignInError: Error, Equatable {
    /// 401: the server couldn't verify the Apple token (or the nonce didn't match).
    case rejected
    /// 409: the Apple ID's email belongs to an account it can't be attached to.
    case conflict
    /// 429.
    case rateLimited
    /// No connection, a 5xx, or anything the contract doesn't describe.
    case unavailable
}

/// Trades an Apple identity token for a parent session.
protocol ParentSignInService: Sendable {
    func signIn(identityToken: String, rawNonce: String) async throws(ParentSignInError) -> ParentSession
}

/// `POST /api/auth/apple` through the generated client.
struct APIParentSignInService: ParentSignInService {
    let api: any APIProtocol

    func signIn(identityToken: String, rawNonce: String) async throws(ParentSignInError) -> ParentSession {
        let output: Operations.AppleSignIn.Output
        do {
            output = try await api.appleSignIn(body: .json(.init(identityToken: identityToken, nonce: rawNonce)))
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let session = try? ok.body.json else { throw .unavailable }
            return ParentSession(token: session.token)
        case .unauthorized, .badRequest:
            throw .rejected
        case .conflict:
            throw .conflict
        case .tooManyRequests:
            throw .rateLimited
        case .badGateway, .serviceUnavailable, .undocumented:
            throw .unavailable
        }
    }
}

/// Signs in to nothing; for previews and UI checks.
struct FakeParentSignInService: ParentSignInService {
    func signIn(identityToken: String, rawNonce: String) async throws(ParentSignInError) -> ParentSession {
        ParentSession(token: "fake.parent.session")
    }
}
