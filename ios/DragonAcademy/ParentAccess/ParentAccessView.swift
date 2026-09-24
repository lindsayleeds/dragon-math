import AuthenticationServices
import SwiftUI

/// The grown-ups flow, presented full screen from the home screen.
struct ParentAccessView: View {
    @State private var model: ParentAccessModel
    @Environment(\.dismiss) private var dismiss

    init(dependencies: ParentAccessDependencies) {
        _model = State(initialValue: ParentAccessModel(dependencies: dependencies))
    }

    init(model: ParentAccessModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: 480)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(model.step == .parentHome ? "Done" : "Cancel") { dismiss() }
                            .accessibilityIdentifier("parentAccess.close")
                    }
                }
        }
        .onChange(of: model.step) { _, step in
            if step == .closed { dismiss() }
        }
    }

    @ViewBuilder private var content: some View {
        switch model.step {
        case .gate, .closed:
            ParentalGateView(model: model)
        case .deviceAuth:
            DeviceAuthView(model: model)
        case .signIn:
            ParentSignInView(model: model)
        case .parentHome:
            ParentHomeView(model: model)
        }
    }
}

struct ParentalGateView: View {
    @Bindable var model: ParentAccessModel
    @FocusState private var answerFocused: Bool

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "lock.fill")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text("For grown-ups")
                    .font(.largeTitle.bold())
                Text("Please ask a grown-up to answer this question.")
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)

            Text(model.gate.challenge.question())
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("parentalGate.question")

            TextField("Answer", text: $model.gateAnswer)
                .keyboardType(.numberPad)
                .autocorrectionDisabled()
                .font(.title2.monospacedDigit())
                .multilineTextAlignment(.center)
                .padding(12)
                .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 12))
                .focused($answerFocused)
                .onSubmit(model.submitGateAnswer)
                .accessibilityIdentifier("parentalGate.answer")

            if model.notice == .gateWrong {
                Text("That's not it. Here's a new question.")
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("parentalGate.wrong")
            }

            Button {
                model.submitGateAnswer()
            } label: {
                Text("Continue").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.gateAnswer.trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityIdentifier("parentalGate.continue")
        }
        .onAppear { answerFocused = true }
    }
}

struct DeviceAuthView: View {
    let model: ParentAccessModel

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "faceid")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text("Confirm it's you")
                .font(.largeTitle.bold())
            if let message {
                Text(message)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("deviceAuth.message")
            }
            if model.isWorking {
                ProgressView()
            } else if model.notice != .device(.unavailable) {
                Button("Try again") {
                    Task { await model.authenticateDevice() }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .accessibilityIdentifier("deviceAuth.retry")
            }
        }
        .task { await model.authenticateDevice() }
    }

    private var message: LocalizedStringKey? {
        switch model.notice {
        case .device(.cancelled):
            "Use Face ID, Touch ID or your passcode to continue."
        case .device(.unavailable):
            "Set a passcode for this device in Settings to use the parent area."
        case .device(.failed):
            "That didn't work. Try again."
        default:
            nil
        }
    }
}

struct ParentSignInView: View {
    let model: ParentAccessModel
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "person.2.fill")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text("Sign in")
                    .font(.largeTitle.bold())
                Text("Sign in to add children and manage your family.")
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)

            AppleIDButton(style: colorScheme == .dark ? .white : .black) {
                Task { await model.signInWithApple() }
            }
            .id(colorScheme)
            .frame(height: 50)
            .disabled(model.isWorking)
            .accessibilityIdentifier("parentSignIn.apple")

            if model.isWorking {
                ProgressView()
            }
            if let message {
                Text(message)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("parentSignIn.error")
            }
        }
    }

    private var message: LocalizedStringKey? {
        switch model.notice {
        case .appleFailed:
            "Couldn't sign in with Apple. Check that this device is signed in to an Apple Account and try again."
        case .signIn(.rejected):
            "Apple sign-in couldn't be confirmed. Please try again."
        case .signIn(.conflict):
            "This Apple Account's email is already used by an account that can't be linked. Sign in on the web to connect it."
        case .signIn(.rateLimited):
            "Too many attempts. Wait a few minutes and try again."
        case .signIn(.unavailable):
            "Couldn't reach Dragon Academy. Check your connection and try again."
        default:
            nil
        }
    }
}

/// Placeholder parent view; the family list, QR codes and settings replace it.
struct ParentHomeView: View {
    let model: ParentAccessModel

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 48))
                .foregroundStyle(.green)
                .accessibilityHidden(true)
            Text("Grown-ups")
                .font(.largeTitle.bold())
            Text("You're signed in.")
                .foregroundStyle(.secondary)
            FamilySection()
            Button("Sign out", role: .destructive) {
                Task { await model.signOut() }
            }
                .accessibilityIdentifier("parentHome.signOut")
        }
        .accessibilityIdentifier("parentHome")
    }
}

/// Apple's own button, as a plain control: tapping it hands over to the
/// injected `AppleCredentialProvider` rather than running a request itself
/// (which `SignInWithAppleButton` always does), so the fake works too.
struct AppleIDButton: UIViewRepresentable {
    let style: ASAuthorizationAppleIDButton.Style
    let action: () -> Void

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(authorizationButtonType: .signIn, authorizationButtonStyle: style)
        button.cornerRadius = 12
        button.addTarget(context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
        return button
    }

    func updateUIView(_ button: ASAuthorizationAppleIDButton, context: Context) {
        context.coordinator.action = action
        button.isEnabled = context.environment.isEnabled
    }

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }

    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func tapped() { action() }
    }
}

#Preview("Gate") {
    ParentAccessView(dependencies: .fake())
}

#Preview("Signed in") {
    ParentAccessView(dependencies: .fake(sessionStore: InMemoryParentSessionStore(ParentSession(token: "preview"))))
}
