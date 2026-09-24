import Foundation
import Observation

/// Asking for, changing and confirming the parent's contact email — where
/// progress emails go (ADR 0007). Used right after first sign-in (pre-filled
/// with what Apple shared, unless that's a relay address) and from the parent
/// view to change it later. Every new address is unverified until the parent
/// taps the link the server emails; nothing is sent to it before then.
@MainActor
@Observable
final class ContactEmailModel {
    enum Context: Equatable {
        /// Right after Sign in with Apple: always shows the question.
        case firstSignIn
        /// From the parent view: shows what's on file first.
        case settings
    }

    enum Phase: Equatable {
        case loading
        /// The address field is showing.
        case editing
        /// A link went to this address; waiting for the parent to tap it.
        case awaitingVerification(String)
        /// Progress emails go here.
        case verified(String)
    }

    enum Notice: Equatable {
        case invalidEmail
        case relayAddress
        case rejected(String)
        case sendFailed
        case resent
        case notYetVerified
        case rateLimited
        case notSignedIn
        case unavailable
    }

    let context: Context
    private(set) var phase: Phase = .loading
    private(set) var notice: Notice?
    private(set) var isWorking = false
    var email = ""

    private let service: any ContactEmailService

    init(service: any ContactEmailService, context: Context) {
        self.service = service
        self.context = context
    }

    /// Whether Continue can be tapped.
    var canSubmit: Bool {
        !isWorking && !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func load() async {
        guard phase == .loading, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        let status: ContactEmailStatus
        do {
            status = try await service.status()
        } catch {
            // Still let them type an address; saving will tell them if the
            // server is unreachable.
            notice = Self.notice(for: error)
            phase = .editing
            return
        }
        email = ContactEmailRules.suggestion(for: status)
        phase = switch (context, status.contactEmail) {
        case (.settings, let contact?) where status.isVerified: .verified(contact)
        case (.settings, let contact?): .awaitingVerification(contact)
        default: .editing
        }
    }

    func submit() async {
        guard phase == .editing, canSubmit else { return }
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard ContactEmailRules.isPlausible(address) else {
            notice = .invalidEmail
            return
        }
        guard !ContactEmailRules.isPrivateRelay(address) else {
            notice = .relayAddress
            return
        }
        isWorking = true
        defer { isWorking = false }
        notice = nil
        do {
            let update = try await service.setContactEmail(address)
            email = address
            apply(update.status, fallback: address)
        } catch .sendFailed {
            // Saved, but the link didn't go out: offer Resend from the waiting screen.
            email = address
            phase = .awaitingVerification(address)
            notice = .sendFailed
        } catch {
            notice = Self.notice(for: error)
        }
    }

    func resend() async {
        guard case .awaitingVerification(let address) = phase, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let update = try await service.resendVerification()
            apply(update.status, fallback: address)
            if update.verificationSent { notice = .resent }
        } catch {
            notice = Self.notice(for: error)
        }
    }

    /// "I've tapped the link": asks the server whether it's verified now.
    func checkVerification() async {
        guard case .awaitingVerification(let address) = phase, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let status = try await service.status()
            apply(status, fallback: address)
            if case .awaitingVerification = phase { notice = .notYetVerified }
        } catch {
            notice = Self.notice(for: error)
        }
    }

    /// Back to the address field, keeping the current address to edit.
    func changeAddress() {
        switch phase {
        case .verified(let address), .awaitingVerification(let address):
            email = address
        case .loading, .editing:
            break
        }
        notice = nil
        phase = .editing
    }

    private func apply(_ status: ContactEmailStatus, fallback: String) {
        let address = status.contactEmail ?? fallback
        notice = nil
        phase = status.isVerified ? .verified(address) : .awaitingVerification(address)
    }

    private static func notice(for error: ContactEmailError) -> Notice {
        switch error {
        case .rejected(let message): message.isEmpty ? .invalidEmail : .rejected(message)
        case .notSignedIn: .notSignedIn
        case .nothingToVerify: .unavailable
        case .rateLimited: .rateLimited
        case .sendFailed: .sendFailed
        case .unavailable: .unavailable
        }
    }
}
