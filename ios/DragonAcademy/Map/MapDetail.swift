import GameRules
import SwiftUI

/// How the map screen lays itself out (#135). A regular width (iPad full
/// screen in either orientation, the wide Split View and Stage Manager
/// widths) has room for the node detail panel beside the map; a compact
/// width (iPhone, narrow Split View, Slide Over, a small Stage Manager
/// window) keeps the iPhone map, where tapping a node starts its battle.
///
/// Decided by the horizontal size class, not the device idiom, so an iPad
/// window that shrinks to compact gets the iPhone behavior.
enum MapArrangement: Equatable {
    /// The map beside the detail panel; tapping a node selects it.
    case withDetailPanel
    /// The map alone; tapping a playable node plays it.
    case mapOnly

    static func forSizeClass(_ horizontalSizeClass: UserInterfaceSizeClass?) -> Self {
        horizontalSizeClass == .regular ? .withDetailPanel : .mapOnly
    }

    /// The panel's width beside the map.
    static let panelWidth: CGFloat = 340
    /// Beside the panel the map stops growing at this width (1.6× the web's
    /// 400-unit map), so the nodes stay node-sized on a 13" iPad; the paper
    /// fills the rest of its column.
    static let maxMapWidth: CGFloat = 640

    /// What tapping `node` does in this arrangement.
    func tap(_ node: MapNode, progress: MapProgress) -> MapTap {
        switch self {
        case .withDetailPanel:
            // Locked nodes too: the panel says what it takes to unlock them.
            .select(nodeID: node.id)
        case .mapOnly:
            progress.canPlay(node.id) ? .play(nodeID: node.id) : .ignore
        }
    }
}

/// The result of tapping a node on the map.
enum MapTap: Equatable {
    /// Start this node's battle (the iPhone tap, and the panel's Play button).
    case play(nodeID: Int)
    /// Show this node in the detail panel.
    case select(nodeID: Int)
    /// A locked node on the iPhone map: nothing happens.
    case ignore
}

/// Where a node stands for the player, as the detail panel names it.
enum MapNodeStatus: Equatable {
    case locked
    case unlocked
    case complete

    init(_ state: MapNodeState) {
        switch state {
        case .locked: self = .locked
        case .available: self = .unlocked
        case .won: self = .complete
        }
    }
}

/// Everything the detail panel shows for one node: the web map's node card
/// (MapPagePaper.jsx: icon, name, boss tag, story line, "begin quest" /
/// "fight the dragon") plus its world, status and best stars.
struct MapNodeDetail: Equatable {
    let node: MapNode
    let world: MapWorld?
    let status: MapNodeStatus
    /// Best stars (1–3) for a complete node, where known. Nil for a node not
    /// won yet, and for one won before stars were recorded or passed over by
    /// a Dragon's Trial placement.
    let stars: Int?

    static let maxStars = 3

    init(node: MapNode, progress: MapProgress, stars: [Int: Int]) {
        self.node = node
        world = GameMap.world(forNode: node.id)
        status = MapNodeStatus(progress.state(of: node.id))
        self.stars = status == .complete ? stars[node.id].map { min(max($0, 0), Self.maxStars) } : nil
    }

    /// The node the panel shows: the one the player tapped, or before any
    /// tap the node they're up to (the last one once the map is won).
    init?(selected nodeID: Int?, progress: MapProgress, stars: [Int: Int]) {
        guard let node = nodeID.flatMap(GameMap.node) ?? progress.focus else { return nil }
        self.init(node: node, progress: progress, stars: stars)
    }

    /// What the Play button does: the same as tapping the node on the iPhone
    /// map. Nil while the node is locked (no button).
    var play: MapTap? {
        status == .locked ? nil : .play(nodeID: node.id)
    }
}

/// The node detail panel beside the iPad map: an index card like the web's
/// node modal, with the node's world, status and stars.
struct MapDetailPanel: View {
    let detail: MapNodeDetail
    var onPlay: (Int) -> Void

    private var isBoss: Bool { detail.node.isBoss }

