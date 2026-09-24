import Foundation
import Security

/// A signed-in parent: the server's session JWT (30 days, `AuthSession.token`).
struct ParentSession: Equatable, Sendable {
    let token: String

    /// The JWT's `exp`, or nil if it can't be read. The app never trusts the
    /// payload for anything else; the server checks the signature.
    var expiresAt: Date? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var base64 = parts[1].replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = payload["exp"] as? NSNumber
        else { return nil }
        return Date(timeIntervalSince1970: exp.doubleValue)
    }

    /// Expired sessions are dropped at launch rather than sent and refused.
    /// A token whose expiry can't be read is kept and left to the server.
    func isExpired(now: Date = .now) -> Bool {
        guard let expiresAt else { return false }
        return expiresAt <= now
    }
}

/// Where the parent session lives between launches.
protocol ParentSessionStore: Sendable {
    func load() throws -> ParentSession?
    func save(_ session: ParentSession) throws
    func clear() throws
}

struct KeychainError: Error, Equatable {
    let status: OSStatus
}

/// One generic-password item in the Keychain. Readable after first unlock (so
/// background sync can use it later) and never migrated to another device.
struct KeychainParentSessionStore: ParentSessionStore {
    var service = (Bundle.main.bundleIdentifier ?? "dev.placeholder.dragonacademy") + ".parent-session"
    var account = "parent"

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() throws -> ParentSession? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        guard let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return ParentSession(token: token)
    }

    func save(_ session: ParentSession) throws {
        let data = Data(session.token.utf8)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(update) { $1 } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }
}

/// For tests and previews.
final class InMemoryParentSessionStore: ParentSessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: ParentSession?

    init(_ session: ParentSession? = nil) {
        self.session = session
    }

    func load() throws -> ParentSession? { lock.withLock { session } }
    func save(_ session: ParentSession) throws { lock.withLock { self.session = session } }
    func clear() throws { lock.withLock { session = nil } }
}
