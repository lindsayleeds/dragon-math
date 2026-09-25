import Foundation
import Security

/// Where the signed-in kid's session lives between launches. One at a time: a
/// kid's code on a device with no parent replaces the last kid's session.
protocol KidSessionStore: Sendable {
    func load() throws -> KidSession?
    func save(_ session: KidSession) throws
    func clear() throws
}

/// One generic-password item in the Keychain, next to the parent's and with
/// the same protection: readable after first unlock (for background sync),
/// never migrated to another device. Holds the session as JSON.
struct KeychainKidSessionStore: KidSessionStore {
    var service = (Bundle.main.bundleIdentifier ?? "dev.placeholder.dragonacademy") + ".kid-session"
    var account = "kid"

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() throws -> KidSession? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        guard let data = result as? Data else { return nil }
        // Unreadable (e.g. written by a future version): treated as signed out.
        return try? JSONDecoder().decode(KidSession.self, from: data)
    }

    func save(_ session: KidSession) throws {
        let update: [String: Any] = [
            kSecValueData as String: try JSONEncoder().encode(session),
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

/// For tests, previews and the fakes.
final class InMemoryKidSessionStore: KidSessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: KidSession?

    init(_ session: KidSession? = nil) {
        self.session = session
    }

    func load() throws -> KidSession? { lock.withLock { session } }
    func save(_ session: KidSession) throws { lock.withLock { self.session = session } }
    func clear() throws { lock.withLock { session = nil } }
}