    var body: some View {
        ScrollView(.vertical) {
            VStack(spacing: 14) {
                icon
                VStack(spacing: 4) {
                    Text(detail.node.localizedLabel)
                        .font(Typeface.display(30, relativeTo: .title))
                        .foregroundStyle(Palette.charcoal)
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("map.detail.name")
                    if let world = detail.world {
                        Text(world.localizedName)
                            .font(Typeface.body(18, relativeTo: .headline))
                            .foregroundStyle(Color(hex: world.chapterColor))
                            .accessibilityIdentifier("map.detail.world")
                    }
                    if isBoss {
                        Text("↯ boss battle ↯")
                            .font(Typeface.body(16, relativeTo: .subheadline))
                            .foregroundStyle(Palette.rose)
                    }
                }
                statusTag
                if let stars = detail.stars {
                    MapDetailStars(filled: stars)
                }
                VStack(spacing: 6) {
                    Text(isBoss ? bossStory : questStory)
                        .font(Typeface.body(17, relativeTo: .body))
                        .italic()
                        .foregroundStyle(Palette.pencil)
                        .multilineTextAlignment(.center)
                    Text("— ✎ the storyteller")
                        .font(Typeface.body(15, relativeTo: .footnote))
                        .foregroundStyle(Palette.kraft)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                playButton
            }
            .padding(24)
            .background(Palette.card)
            .overlay(Rectangle().strokeBorder(Palette.kraft, lineWidth: 1.5))
            .shadow(color: Palette.charcoal.opacity(0.15), radius: 0, x: 3, y: 4)
            .rotationEffect(.degrees(-0.8))
            .padding(20)
            // A new node's card reads as new to VoiceOver.
            .id(detail.node.id)
        }
        .scrollIndicators(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("map.detail")
    }

    private var bossStory: LocalizedStringKey {
        "\"A fearsome dragon guards this pass. Be brave, traveler — sharpen your sums and steady your hand.\""
    }

    private var questStory: LocalizedStringKey {
        "\"Another duel waits along the path. Answer faster than your foe, and the road opens onward.\""
    }

    @ViewBuilder private var icon: some View {
        let locked = detail.status == .locked
        Group {
            if let art = detail.node.bossArt {
                Image(art)
                    .resizable()
                    .frame(width: 96, height: 96)
            } else {
                Text(verbatim: detail.node.icon)
                    .font(.system(size: 56))
            }
        }
        .opacity(locked ? 0.45 : 1)
        .accessibilityHidden(true)
    }

    private var statusTag: some View {
        let (text, color): (Text, Color) =
            switch detail.status {
            case .locked: (Text("🔒 Locked"), Palette.paperRule)
            case .unlocked: (Text("Ready to play"), Palette.sage)
            case .complete: (Text("✓ Complete"), Palette.mustard)
            }
        return text
            .font(Typeface.body(17, relativeTo: .body))
            .foregroundStyle(Palette.charcoal)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .background(color.opacity(0.6))
            .overlay(Rectangle().strokeBorder(Palette.charcoal.opacity(0.6), lineWidth: 1.2))
            .rotationEffect(.degrees(1.5))
            .accessibilityIdentifier("map.detail.status")
    }

    @ViewBuilder private var playButton: some View {
        if case .play(let nodeID) = detail.play {
            Button {
                onPlay(nodeID)
            } label: {
                Text(isBoss ? "⚔ fight the dragon" : "✎ begin quest")
            }
            .buttonStyle(StampButtonStyle())
            .accessibilityHint(isBoss ? Text("Starts a boss battle.") : Text("Starts a battle."))
            .accessibilityIdentifier("map.detail.play")
        } else {
            Text("Win the nodes before it to unlock it.")
                .font(Typeface.body(16, relativeTo: .callout))
                .foregroundStyle(Palette.pencil)
                .multilineTextAlignment(.center)
        }
    }
}

/// 1–3 stars, the rest dimmed.
private struct MapDetailStars: View {
    let filled: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<MapNodeDetail.maxStars, id: \.self) { i in
                Text(verbatim: "★")
                    .font(.system(size: 28))
                    .foregroundStyle(i < filled ? Palette.mustard : Palette.paperRule.opacity(0.6))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(filled) out of 3 stars"))
        .accessibilityIdentifier("map.detail.stars")
    }
}
