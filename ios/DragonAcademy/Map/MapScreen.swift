import GameRules
import Store
import SwiftUI

/// The map route: the player's progress from the Store, the scrolling map,
/// and the grown-ups button. Tapping a node that's unlocked hands its id to
/// `onSelectNode`, which starts that node's battle.
struct MapScreen: View {
    var onSelectNode: (Int) -> Void
    var onOpenLair: () -> Void

    @Environment(\.store) private var store
    @Environment(\.parentAccess) private var parentAccess
    @State private var progress = MapProgress()
    @State private var showingParentAccess = false

    var body: some View {
        ZStack {
            PaperBackground()
            MapScrollView(progress: progress) { node in
                guard progress.canPlay(node.id) else { return }
                onSelectNode(node.id)
            }
        }
        .overlay(alignment: .top) { header }
        .fullScreenCover(isPresented: $showingParentAccess) {
            ParentAccessView(dependencies: parentAccess)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            guard let store else { return }
            // The guest until choosing who's playing lands (#119); then this
            // is the current profile.
            do {
                for try await update in store.observeProgress(for: store.guestProfile.id) {
                    progress = MapProgress(update)
                }
            } catch {
                // The stream only ends in error if the database does; the map
                // keeps what it last showed.
            }
        }
    }

    /// The way into the Learning Lair (#155). It sits in the header rather
    /// than over the map, where it would cover the first nodes.
    private var lairButton: some View {
        Button(action: onOpenLair) {
            Text("🦉 Lair")
        }
        .buttonStyle(StampButtonStyle(kind: .secondary))
        .accessibilityLabel(Text("Learning Lair"))
        .accessibilityHint(Text("Practice games for math, spelling, phonics and memorizing."))
        .accessibilityIdentifier("home.learningLair")
    }

    private var header: some View {
        HStack {
            Text("\(progress.wonCount) / \(GameMap.nodes.count) quests")
                .font(Typeface.body(17, relativeTo: .body))
                .foregroundStyle(Palette.charcoal)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Palette.cardTop.opacity(0.92))
                .overlay(Rectangle().strokeBorder(Palette.kraft, lineWidth: 1.5))
                .rotationEffect(.degrees(-1.5))
                .accessibilityIdentifier("map.quests")
            Spacer()
            lairButton
            // Small and out of the way; what keeps kids out is the gate and
            // device check behind it, not the button being hard to find.
            Button {
                showingParentAccess = true
            } label: {
                Label("Grown-ups", systemImage: "lock.fill")
                    .lineLimit(1)
                    .fixedSize()
            }
            .buttonStyle(StampButtonStyle(kind: .secondary))
            .accessibilityIdentifier("home.grownUps")
        }
        .padding(.horizontal)
        .padding(.top, 4)
    }
}

extension MapProgress {
    /// The map's view of a profile's derived progress.
    init(_ progress: ProfileProgress) {
        self.init(nodesWon: progress.nodesWon, frontier: progress.frontier)
    }
}

/// The map filling the screen's width, scrolled vertically. Opens on the
/// player's current node, and follows it when it moves on.
struct MapScrollView: View {
    let progress: MapProgress
    var onSelectNode: (MapNode) -> Void

    @State private var position = ScrollPosition(edge: .bottom)

    var body: some View {
        GeometryReader { proxy in
            let layout = MapLayout(width: proxy.size.width)
            ScrollView(.vertical) {
                MapCanvas(layout: layout, progress: progress, onSelectNode: onSelectNode)
            }
            .scrollIndicators(.hidden)
            // The first nodes are at the bottom, so start there; a scroll
            // request made before the map has laid out is clamped to the top.
            .defaultScrollAnchor(.bottom)
            .scrollPosition($position)
            .task(id: progress.focus?.id) {
                // One tick so the content size is known before scrolling.
                try? await Task.sleep(for: .milliseconds(50))
                if let node = progress.focus {
                    position.scrollTo(y: layout.scrollOffset(centering: node, viewportHeight: proxy.size.height))
                }
            }
            .accessibilityIdentifier("map.scroll")
        }
    }
}

/// Map coordinates → points for one on-screen size of the map. The iPhone
/// map fills the width; iPad landscape (#135) can pick another scale.
struct MapLayout: Equatable {
    /// Points per map unit.
    var scale: CGFloat

    init(width: CGFloat) {
        scale = max(width, 1) / GameMap.width
    }

    var size: CGSize {
        CGSize(width: GameMap.width * scale, height: GameMap.height * scale)
    }

    func point(_ p: MapPoint) -> CGPoint {
        CGPoint(x: p.x * scale, y: (p.y - GameMap.top) * scale)
    }

    func frame(_ tile: MapArtTile) -> CGRect {
        CGRect(x: 0, y: (tile.top - GameMap.top) * scale, width: GameMap.width * scale, height: tile.height * scale)
    }

    /// The content offset that puts `node` in the middle of a viewport this
    /// tall, kept within the map.
    func scrollOffset(centering node: MapNode, viewportHeight: CGFloat) -> CGFloat {
        let target = point(node.position).y - viewportHeight / 2
        return min(max(0, target), max(0, size.height - viewportHeight))
    }
}
