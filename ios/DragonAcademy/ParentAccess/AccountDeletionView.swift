import SwiftUI

/// The parent view's "Delete account" row. It owns the whole flow: a sheet that
/// explains what goes, a second "can't be undone" confirmation, Apple's sheet,
/// then the result. Once the account is gone, closing the result closes the
/// parent area too, back to the kid's home screen.
struct DeleteAccountRow: View {
    @Environment(\.parentAccess) private var parentAccess
    @Environment(\.store) private var store
    @Environment(\.dismiss) private var dismissParentArea
    @State private var model: AccountDeletionModel?

    var body: some View {
        Button("Delete account", role: .destructive) {
            let model = AccountDeletionModel(dependencies: parentAccess, store: store)
            model.start()
            self.model = model
        }
        .accessibilityIdentifier("parentHome.deleteAccount")
        .sheet(item: Binding(get: { model.map(SheetItem.init) }, set: { if $0 == nil { close() } })) { item in
            AccountDeletionSheet(model: item.model, onClose: close)
                .interactiveDismissDisabled(item.model.step == .deleting || item.model.isFinished)
        }
    }

    private func close() {
        let finished = model?.isFinished == true
        model?.cancel()
        model = nil
        if finished { dismissParentArea() }
    }

    private struct SheetItem: Identifiable {
        let model: AccountDeletionModel
        var id: ObjectIdentifier { ObjectIdentifier(model) }
    }
}

struct AccountDeletionSheet: View {
    let model: AccountDeletionModel
    let onClose: () -> Void
    @State private var showingFinalConfirmation = false

    var body: some View {
        NavigationStack {
            ScrollView {
                content
                    .frame(maxWidth: 480)
                    .padding()
                    .frame(maxWidth: .infinity)
            }
            .toolbar {
                if !model.isFinished && model.step != .deleting {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Keep my account", action: onClose)
                            .accessibilityIdentifier("deleteAccount.keep")
                    }
                }
            }
        }
        .alert("Delete everything for good?", isPresented: $showingFinalConfirmation) {
            Button("Delete everything", role: .destructive) {
                Task { await model.confirmDeletion() }
            }
            Button("Cancel", role: .cancel) { model.cancel() }
        } message: {
            Text("This can't be undone. Next, sign in with Apple once more to confirm it's you.")
        }
        .onChange(of: model.step) { _, step in
            if step == .idle { onClose() }
        }
    }

    @ViewBuilder private var content: some View {
        switch model.step {
        case .deleted(let revoked):
            DeletedView(appleTokenRevoked: revoked, onDone: onClose)
        case .deleting:
            VStack(spacing: 16) {
                ProgressView()
                Text("Deleting your account…")
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 48)
        default:
            explanation
        }
    }

    private var explanation: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label("Delete your account?", systemImage: "exclamationmark.triangle.fill")
                .font(.title.bold())
                .foregroundStyle(.red)
            Text("Deleting your account permanently removes:")
            VStack(alignment: .leading, spacing: 12) {
                bullet("Your grown-up account and its sign-in with Apple.")
                bullet("Every child who isn't linked to another grown-up, with all their progress, dragons, scores and practice history.")
                bullet("This device's copy of those children's play.")
            }
            Text("A child who is also linked to another grown-up stays with them; only your link is removed.")
                .foregroundStyle(.secondary)
            Text("Subscriptions bought through the App Store aren't cancelled by this. Manage them in Settings under your Apple Account.")
                .foregroundStyle(.secondary)

            if let message {
                Text(message)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("deleteAccount.error")
            }

            Button(role: .destructive) {
                // Also the way back in after an error or a closed Apple sheet:
                // the final confirmation is asked again every time.
                model.continueToConfirm()
                showingFinalConfirmation = true
            } label: {
                Text(model.notice == nil ? "Continue" : "Try again").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
            .controlSize(.large)
            .accessibilityIdentifier("deleteAccount.continue")
        }
    }

    private func bullet(_ text: LocalizedStringKey) -> some View {
        Label { Text(text) } icon: { Image(systemName: "trash").foregroundStyle(.red) }
    }

    private var message: LocalizedStringKey? {
        switch model.notice {
        case .appleFailed:
            "Couldn't confirm with Apple. Check that this device is signed in to an Apple Account and try again."
        case .failed(.rejected):
            "That Apple Account isn't the one this account signs in with. Nothing was deleted."
        case .failed(.notAppleAccount):
            "This account doesn't use Sign in with Apple. Delete it from the parent dashboard on the website."
        case .failed(.unavailable):
            "Couldn't reach Dragon Academy, so nothing was deleted. Check your connection and try again."
        case .failed(.alreadyDeleted), nil:
            nil
        }
    }
}

private struct DeletedView: View {
    let appleTokenRevoked: Bool
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(.green)
                .accessibilityHidden(true)
            Text("Your account is deleted")
                .font(.title.bold())
            Text("You're signed out on this device.")
                .foregroundStyle(.secondary)
            if !appleTokenRevoked {
                Text("To also remove Dragon Academy from your Apple Account, go to Settings, tap your name, then Sign in with Apple.")
                    .foregroundStyle(.secondary)
            }
            Button(action: onDone) {
                Text("Done").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("deleteAccount.done")
        }
        .multilineTextAlignment(.center)
        .padding(.top, 32)
        .accessibilityIdentifier("deleteAccount.deleted")
    }
}

#Preview("Delete account") {
    DeleteAccountRow()
}
