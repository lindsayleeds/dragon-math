import Store
import SwiftUI

/// The parent view's "Children" section: who is in the family, and the way to
/// add a child.
struct FamilySection: View {
    @Environment(\.store) private var store
    @Environment(\.family) private var family
    @State private var model: FamilyModel?
    @State private var addingChild = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Children")
                .font(.title2.bold())
            if let model {
                FamilyList(model: model)
                Button {
                    model.clearAddNotice()
                    addingChild = true
                } label: {
                    Label("Add a child", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .accessibilityIdentifier("family.add")
                .sheet(isPresented: $addingChild) {
                    AddChildView(model: model)
                }
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task {
            if model == nil, let store = store ?? (try? SQLiteStore.inMemory()) {
                model = FamilyModel(store: store, service: family)
            }
            await model?.load()
        }
    }
}

private struct FamilyList: View {
    let model: FamilyModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.children.isEmpty, !model.isLoading {
                Text("No children yet. Add one so they can play as themselves.")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("family.empty")
            }
            ForEach(model.children) { child in
                NavigationLink {
                    ChildStatsView(child: child)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.title)
                            .foregroundStyle(.tint)
                            .accessibilityHidden(true)
                        Text(child.displayName)
                            .font(.headline)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }
                    .padding(12)
                    .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 12))
                    .contentShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .disabled(child.remoteID == nil)
                .accessibilityElement(children: .combine)
                .accessibilityHint("Shows their stats")
                .accessibilityIdentifier("family.child.\(child.remoteID ?? 0)")
                TelemetryToggle(model: model, child: child)
            }
            if let message = FamilyNoticeText.message(for: model.loadNotice) {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("family.loadNotice")
            }
        }
    }
}

/// Asks for the child's name, then creates them.
struct AddChildView: View {
    let model: FamilyModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("They'll get their own map, dragons and progress. You can show them their sign-in code later.")
                    .foregroundStyle(.secondary)

                TextField("Child's name (optional)", text: $name)
                    .textContentType(.givenName)
                    .submitLabel(.done)
                    .padding(12)
                    .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 12))
                    .focused($nameFocused)
                    .onSubmit(add)
                    .accessibilityIdentifier("addChild.name")

                if let notice = model.addNotice {
                    noticeView(notice)
                }

                Button(action: add) {
                    Group {
                        if model.isAdding {
                            ProgressView()
                        } else {
                            Text("Add child")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(model.isAdding || isAtLimit)
                .accessibilityIdentifier("addChild.submit")

                Spacer()
            }
            .padding()
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
            .navigationTitle("Add a child")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .accessibilityIdentifier("addChild.cancel")
                }
            }
        }
        .onAppear { nameFocused = true }
    }

    private var isAtLimit: Bool {
        if case .limitReached = model.addNotice { true } else { false }
    }

    @ViewBuilder private func noticeView(_ notice: FamilyModel.Notice) -> some View {
        if case .limitReached(let message) = notice {
            // The plan limit: the server's own words, which name the plan.
            Label {
                Text(message)
            } icon: {
                Image(systemName: "person.3.fill")
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.orange.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityIdentifier("addChild.limit")
        } else if let message = FamilyNoticeText.message(for: notice) {
            Text(message)
                .foregroundStyle(.red)
                .accessibilityIdentifier("addChild.error")
        }
    }

    private func add() {
        Task {
            if await model.addChild(name: name) { dismiss() }
        }
    }
}

enum FamilyNoticeText {
    static func message(for notice: FamilyModel.Notice?) -> LocalizedStringKey? {
        switch notice {
        case nil:
            nil
        case .limitReached(let message), .invalid(let message):
            message.isEmpty ? "That didn't work. Please try again." : "\(message)"
        case .sessionExpired:
            "Your sign-in has expired. Sign out, then sign in again."
        case .rateLimited:
            "Too many new children for now. Try again later."
        case .unavailable:
            "Couldn't reach Dragon Academy. Check your connection and try again."
        case .notSavedOnDevice:
            "Added to your family, but this device couldn't save it yet. It will appear next time."
        }
    }
}

#Preview {
    ScrollView {
        FamilySection().padding()
    }
}
