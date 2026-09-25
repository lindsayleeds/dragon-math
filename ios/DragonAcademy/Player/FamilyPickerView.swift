import Store
import SwiftUI

/// "Who's playing?": the first kid screen on a family device. Each kid taps
/// their own avatar. Only kid-facing names (handles) appear here, never the
/// names parents entered, since the whole family sees this screen.
struct FamilyPickerView: View {
    let player: CurrentPlayer

    /// Tiles widen with the text size, so a name never squeezes into a
    /// column too narrow for it.
    @ScaledMetric(relativeTo: .title3) private var tileWidth: CGFloat = 140

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: tileWidth, maximum: max(200, tileWidth)), spacing: 20)]
    }

    var body: some View {
        ZStack {
            PaperBackground()
            ScrollView {
                VStack(spacing: 24) {
                    ViewThatFits(in: .horizontal) {
                        HStack {
                            LoginCodeButton()
                            Spacer()
                            GrownUpsButton()
                        }
                        // Large text: one above the other.
                        VStack(alignment: .leading, spacing: 12) {
                            LoginCodeButton()
                            GrownUpsButton()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Text("Who's playing?")
                        .font(Typeface.display(40, relativeTo: .largeTitle))
                        .foregroundStyle(Palette.charcoal)
                        .rotationEffect(.degrees(-1))
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)

                    if player.kids.isEmpty {
                        if player.hasLoaded {
                            Text("No adventurers here yet. Ask a grown-up to add you in Grown-ups.")
                                .font(Typeface.body(20, relativeTo: .title3))
                                .foregroundStyle(Palette.pencil)
                                .multilineTextAlignment(.center)
                                .accessibilityIdentifier("picker.empty")
                        } else {
                            ProgressView()
                        }
                    } else {
                        LazyVGrid(columns: columns, spacing: 20) {
                            ForEach(Array(player.kids.enumerated()), id: \.element.id) { index, kid in
                                KidTile(kid: kid, rotation: index.isMultiple(of: 2) ? -1.5 : 1.2) {
                                    player.choose(kid.profile)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityIdentifier("picker")
    }
}

private struct KidTile: View {
    let kid: CurrentPlayer.Kid
    let rotation: Double
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                AvatarView(avatar: kid.profile.avatar)
                    .font(.system(size: 60))
                    .frame(width: 96, height: 96)
                    .background(Circle().fill(Palette.sage.opacity(0.35)))
                    .overlay(Circle().strokeBorder(Palette.charcoal, lineWidth: 2.5))
                Text(kid.label)
                    .font(Typeface.display(24, relativeTo: .title3))
                    .foregroundStyle(Palette.charcoal)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 180)
            .modifier(PaperCard(rotation: rotation))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(kid.label)
        .accessibilityHint(Text("Play as this adventurer"))
        .accessibilityIdentifier("picker.kid.\(kid.profile.remoteID ?? 0)")
    }
}

/// A kid's avatar as the server stores it: an emoji is drawn as text; an
/// image path, or none, as a generic figure (image avatars need the network,
/// and the picker has to work offline). Sized by the surrounding font.
struct AvatarView: View {
    let avatar: String?

    var body: some View {
        if let avatar, !avatar.isEmpty, !avatar.hasPrefix("/") {
            Text(avatar)
                .accessibilityHidden(true)
        } else {
            Image(systemName: "person.crop.circle.fill")
                .foregroundStyle(Palette.kraftDark)
                .accessibilityHidden(true)
        }
    }
}

#Preview {
    let store = try! SQLiteStore.inMemory()
    let player = CurrentPlayer(store: store, family: FakeFamilyService(), parentSignedIn: true)
    FamilyPickerView(player: player)
        .task {
            try? await store.saveChildProfile(remoteID: 1, displayName: "sparky", avatar: "🐉")
            try? await store.saveChildProfile(remoteID: 2, displayName: "ember", avatar: "🦊")
            await player.refresh()
        }
}
