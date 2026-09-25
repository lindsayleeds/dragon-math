import SwiftUI

/// "Where should we send progress emails?" — the address field, then "check
/// your inbox" until the link is tapped, then where emails go. Shown as a
/// sheet after first sign-in and pushed from the parent view's row.
struct ContactEmailView: View {
    @State private var model: ContactEmailModel
    /// Called when the parent is finished (Done, Not now). Nil when pushed,
    /// where the navigation bar's back button does that job.
    var onFinish: (() -> Void)?

    init(model: ContactEmailModel, onFinish: (() -> Void)? = nil) {
        _model = State(initialValue: model)
        self.onFinish = onFinish
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                content
                noticeText
            }
            .frame(maxWidth: 480)
            .padding()
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Progress emails")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView()
                .padding(.top, 48)
        case .editing:
            ContactEmailForm(model: model, onFinish: onFinish)
        case .awaitingVerification(let address):
            AwaitingVerification(model: model, address: address)
        case .verified(let address):
            Verified(model: model, address: address, onFinish: onFinish)
        }
    }

    @ViewBuilder private var noticeText: some View {
        if let message {
            message
                .foregroundStyle(model.notice == .resent ? Color.secondary : Color.red)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("contactEmail.notice")
        }
    }

    private var message: Text? {
        switch model.notice {
        case .rejected(let message): Text(verbatim: message)  // the server's own words
        case let notice?: localized(notice).map { Text($0) }
        case nil: nil
        }
    }

    private func localized(_ notice: ContactEmailModel.Notice) -> LocalizedStringKey? {
        switch notice {
        case .invalidEmail: "That doesn't look like an email address."
        case .relayAddress: "That's an Apple private relay address. Enter an email you check, so progress emails reach you."
        case .rejected: nil
        case .sendFailed: "We saved your email but couldn't send the confirmation link. Try sending it again."
        case .resent: "We sent a new link."
        case .notYetVerified: "Not confirmed yet. Tap the link in the email, then try again."
        case .rateLimited: "Too many tries. Wait a little while and try again."
        case .notSignedIn: "You've been signed out. Close this and sign in again."
        case .unavailable: "Couldn't reach Dragon Academy. Check your connection and try again."
        }
    }
}

private struct ContactEmailForm: View {
    @Bindable var model: ContactEmailModel
    var onFinish: (() -> Void)?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "envelope.fill")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text("Where should we send progress emails?")
                    .font(.title.bold())
                Text("We'll send your child's weekly progress and important notices about your account here. We'll email you a link to confirm it.")
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)

            TextField("Email address", text: $model.email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.continue)
                .padding(12)
                .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 12))
                .focused($focused)
                .onSubmit { Task { await model.submit() } }
                .accessibilityIdentifier("contactEmail.field")

            Button {
                Task { await model.submit() }
            } label: {
                Text("Continue").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!model.canSubmit)
            .accessibilityIdentifier("contactEmail.submit")

            if model.isWorking {
                ProgressView()
            }
            if let onFinish, model.context == .firstSignIn {
                Button("Not now", action: onFinish)
                    .accessibilityIdentifier("contactEmail.skip")
            }
        }
        .onAppear { focused = model.email.isEmpty }
    }
}

private struct AwaitingVerification: View {
    let model: ContactEmailModel
    let address: String

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "envelope.badge.fill")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text("Check your inbox")
                    .font(.title.bold())
                Text("We sent a link to \(address). Tap it to confirm, and progress emails will start going there.")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("contactEmail.sentTo")
            }
            .multilineTextAlignment(.center)

            Button {
                Task { await model.checkVerification() }
            } label: {
                Text("I've confirmed it").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.isWorking)
            .accessibilityIdentifier("contactEmail.check")

            if model.isWorking {
                ProgressView()
            }
            HStack(spacing: 24) {
                Button("Send the link again") { Task { await model.resend() } }
                    .accessibilityIdentifier("contactEmail.resend")
                Button("Use a different email", action: model.changeAddress)
                    .accessibilityIdentifier("contactEmail.change")
            }
            .disabled(model.isWorking)
        }
    }
}

private struct Verified: View {
    let model: ContactEmailModel
    let address: String
    var onFinish: (() -> Void)?

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 48))
                .foregroundStyle(.green)
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text("Progress emails go to")
                    .foregroundStyle(.secondary)
                Text(verbatim: address)
                    .font(.title3.weight(.semibold))
                    .accessibilityIdentifier("contactEmail.verifiedAddress")
            }
            .multilineTextAlignment(.center)

            if let onFinish {
                Button {
                    onFinish()
                } label: {
                    Text("Done").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .accessibilityIdentifier("contactEmail.done")
            }
            Button("Change email", action: model.changeAddress)
                .accessibilityIdentifier("contactEmail.change")
        }
    }
}

/// The parent view's row: opens `ContactEmailView` to see or change where
/// progress emails go. A changed address needs confirming again.
struct ContactEmailRow: View {
    let service: any ContactEmailService

    var body: some View {
        NavigationLink {
            ContactEmailView(model: ContactEmailModel(service: service, context: .settings))
        } label: {
            Label("Progress emails", systemImage: "envelope")
        }
        .accessibilityIdentifier("parentHome.contactEmail")
    }
}

#Preview("First sign-in, relay") {
    NavigationStack {
        ContactEmailView(model: ContactEmailModel(service: FakeContactEmailService(), context: .firstSignIn)) {}
    }
}

#Preview("Settings, verified") {
    NavigationStack {
        ContactEmailView(model: ContactEmailModel(
            service: FakeContactEmailService(.init(loginEmail: nil, contactEmail: "mum@example.com", isVerified: true)),
            context: .settings))
    }
}
