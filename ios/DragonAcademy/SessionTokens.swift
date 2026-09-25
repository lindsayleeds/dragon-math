import API
import Foundation
import Sync

/// The signed-in session's bearer token, shared by the API client and Sync.
/// Nil while signed out, so nothing uploads and the queue waits on the device.
/// The app seeds it from the Keychain at launch and parent sign-in/out (#120)
/// updates it.
///
/// On a family iPad this is the PARENT's token, whichever kid is playing:
/// switching kids on the family picker (#124) is local and never changes it,
/// and a parent session may upload for every linked child. Should a kid's own
/// token ever be set here, ``syncSession()`` says so and Sync sends only that
/// kid's queue (the server would drop a sibling's as `not_your_child`).
///
/// A kid's own token is set here when a kid signs in with their login link or
/// QR code on a device with no parent signed in (#132), and a later kid's
/// code replaces it. Sync reaches the server through ``syncProvider``, which
/// only hands out the token Sync last checked with ``syncSession()``: if the
/// token changes while a sync is uploading kid A's queue, the rest of that run
/// gets no token (a 401, and the events stay queued) rather than kid B's.
actor SessionTokens {
    private var token: String?
    /// What ``syncSession()`` last told Sync; ``syncToken()`` matches it.
    private var checkedSyncSession: SyncSession = .none

    init(token: String? = nil) { self.token = token }

    func current() -> String? { token }

    func set(_ token: String?) { self.token = token }

    /// Whose session this is, from the token's own claims (`account_type`,
    /// `id`). Only used to decide whose queues Sync may send; the server
    /// checks the signature and enforces the same rule.
    func syncSession() -> SyncSession {
        checkedSyncSession = Self.syncSession(of: token)
        return checkedSyncSession
    }

    /// Whose session this is, like ``syncSession()`` but without becoming
    /// the session Sync's token follows. For everything but Sync (e.g.
    /// `PremiumAccess`), so it can't move Sync's check mid-upload.
    func session() -> SyncSession {
        Self.syncSession(of: token)
    }

    /// The token for Sync's requests: the current one only while it is still
    /// the session ``syncSession()`` last reported, else nil.
    func syncToken() -> String? {
        guard checkedSyncSession != .none, Self.syncSession(of: token) == checkedSyncSession else { return nil }
        return token
    }

    private static func syncSession(of token: String?) -> SyncSession {
        guard let token else { return .none }
        let claims = jwtClaims(token)
        if claims?["account_type"] as? String == "child" {
            // A kid token with an unreadable id can't safely send anyone's.
            guard let id = (claims?["id"] as? NSNumber)?.intValue else { return .none }
            return .child(id)
        }
        return .parent
    }

    /// For the app's API client (everything but Sync).
    nonisolated var provider: DragonAPIClient.TokenProvider {
        { [self] in await current() }
    }

    /// For Sync's API client; see ``syncToken()``.
    nonisolated var syncProvider: DragonAPIClient.TokenProvider {
        { [self] in await syncToken() }
    }
}

/// A JWT's payload claims, unverified; nil if it can't be read. The app never
/// trusts them for access: the server checks the signature.
func jwtClaims(_ token: String) -> [String: Any]? {
    let parts = token.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3 else { return nil }
    var base64 = parts[1].replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    guard let data = Data(base64Encoded: base64) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
}
