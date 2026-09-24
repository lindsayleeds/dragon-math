import Foundation
@testable import DragonAcademy

/// SplitMix64, so gate challenges are the same on every run.
struct TestRNG: RandomNumberGenerator {
    var state: UInt64

    init(seed: UInt64 = 1) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

/// Answers device-auth prompts from a script, then with the last entry.
final class ScriptedDeviceAuthenticator: DeviceAuthenticator, @unchecked Sendable {
    private let lock = NSLock()
    private var results: [DeviceAuthResult]
    private(set) var prompts = 0

    init(_ results: DeviceAuthResult...) { self.results = results }

    func authenticate(reason: String) async -> DeviceAuthResult {
        lock.withLock {
            prompts += 1
            return results.count > 1 ? results.removeFirst() : results[0]
        }
    }
}

@MainActor
final class RecordingAppleProvider: AppleCredentialProvider {
    var result: Result<AppleCredential, AppleCredentialError> = .success(AppleCredential(identityToken: "apple-token"))
    private(set) var hashedNonces: [String] = []

    func credential(hashedNonce: String) async throws(AppleCredentialError) -> AppleCredential {
        hashedNonces.append(hashedNonce)
        return try result.get()
    }
}

final class RecordingSignInService: ParentSignInService, @unchecked Sendable {
    private let lock = NSLock()
    var result: Result<ParentSession, ParentSignInError> = .success(ParentSession(token: "server.jwt.token"))
    private(set) var calls: [(identityToken: String, rawNonce: String)] = []

    func signIn(identityToken: String, rawNonce: String) async throws(ParentSignInError) -> ParentSession {
        let result = lock.withLock {
            calls.append((identityToken, rawNonce))
            return self.result
        }
        return try result.get()
    }
}

/// A JWT-shaped string whose payload carries `exp`; the signature is junk.
func fakeJWT(exp: Date) -> String {
    let payload = #"{"id":1,"exp":\#(Int(exp.timeIntervalSince1970))}"#
    let base64url = Data(payload.utf8).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    return "eyJhbGciOiJIUzI1NiJ9.\(base64url).c2ln"
}
