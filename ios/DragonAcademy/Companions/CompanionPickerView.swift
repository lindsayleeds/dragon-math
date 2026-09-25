import GameRules
import OSLog
import Store
import SwiftUI
import Sync

/// "my companions": every companion as a tile, as the map's collection card
/// on the web (MapPagePaper.jsx). Befriended ones can be chosen; the rest show
/// as "?" until their boss is beaten. Choosing records a `CompanionChosen`
/// event for the guest profile and requests a sync.
struct CompanionPickerView: View {
    @Environment(\.store) private var store
    @Environment(\.sync) private var sync
    @Environment(\.currentProfile) private var profile
    @Environment(\.dismiss) private var dismiss
    @State private var progress = ProfileProgress()

    private var current: Companion { CompanionChoice.current(in: progress) }

    var body: some View {
        ZStack {
            PaperBackground()
            ScrollView {
                VStack(spacing: 20) {
                    HStack {
                        Text("my companions")
                            .font(Typeface.display(34, relativeTo: .largeTitle))
                            .foregroundStyle(Palette.charcoal)
                            .accessibilityAddTraits(.isHeader)
                        Spacer()
                        Button { dismiss() } label: { Text("Done") }
                            .buttonStyle(StampButtonStyle(kind: .secondary))
                            .accessibilityIdentifier("companions.done")
                    }
                    Text("Pick a dragon to bring into battle. Beat a boss to befriend another.")
                        .font(Typeface.body(17, relativeTo: .body))
                        .foregroundStyle(Palette.pencil)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 14)], spacing: 14) {
                        ForEach(Companion.all) { companion in
                            CompanionTile(
                                companion: companion,
                                befriended: companion.isBefriended(nodesWon: progress.nodesWon),
                                active: companion == current,
                                onChoose: { choose(companion) })
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
        .task {
            guard let store, let profile else { return }
            do {
                for try await progress in store.observeProgress(for: profile.id) {
                    self.progress = progress
                }
            } catch {
                // Keeps what it last showed, as the map does.
            }
        }
    }

    private func choose(_ companion: Companion) {
        guard let store, let profile else { return }
        let sync = sync
        Task {
            do {
                try await CompanionChoice.choose(
                    companion, in: store, for: profile.id, requestSync: { sync?.requestSync() })
            } catch {
                Logger(subsystem: "dev.placeholder.dragonacademy", category: "Companions")
                    .error("Couldn't record companion \(companion.id): \(error)")
            }
        }
    }
}

/// One companion: icon, name and Bond Power, or "?" while not befriended.
private struct CompanionTile: View {
    let companion: Companion
    let befriended: Bool
    let active: Bool
    var onChoose: () -> Void
    @Environment(\.fontTheme) private var fontTheme

    var body: some View {
        Button(action: onChoose) {
            VStack(spacing: 6) {
                Text(verbatim: befriended ? companion.icon : "?")
                    .font(befriended ? .system(size: 44) : Typeface.display(44).font(in: fontTheme))
                    .foregroundStyle(Palette.kraftDark)
                Text(verbatim: befriended ? companion.name : "???")
                    .font(Typeface.display(20, relativeTo: .headline))
                    .foregroundStyle(Palette.charcoal)
                    .multilineTextAlignment(.center)
                Group {
                    if befriended {
                        Text(verbatim: companion.bondPowerName)
                    } else {
                        Text("Beat the boss to befriend")
                    }
                }
                .font(Typeface.body(15, relativeTo: .caption))
                .foregroundStyle(Palette.pencil)
                .multilineTextAlignment(.center)
                if active {
                    Text("with you")
                        .font(Typeface.display(16, relativeTo: .caption))
                        .foregroundStyle(Palette.charcoal)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 2)
                        .background(Palette.mustard)
                        .rotationEffect(.degrees(-3))
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 170)
            .background(active ? AnyShapeStyle(Color(highlight: companion.bondPower.highlightColor).opacity(0.35)) : AnyShapeStyle(Palette.card))
            .overlay(
                Rectangle().strokeBorder(
                    active ? Palette.charcoal : Palette.kraft,
                    style: StrokeStyle(lineWidth: active ? 2.5 : 1.5, dash: active ? [] : [5, 4])))
            .opacity(befriended ? 1 : 0.55)
        }
        .buttonStyle(.plain)
        .disabled(!befriended)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
        .accessibilityLabel(befriended ? Text(verbatim: companion.name) : Text("Not befriended yet"))
        .accessibilityValue(befriended ? Text(verbatim: companion.bondPowerName) : Text(verbatim: ""))
        .accessibilityIdentifier("companion.\(companion.id)")
    }
}

extension Color {
    /// A Bond Power highlight, "#rrggbb"; the sky blue when missing or malformed.
    init(highlight: String?) {
        let hex = highlight.flatMap { UInt32($0.hasPrefix("#") ? String($0.dropFirst()) : $0, radix: 16) }
        self.init(hex: hex ?? 0x8EB0CC)
    }
}
