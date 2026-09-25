import GameRules
import Store
import SwiftUI

/// The map route: the player's progress from the Store, the scrolling map,
/// and the header's companion, Lair, Den and grown-ups buttons. Tapping a node that's unlocked hands its id to
/// `onSelectNode`, which starts that node's battle. At a regular width the
/// map sits beside a detail panel instead (#135): a tap selects the node and
/// the panel's Play button starts it (`MapArrangement`).
struct MapScreen: View {
    var onSelectNode: (Int) -> Void
    var onOpenLair: () -> Void
    /// Opens the Dragon's Trial, offered while the kid has no progress.
    var onTakeTrial: () -> Void = {}
    /// Opens the Dragon Den, the kid's collection (#142).
    var onOpenCollection: () -> Void = {}
    /// Back to the family picker on a family device, or to the kid-mode
    /// landing for a kid signed in with their own code; nil for the guest.
    var switchKid: (() -> Void)? = nil

    @Environment(\.store) private var store
    /// Who is playing: the guest, or the kid picked on the family picker.
    @Environment(\.currentProfile) private var profile
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var progress = MapProgress()
    /// Best stars per won node, for the detail panel.
    @State private var stars: [Int: Int] = [:]
    /// The node shown in the detail panel; nil until one is tapped.
    @State private var selectedNodeID: Int?
    @State private var companion: Companion = .pip
    @State private var showingCompanions = false

    private var arrangement: MapArrangement { .forSizeClass(horizontalSizeClass) }

    var body: some View {
        content
            .sheet(isPresented: $showingCompanions) {
                CompanionPickerView()
            }
            .toolbar(.hidden, for: .navigationBar)
        .task(id: profile?.id) {
            guard let store, let profile else { return }
            do {
                for try await update in store.observeProgress(for: profile.id) {
                    progress = MapProgress(update)
                    stars = update.stars
                    companion = CompanionChoice.current(in: update)
                }
            } catch {
                // The stream only ends in error if the database does; the map
                // keeps what it last showed.
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch arrangement {
        case .mapOnly:
            map
        case .withDetailPanel:
            HStack(spacing: 0) {
                map
                if let detail = MapNodeDetail(selected: selectedNodeID, progress: progress, stars: stars) {
                    MapDetailPanel(detail: detail, onPlay: onSelectNode)
                        .frame(width: MapArrangement.panelWidth)
                        .background {
                            PaperBackground()
                                .overlay(alignment: .leading) {
                                    Rectangle().fill(Palette.kraft.opacity(0.5)).frame(width: 1.5)
                                }
                                .ignoresSafeArea()
                        }
                }
            }
        }
    }

    /// The scrolling map with its header and the trial banner.
    private var map: some View {
        ZStack {
            PaperBackground()
            MapScrollView(
                progress: progress,
                maxMapWidth: arrangement == .withDetailPanel ? MapArrangement.maxMapWidth : nil,
                selectedNodeID: arrangement == .withDetailPanel ? shownNodeID : nil,
                tapSelects: arrangement == .withDetailPanel
            ) { node in
                switch arrangement.tap(node, progress: progress) {
                case .play(let nodeID): onSelectNode(nodeID)
                case .select(let nodeID): selectedNodeID = nodeID
                case .ignore: break
                }
            }
            // An inset, not an overlay: the map scrolls under the banner but
            // its first nodes (at the bottom) rest above it, so a new player
            // can still tap node 1 instead of the banner covering it.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                TrialInvitation(action: onTakeTrial, style: .banner)
                    .padding(.horizontal)
                    .padding(.bottom, 12)
            }
        }
        .overlay(alignment: .top) { header }
    }

    /// The node the panel shows, ringed on the map.
    private var shownNodeID: Int? {
        MapNodeDetail(selected: selectedNodeID, progress: progress, stars: stars)?.node.id
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

    /// The header row, with the Den and kid Settings buttons tucked under
    /// its end (the row itself has no room left on a phone).
    private var header: some View {
        VStack(alignment: .trailing, spacing: 8) {
            headerRow
            HStack(spacing: 8) {
                DragonDenButton(action: onOpenCollection)
                KidSettingsButton()
            }
            .padding(.horizontal)
        }
    }

    /// One row when it fits; at large text sizes the quest count drops under
    /// the buttons, and at the largest the buttons scroll sideways, so no
    /// label is ever cut off (#168).
    private var headerRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                leadingButtons
                questCount
                Spacer()
                trailingButtons
            }
            VStack(alignment: .trailing, spacing: 8) {
                HStack {
                    leadingButtons
                    Spacer()
                    trailingButtons
                }
                questCount
            }
            VStack(alignment: .trailing, spacing: 8) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        leadingButtons
                        trailingButtons
                    }
                    .padding(.vertical, 4)
                }
                questCount
            }
        }
        .padding(.horizontal)
        .padding(.top, 4)
    }

    @ViewBuilder private var leadingButtons: some View {
        switchKidButton
        if switchKid == nil {
            // The guest can sign in as themselves with their QR code.
            LoginCodeButton(compact: true)
        }
    }

    @ViewBuilder private var trailingButtons: some View {
        companionButton
        lairButton
        GrownUpsButton()
    }

    private var questCount: some View {
        Text("\(progress.wonCount) / \(GameMap.nodes.count) quests")
            .font(Typeface.body(17, relativeTo: .body))
            .foregroundStyle(Palette.charcoal)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Palette.cardTop.opacity(0.92))
            .overlay(Rectangle().strokeBorder(Palette.kraft, lineWidth: 1.5))
            .rotationEffect(.degrees(-1.5))
            .accessibilityLabel(Text(QuestCountAccessibility.label(won: progress.wonCount, total: GameMap.nodes.count)))
            .accessibilityIdentifier("map.quests")
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
    /// Beside the iPad detail panel the map stops growing at this width,
    /// centered in its column; nil fills the width.
    var maxMapWidth: CGFloat? = nil
    /// The node the detail panel shows, ringed on the map.
    var selectedNodeID: Int? = nil
    /// Beside the detail panel, taps select nodes (locked ones too).
    var tapSelects = false
    var onSelectNode: (MapNode) -> Void

    @State private var position = ScrollPosition(edge: .bottom)

    var body: some View {
        GeometryReader { proxy in
            let layout = MapLayout(width: min(proxy.size.width, maxMapWidth ?? .infinity))
            ScrollView(.vertical) {
                MapCanvas(
                    layout: layout, progress: progress, selectedNodeID: selectedNodeID,
                    tapSelects: tapSelects, onSelectNode: onSelectNode
                )
                .frame(maxWidth: .infinity)
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
/// map fills the width; beside the iPad detail panel (#135) it stops at
/// `MapArrangement.maxMapWidth`.
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
