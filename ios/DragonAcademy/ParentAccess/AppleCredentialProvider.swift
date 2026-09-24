import AuthenticationServices
import UIKit

/// What the app keeps from an Apple ID credential: only the identity token.
/// The server reads the `sub` and email out of it (ADR 0007).
struct AppleCredential: Equatable, Sendable {
    let identityToken: String
}

enum AppleCredentialError: Error, Equatable {
    /// The person closed the Apple sheet.
    case cancelled
    /// Apple returned a credential with no identity token.
    case missingIdentityToken
    /// Anything else Apple reported (not signed in to iCloud, no network, …).
    case failed
}

/// Runs the Sign in with Apple request. The real one shows Apple's sheet; the
/// fake answers at once, so previews and UI checks work without a paid team
/// (real sign-in needs the capability on a provisioned app, #171).
protocol AppleCredentialProvider: Sendable {
    /// - Parameter hashedNonce: `Nonce.sha256Hex(raw)`, sent as the request's nonce.
    @MainActor func credential(hashedNonce: String) async throws(AppleCredentialError) -> AppleCredential
}

@MainActor
final class SystemAppleCredentialProvider: NSObject, AppleCredentialProvider {
    private var continuation: CheckedContinuation<ASAuthorization, any Error>?
    private var controller: ASAuthorizationController?

    func credential(hashedNonce: String) async throws(AppleCredentialError) -> AppleCredential {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        // The email is the login identity the server may link on; no name is
        // needed, so none is asked for.
        request.requestedScopes = [.email]
        request.nonce = hashedNonce

        let authorization: ASAuthorization
        do {
            authorization = try await withCheckedThrowingContinuation { continuation in
                self.continuation?.resume(throwing: CancellationError())
                self.continuation = continuation
                let controller = ASAuthorizationController(authorizationRequests: [request])
                controller.delegate = self
                controller.presentationContextProvider = self
                self.controller = controller
                controller.performRequests()
            }
        } catch let error as ASAuthorizationError where error.code == .canceled {
            throw .cancelled
        } catch {
            throw .failed
        }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let data = credential.identityToken,
              let token = String(data: data, encoding: .utf8), !token.isEmpty
        else { throw .missingIdentityToken }
        return AppleCredential(identityToken: token)
    }

    private func finish(_ result: Result<ASAuthorization, any Error>) {
        continuation?.resume(with: result)
        continuation = nil
        controller = nil
    }
}

extension SystemAppleCredentialProvider: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        MainActor.assumeIsolated { finish(.success(authorization)) }
    }

    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: any Error
    ) {
        MainActor.assumeIsolated { finish(.failure(error)) }
    }
}

extension SystemAppleCredentialProvider: ASAuthorizationControllerPresentationContextProviding {
    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let active = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
            return active?.keyWindow ?? active?.windows.first ?? ASPresentationAnchor()
        }
    }
}

/// Returns a fixed credential without showing anything.
struct FakeAppleCredentialProvider: AppleCredentialProvider {
    var identityToken = "fake-apple-identity-token"

    func credential(hashedNonce: String) async throws(AppleCredentialError) -> AppleCredential {
        AppleCredential(identityToken: identityToken)
    }
}
