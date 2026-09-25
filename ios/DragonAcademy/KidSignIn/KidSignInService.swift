import API
import Foundation

/// A kid's own server session, from their login link or QR code, or from a
/// family-device link. Kept in the Keychain (``KidSessionStore``).
struct KidSession: Codable, Equatable, Sendable {
    /// The session JWT (30 days).
    let token: String
    /// The kid's server id (`users.id`), the Store profile's `remoteID`.
    let childID: Int
    /// The family-device link's token, when the session came from one, so the
    /// kid can hand over to a sibling from the same link.
    var familyToken: String?

    /// Expired sessions are dropped at launch, as parent ones are.
    func isExpired(now: Date = .now) -> Bool {
        ParentSession(token: token).isExpired(now: now)
    }
}

/// A kid signed in: their session, and their kid-facing profile for the Store.
struct KidAccount: Equatable, Sendable {
    let session: KidSession
    /// Handle and avatar only; the server never sends a real name here.
    let child: RemoteChild
}

enum KidSignInError: Error, Equatable {
    /// 400: the token isn't one the server takes.
    case brokenLink
    /// 404, with the server's kid-friendly message ("We couldn't find that
    /// link. Ask for a fresh one."). The link was revoked or never existed.
    case notFound(message: String)
    /// The link is a grown-up's (the server mints parent and teacher links
    /// for testing), or an admin's (403). This screen signs in kids only.
    case notAKid
    /// 429.
    case rateLimited
    /// No connection, a 5xx, or anything the contract doesn't describe.
    case unavailable
}

/// The server's kid sign-in routes (server/routes/auth.js). No session needed:
/// possessing the link is the credential.
protocol KidSignInService: Sendable {
    /// `POST /api/auth/child-login` with a `/k/<token>` link's token.
    func signIn(loginToken: String) async throws(KidSignInError) -> KidAccount
    /// `GET /api/auth/family/<token>`: the kids a family-device link can sign in as.
    func family(familyToken: String) async throws(KidSignInError) -> [RemoteChild]
    /// `POST /api/auth/family-login`: signs in as one of them.
    func signIn(childID: Int, familyToken: String) async throws(KidSignInError) -> KidAccount
}

/// Through the generated client. Its token provider is never consulted: these
/// routes take no Authorization header.
struct APIKidSignInService: KidSignInService {
    let api: any APIProtocol

    /// Kid sign-in never sends a session: the login link or family token is
    /// the whole credential, so a parent's session on this device must not
    /// ride along. The service therefore owns a client with no token.
    init(baseURL: URL) {
        api = DragonAPIClient(baseURL: baseURL) { nil }.api
    }

    /// For tests: `api` must be a client whose token provider returns nil.
    init(api: any APIProtocol) {
        self.api = api
    }

    func signIn(loginToken: String) async throws(KidSignInError) -> KidAccount {
        let output: Operations.ChildLogin.Output
        do {
            output = try await api.childLogin(body: .json(.init(token: loginToken)))
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let session = try? ok.body.json else { throw .unavailable }
            return try Self.account(session, familyToken: nil)
        case .badRequest:
            throw .brokenLink
        case .notFound(let notFound):
            throw .notFound(message: (try? notFound.body.json.error) ?? "")
        case .forbidden:
            throw .notAKid
        case .tooManyRequests:
            throw .rateLimited
        case .undocumented:
            throw .unavailable
        }
    }

    func family(familyToken: String) async throws(KidSignInError) -> [RemoteChild] {
        let output: Operations.GetFamily.Output
        do {
            output = try await api.getFamily(path: .init(token: familyToken))
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let body = try? ok.body.json else { throw .unavailable }
            return body.children.map { member in
                RemoteChild(
                    id: member.id, username: member.needsHandle ? nil : member.username, realName: nil,
                    avatar: member.avatar)
            }
        case .notFound(let notFound):
            throw .notFound(message: (try? notFound.body.json.error) ?? "")
        case .undocumented:
            throw .unavailable
        }
    }

    func signIn(childID: Int, familyToken: String) async throws(KidSignInError) -> KidAccount {
        let output: Operations.FamilyLogin.Output
        do {
            output = try await api.familyLogin(body: .json(.init(childId: childID, token: familyToken)))
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let session = try? ok.body.json else { throw .unavailable }
            return try Self.account(session, familyToken: familyToken)
        case .badRequest:
            throw .brokenLink
        case .notFound(let notFound):
            throw .notFound(message: (try? notFound.body.json.error) ?? "")
        case .tooManyRequests:
            throw .rateLimited
        case .undocumented:
            throw .unavailable
        }
    }

    private static func account(
        _ session: Components.Schemas.AuthSession, familyToken: String?
    ) throws(KidSignInError) -> KidAccount {
        guard case .child(let user) = session.user else { throw .notAKid }
        return KidAccount(
            session: KidSession(token: session.token, childID: user.id, familyToken: familyToken),
            // While needs_handle is set, username is a placeholder, never a name.
            child: RemoteChild(
                id: user.id, username: user.needsHandle ? nil : user.username, realName: nil,
                avatar: user.avatar))
    }
}

/// Signs in to nothing: every login link is the same kid, every family link
/// the same two. Previews use it, and so does the app with `-ParentAccessFakes YES`.
struct FakeKidSignInService: KidSignInService {
    static let kids = [
        RemoteChild(id: 2001, username: "sparky", realName: nil, avatar: "🐉"),
        RemoteChild(id: 2002, username: "ember", realName: nil, avatar: "🦊"),
    ]

    func signIn(loginToken: String) async throws(KidSignInError) -> KidAccount {
        account(Self.kids[0], familyToken: nil)
    }

    func family(familyToken: String) async throws(KidSignInError) -> [RemoteChild] {
        Self.kids
    }

    func signIn(childID: Int, familyToken: String) async throws(KidSignInError) -> KidAccount {
        guard let kid = Self.kids.first(where: { $0.id == childID }) else {
            throw .notFound(message: "That adventurer is no longer in this family.")
        }
        return account(kid, familyToken: familyToken)
    }

    private func account(_ kid: RemoteChild, familyToken: String?) -> KidAccount {
        KidAccount(session: KidSession(token: "fake.kid.session", childID: kid.id, familyToken: familyToken), child: kid)
    }
}
