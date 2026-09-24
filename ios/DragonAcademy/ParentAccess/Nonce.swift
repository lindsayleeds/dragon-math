import CryptoKit
import Foundation
import Security

/// The Sign in with Apple nonce (ADR 0007). The app makes a random raw nonce,
/// puts its SHA-256 (lowercase hex) in the Apple authorization request, and
/// sends the raw value with the identity token to `POST /api/auth/apple`,
/// which checks the token's `nonce` claim against the hash. A token lifted
/// from one sign-in therefore can't be replayed with a different nonce.
enum Nonce {
    /// URL-safe characters, so the raw nonce survives any transport unescaped.
    static let alphabet = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_")

    /// A raw nonce of `length` characters from the system CSPRNG.
    static func random(length: Int = 32) -> String {
        precondition(length > 0)
        var bytes = [UInt8](repeating: 0, count: length)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed: \(status)")
        // 256 is a multiple of the 64-character alphabet, so `% count` is unbiased.
        return String(bytes.map { alphabet[Int($0) % alphabet.count] })
    }

    /// SHA-256 of the UTF-8 bytes, as lowercase hex — what the request carries.
    static func sha256Hex(_ raw: String) -> String {
        SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
