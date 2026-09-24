import Foundation
import LocalAuthentication

enum DeviceAuthResult: Equatable, Sendable {
    case success
    /// The person dismissed the prompt, or the system did (e.g. app backgrounded).
    case cancelled
    /// The device has no passcode, so there is nothing to check against.
    case unavailable
    /// Checked and not the owner, or locked out after too many tries.
    case failed
}

/// Face ID, Touch ID or the device passcode, after the parental gate.
protocol DeviceAuthenticator: Sendable {
    func authenticate(reason: String) async -> DeviceAuthResult
}

/// `.deviceOwnerAuthentication`: biometrics with the passcode as fallback, or
/// just the passcode on a device without biometrics.
struct LocalDeviceAuthenticator: DeviceAuthenticator {
    func authenticate(reason: String) async -> DeviceAuthResult {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return .unavailable
        }
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
                ? .success : .failed
        } catch let error as LAError {
            return Self.result(for: error.code)
        } catch {
            return .failed
        }
    }

    static func result(for code: LAError.Code) -> DeviceAuthResult {
        switch code {
        case .userCancel, .appCancel, .systemCancel, .userFallback:
            .cancelled
        case .passcodeNotSet:
            .unavailable
        default:
            .failed
        }
    }
}

/// Answers every prompt with a fixed result; for previews and UI checks.
struct FakeDeviceAuthenticator: DeviceAuthenticator {
    var result: DeviceAuthResult = .success

    func authenticate(reason: String) async -> DeviceAuthResult { result }
}
