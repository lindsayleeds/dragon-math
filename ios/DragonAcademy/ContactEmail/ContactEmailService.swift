import API
import Foundation

/// Where a parent's progress emails and COPPA notices go (ADR 0007). The
/// server keeps this apart from the login email, which for Sign in with Apple
/// may be a private relay address, and only mails an address once it's
/// verified through the `/parent/verify` link.
struct ContactEmailStatus: Equatable, Sendable {
    /// The login email Apple shared, which may be a relay address. Nil when
    /// the parent shared none.
    var loginEmail: String?
    var contactEmail: String?
    var isVerified: Bool
}

/// The result of saving an address or re-sending its link.
struct ContactEmailUpdate: Equatable, Sendable {
    var status: ContactEmailStatus
    /// A confirmation link was just emailed. False when the address was
    /// already verified, so there was nothing to confirm.
    var verificationSent: Bool
}

enum ContactEmailError: Error, Equatable {
    /// 400: the server refused the address; its message is safe to show.
    case rejected(String)
    /// 401/403/404: the session is gone or isn't a parent's.
    case notSignedIn
    /// 409: re-send asked for with no contact email on file.
    case nothingToVerify
    /// 429.
    case rateLimited
    /// 502: the address is saved but the email couldn't be sent.
    case sendFailed
    /// No connection, a 5xx, or anything the contract doesn't describe.
    case unavailable
}

protocol ContactEmailService: Sendable {
    func status() async throws(ContactEmailError) -> ContactEmailStatus
    func setContactEmail(_ email: String) async throws(ContactEmailError) -> ContactEmailUpdate
    func resendVerification() async throws(ContactEmailError) -> ContactEmailUpdate
}

enum ContactEmailRules {
    static let privateRelayDomain = "privaterelay.appleid.com"

    /// Apple's hide-my-email addresses, which the server never accepts as a
    /// contact email (CLAUDE.md, auth boundaries).
    static func isPrivateRelay(_ email: String) -> Bool {
        email.lowercased().hasSuffix("@" + privateRelayDomain)
    }

    /// Same shape the server checks (`x@y.z`, no spaces). The server has the
    /// last word; this only saves a round trip for obvious typos.
    static func isPlausible(_ email: String) -> Bool {
        let parts = email.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, !email.contains(where: \.isWhitespace) else { return false }
        let domain = parts[1].split(separator: ".", omittingEmptySubsequences: false)
        return domain.count >= 2 && domain.allSatisfy { !$0.isEmpty }
    }

    /// What to pre-fill: the contact email already on file, else the Apple
    /// email when it's a real address, else nothing.
    static func suggestion(for status: ContactEmailStatus) -> String {
        if let contact = status.contactEmail, !contact.isEmpty { return contact }
        if let login = status.loginEmail, !isPrivateRelay(login), isPlausible(login) { return login }
        return ""
    }
}

/// `GET /api/auth/me`, `PUT /api/auth/contact-email` and
/// `POST /api/auth/contact-email/resend` through the generated client, with
/// the parent session's token.
struct APIContactEmailService: ContactEmailService {
    let api: any APIProtocol

    func status() async throws(ContactEmailError) -> ContactEmailStatus {
        let output: Operations.GetCurrentUser.Output
        do {
            output = try await api.getCurrentUser()
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let body = try? ok.body.json else { throw .unavailable }
            switch body.user {
            case .parent(let adult), .admin(let adult):
                return Self.status(adult)
            case .child:
                throw .notSignedIn
            }
        case .unauthorized, .notFound:
            throw .notSignedIn
        case .undocumented:
            throw .unavailable
        }
    }

    func setContactEmail(_ email: String) async throws(ContactEmailError) -> ContactEmailUpdate {
        let output: Operations.SetContactEmail.Output
        do {
            output = try await api.setContactEmail(body: .json(.init(email: email)))
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let body = try? ok.body.json else { throw .unavailable }
            return Self.update(body)
        case .badRequest(let bad):
            throw .rejected((try? bad.body.json.error) ?? "")
        case .unauthorized, .forbidden, .notFound:
            throw .notSignedIn
        case .tooManyRequests:
            throw .rateLimited
        case .badGateway:
            throw .sendFailed
        case .undocumented:
            throw .unavailable
        }
    }

    func resendVerification() async throws(ContactEmailError) -> ContactEmailUpdate {
        let output: Operations.ResendContactEmailVerification.Output
        do {
            output = try await api.resendContactEmailVerification()
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let body = try? ok.body.json else { throw .unavailable }
            return Self.update(body)
        case .unauthorized, .forbidden, .notFound:
            throw .notSignedIn
        case .conflict:
            throw .nothingToVerify
        case .tooManyRequests:
            throw .rateLimited
        case .badGateway:
            throw .sendFailed
        case .undocumented:
            throw .unavailable
        }
    }

    private static func status(_ adult: Components.Schemas.AdultUser) -> ContactEmailStatus {
        ContactEmailStatus(loginEmail: adult.email, contactEmail: adult.contactEmail,
                           isVerified: adult.contactEmailVerified)
    }

    private static func update(_ body: Components.Schemas.ContactEmailResponse) -> ContactEmailUpdate {
        ContactEmailUpdate(status: status(body.user), verificationSent: body.verificationSent)
    }
}

/// No server: for previews and `-ParentAccessFakes YES`. Starts as a relay
/// sign-in; a saved address reads back as verified on the next status check,
/// as if the parent had tapped the link.
final class FakeContactEmailService: ContactEmailService, @unchecked Sendable {
    private let lock = NSLock()
    private var current: ContactEmailStatus

    init(_ status: ContactEmailStatus = ContactEmailStatus(
        loginEmail: "a1b2c3@privaterelay.appleid.com", contactEmail: nil, isVerified: false)) {
        current = status
    }

    func status() async throws(ContactEmailError) -> ContactEmailStatus {
        lock.withLock {
            if current.contactEmail != nil { current.isVerified = true }
            return current
        }
    }

    func setContactEmail(_ email: String) async throws(ContactEmailError) -> ContactEmailUpdate {
        lock.withLock {
            let unchanged = current.contactEmail == email && current.isVerified
            current.contactEmail = email
            current.isVerified = unchanged
            return ContactEmailUpdate(status: current, verificationSent: !unchanged)
        }
    }

    func resendVerification() async throws(ContactEmailError) -> ContactEmailUpdate {
        lock.withLock { ContactEmailUpdate(status: current, verificationSent: !current.isVerified) }
    }
}
