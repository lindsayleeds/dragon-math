import GameRules
import Store
import SwiftUI

/// The map route: the player's progress from the Store, the scrolling map,
/// and the header's companion, Lair and grown-ups buttons. Tapping a node that's unlocked hands its id to
/// `onSelectNode`, which starts that node's battle.
struct MapScreen: View {
    var onSelectNode: (Int) -> Void
    var onOpenLair: () -> Void
    /// Back to the family picker, on a family device; nil for the guest.
    var switchKid: (() -> Void)? = nil

    @Environment(\.store) private var store
    /// Who is playing: the guest, or the kid picked on the family picker.
    @Environment(\.currentProfile) private var profile
    @State private var progress = MapProgress()
    @State private var companion: Companion = .pip
    @State private var showingCompanions = false

    var body: some View {
        ZStack {
            PaperBackground()
            MapScrollView(progress: progress) { node in
                guard progress.canPlay(node.id) else { return }
                onSelectNode(node.id)
            }
        }
        .overlay(alignment: .top) { header }
        .sheet(isPresented: $showingCompanions) {
            CompanionPickerView()
        }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: profile?.id) {
            guard let store, let profile else { return }
            do {
                for try await update in store.observeProgress(for: profile.id) {
                    progress = MapProgress(update)
                    companion = CompanionChoice.current(in: update)
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

    /// Back to the family picker so a sibling can play. No gate: kids switch
    /// between themselves freely. The kid's own avatar, so they know whose
    /// map this is.
    @ViewBuilder private var switchKidButton: some View {
        if let switchKid, let profile {
            Button(action: switchKid) {
                AvatarView(avatar: profile.avatar)
                    .font(.system(size: 22))
            }
            .buttonStyle(StampButtonStyle(kind: .secondary))
            .accessibilityLabel(Text("Switch player"))
            .accessibilityValue(Text(verbatim: profile.displayName))
            .accessibilityIdentifier("map.switchKid")
        }
    }

    /// Who comes into battle; opens the companion picker (#138). Just the
    /// icon, so the header still fits an iPhone's width.
    private var companionButton: some View {
        Button {
            showingCompanions = true
        } label: {
            Text(verbatim: companion.icon)
        }
        .buttonStyle(StampButtonStyle(kind: .secondary))
        .accessibilityLabel(Text("Companion: \(companion.name)"))
        .accessibilityHint(Text("Choose the dragon you bring into battle."))
        .accessibilityIdentifier("home.companion")
    }

    private var header: some View {
        HStack {
            switchKidButton
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
            companionButton
            lairButton
            GrownUpsButton()
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
