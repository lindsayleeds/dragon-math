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
actor SessionTokens {
    private var token: String?

    init(token: String? = nil) { self.token = token }

    func current() -> String? { token }

    func set(_ token: String?) { self.token = token }

    /// Whose session this is, from the token's own claims (`account_type`,
    /// `id`). Only used to decide whose queues Sync may send; the server
    /// checks the signature and enforces the same rule.
    func syncSession() -> SyncSession {
        guard let token else { return .none }
        let claims = jwtClaims(token)
        if claims?["account_type"] as? String == "child" {
            // A kid token with an unreadable id can't safely send anyone's.
            guard let id = (claims?["id"] as? NSNumber)?.intValue else { return .none }
            return .child(id)
        }
        return .parent
    }

    nonisolated var provider: DragonAPIClient.TokenProvider {
        { [self] in await current() }
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
