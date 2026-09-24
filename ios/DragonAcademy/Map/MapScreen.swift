import Store
import SwiftUI

/// A map node, as the screens need it: `MAP_NODES` in src/data/mapData.js.
/// Only the first node exists until the full map lands (#134).
struct MapNodeInfo: Identifiable, Equatable {
    let id: Int
    let label: LocalizedStringResource
    let icon: String

    static let all: [MapNodeInfo] = [
        MapNodeInfo(id: 1, label: "Meadow Gate", icon: "🏡"),
    ]

    /// The node with this id, or the first one.
    static func named(_ id: Int) -> MapNodeInfo {
        all.first { $0.id == id } ?? all[0]
    }
}

/// Placeholder map: world 1's chapter heading and a single node. The real
/// paper map replaces it in #134.
struct MapScreen: View {
    var onSelectNode: (Int) -> Void
    var onOpenLair: () -> Void

    @Environment(\.store) private var store
    @Environment(\.parentAccess) private var parentAccess
    @State private var nodesWon: Set<Int> = []
    @State private var showingParentAccess = false

    var body: some View {
        ZStack {
            PaperBackground()
            VStack(spacing: 28) {
                HStack {
                    Spacer()
                    // Small and out of the way; what keeps kids out is the
                    // gate and device check behind it, not the button being
                    // hard to find.
                    Button {
                        showingParentAccess = true
                    } label: {
                        Label("Grown-ups", systemImage: "lock.fill")
                    }
                    .buttonStyle(StampButtonStyle(kind: .secondary))
                    .accessibilityIdentifier("home.grownUps")
                }
                .padding(.horizontal)
                VStack(spacing: 2) {
                    Text("~ chapter one ~")
                        .font(Typeface.body(18, relativeTo: .headline))
                        .foregroundStyle(Palette.kraftDark)
                    Text("Mushroom Forest")
                        .font(Typeface.display(40, relativeTo: .largeTitle))
                        .foregroundStyle(Palette.charcoal)
                        .rotationEffect(.degrees(-1))
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)

                Spacer()
                ForEach(MapNodeInfo.all) { node in
                    MapNodeButton(node: node, won: nodesWon.contains(node.id)) {
                        onSelectNode(node.id)
                    }
                }
                Spacer()
                Button(action: onOpenLair) {
                    Text("🦉 Learning Lair")
                }
                .buttonStyle(StampButtonStyle())
                .accessibilityLabel(Text("Learning Lair"))
                .accessibilityHint(Text("Practice games for math, spelling, phonics and memorizing."))
                .accessibilityIdentifier("home.learningLair")
                Spacer()
            }
            .padding(.vertical, 16)
        }
        .fullScreenCover(isPresented: $showingParentAccess) {
            ParentAccessView(dependencies: parentAccess)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            guard let store else { return }
            do {
                for try await progress in store.observeProgress(for: store.guestProfile.id) {
                    nodesWon = progress.nodesWon
                }
            } catch {
                // The stream only ends in error if the database does; the map
                // keeps what it last showed.
            }
        }
    }
}

/// A crayon-circle medallion (BRAND.md "Map nodes"): sage while available,
/// mustard with a ✓ stamp once won, the dashed rose pulse ring and a gentle
/// bob on the node to play next.
private struct MapNodeButton: View {
    let node: MapNodeInfo
    let won: Bool
    var action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var bobbing = false

    /// Twice the web's r = 25, since this placeholder has the screen to itself.
    private let radius: CGFloat = 50

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                ZStack {
                    if !won {
                        Circle()
                            .strokeBorder(Palette.rose, style: StrokeStyle(lineWidth: 2, dash: [3, 4]))
                            .frame(width: (radius + 18) * 2, height: (radius + 18) * 2)
                    }
                    Circle()
                        .fill(Palette.charcoal.opacity(0.15))
                        .frame(width: radius * 2, height: radius * 2)
                        .offset(x: 3, y: 4)
                    Circle()
                        .fill(won ? Palette.mustard : Palette.sage)
                        .overlay(Circle().strokeBorder(Palette.charcoal, lineWidth: 3))
                        .overlay(alignment: .topLeading) {
                            Ellipse()
                                .fill(Color(hex: 0xFFF8E2).opacity(0.28))
                                .frame(width: radius * 0.8, height: radius * 0.5)
                                .offset(x: radius * 0.35, y: radius * 0.3)
                        }
                        .frame(width: radius * 2, height: radius * 2)
                        .rotationEffect(.degrees(-3))
                    Text(verbatim: node.icon)
                        .font(.system(size: radius * 0.72))
                    if won {
                        Text(verbatim: "✓")
                            .font(Typeface.display(22))
                            .foregroundStyle(Palette.charcoal)
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(Palette.mustard))
                            .overlay(Circle().strokeBorder(Palette.charcoal, lineWidth: 2))
                            .rotationEffect(.degrees(8))
                            .offset(x: radius * 0.78, y: -radius * 0.78)
                    }
                }
                .overlay(alignment: .leading) {
                    Text("you →")
                        .font(Typeface.display(24))
                        .foregroundStyle(Palette.rose)
                        .rotationEffect(.degrees(-6))
                        .fixedSize()
                        .offset(x: -radius - 50)
                        .accessibilityHidden(true)
                }
                Text(node.label)
                    .font(Typeface.display(26, relativeTo: .title2))
                    .foregroundStyle(Palette.charcoal)
            }
            .offset(y: bobbing && !won ? -4 : 0)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(Text(node.label))
        .accessibilityValue(won ? Text("won") : Text("not won yet"))
        .accessibilityHint(Text("Starts a battle."))
        .accessibilityIdentifier("map.node.\(node.id)")
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) { bobbing = true }
        }
    }
}
