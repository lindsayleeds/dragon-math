import Store
import SwiftUI

/// "Take the Dragon's Trial" — the way in for a kid who hasn't taken it. The
/// trial is once per child (docs/TRIAL.md), so this disappears once their
/// Store progress has a placement. On the map it's offered only to a kid with
/// no progress at all, where a placement can save them the early worlds; the
/// lair offers it to anyone who hasn't taken it (a placement never moves a
/// kid back).
struct TrialInvitation: View {
    enum Style {
        /// Over the bottom of the map.
        case banner
        /// A card at the top of the lair.
        case card
    }

    var action: () -> Void
    let style: Style

    @Environment(\.store) private var store
    @Environment(\.currentProfile) private var profile
    /// Hidden until the progress says otherwise, so it never flashes up for a
    /// kid who has taken it.
    @State private var offered = false

    /// Whether to offer the trial for this progress.
    nonisolated static func offers(_ progress: ProfileProgress, style: Style) -> Bool {
        guard !progress.trialTaken else { return false }
        switch style {
        case .banner: return progress.nodesWon.isEmpty && progress.frontier <= 1
        case .card: return true
        }
    }

    var body: some View {
        Group {
            if offered {
                Button(action: action) {
                    HStack(spacing: 12) {
                        Text(verbatim: "🐉").font(.system(size: 34))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Take the Dragon's Trial")
                                .font(Typeface.display(22, relativeTo: .title3))
                            Text("A few problems, and the dragon finds where your journey starts.")
                                .font(Typeface.body(15, relativeTo: .subheadline))
                                .foregroundStyle(Palette.pencil)
                                .multilineTextAlignment(.leading)
                        }
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(Palette.charcoal)
                    .padding(14)
                    .frame(maxWidth: 520)
                    .paperCard(rotation: style == .banner ? -0.8 : 0.5)
                    .overlay(alignment: .topLeading) {
                        WashiTape(color: Palette.lavender, width: 56, rotation: -8).offset(x: -8, y: -8)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
                .accessibilityIdentifier("trial.invitation")
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: offered)
        .task(id: profile?.id) {
            guard let store, let profile else { return }
            do {
                for try await progress in store.observeProgress(for: profile.id) {
                    offered = Self.offers(progress, style: style)
                }
            } catch {
                // Keeps what it last showed.
            }
        }
    }
}
