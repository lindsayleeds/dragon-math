import Foundation
import GameRules
import SwiftUI

/// The paper map at one scale, layered like MapPagePaper.jsx: each world's
/// exported background tile, its road tile, the chapter headings, then the
/// nodes, with the progress trail (#136) drawn over the roads. Everything
/// sits at its map coordinates through `layout`.
struct MapCanvas: View {
    let layout: MapLayout
    let progress: MapProgress
    /// The node the iPad detail panel shows (#135), ringed.
    var selectedNodeID: Int? = nil
    /// Beside the detail panel, taps select nodes (locked ones too).
    var tapSelects = false
    var onSelectNode: (MapNode) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(GameMap.worlds) { world in
                tile(world.background)
                tile(world.road)
            }
            MapTrailView(
                points: MapTrail.points(for: progress, in: layout), scale: layout.scale, animated: !reduceMotion)
            ForEach(GameMap.worlds) { world in
                ChapterHeading(world: world, scale: layout.scale)
                    .position(layout.point(world.chapterCenter))
            }
            ForEach(GameMap.nodes) { node in
                let state = progress.state(of: node.id)
                MapNodeView(
                    node: node, state: state, isCurrent: progress.current?.id == node.id,
                    isSelected: selectedNodeID == node.id, tapSelects: tapSelects,
                    motion: MapNodeMotion.of(node, in: progress, reduceMotion: reduceMotion), scale: layout.scale
                ) {
                    onSelectNode(node)
                }
                .position(layout.point(node.position.wobbled(for: node)))
            }
        }
        .frame(width: layout.size.width, height: layout.size.height, alignment: .topLeading)
    }

    private func tile(_ tile: MapArtTile) -> some View {
        let frame = layout.frame(tile)
        return Image(tile.name)
            .resizable()
            .frame(width: frame.width, height: frame.height)
            .offset(x: frame.minX, y: frame.minY)
            .accessibilityHidden(true)
    }
}

/// "~ chapter one ~" over the world's name in its crayon color, on a soft
/// cream halo (WorldChapter.jsx).
private struct ChapterHeading: View {
    let world: MapWorld
    let scale: CGFloat

    var body: some View {
        VStack(spacing: 0) {
            Text(world.localizedChapterHeading)
                .font(Typeface.body(fixedSize: 14 * scale))
                .tracking(3 * scale)
                .foregroundStyle(Palette.pencil.opacity(0.85))
            Text(world.localizedName)
                .font(Typeface.display(fixedSize: 28 * scale))
                .foregroundStyle(Color(hex: world.chapterColor))
        }
        .fixedSize()
        .background {
            // Sized, as on the web, to just contain the name so it never
            // reaches the neighbouring node labels.
            Ellipse()
                .fill(Palette.paper.opacity(0.88))
                .frame(width: (Double(world.name.count) * 5.5 + 6) * 2 * scale, height: 44 * scale)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A crayon-circle medallion (BRAND.md "Map nodes", PaperNode.jsx): faded
/// kraft while locked, sage (rose for a boss) while available, mustard
/// (lavender for a boss) with a ✓ stamp once won, and the dashed rose ring and
/// "you →" note on the node to play next. That node hops and its ring
/// pulses, and the boss ahead idles (`motion`, #136) while on screen.
struct MapNodeView: View {
    let node: MapNode
    let state: MapNodeState
    let isCurrent: Bool
    /// Shown in the iPad detail panel: a solid charcoal ring.
    var isSelected = false
    /// Beside the detail panel a tap selects the node rather than playing it,
    /// so a locked node is a button too (the panel says how to unlock it).
    var tapSelects = false
    var motion: MapNodeMotion = []
    let scale: CGFloat
    var action: () -> Void

    /// Scrolled out of view, a node's loops stop.
    @State private var onScreen = true
    private var activeMotion: MapNodeMotion { onScreen ? motion : [] }

    private var locked: Bool { state == .locked }
    private var won: Bool { state == .won }
    /// The web's r = 25, or 36 for a boss, in map units.
    private var radius: CGFloat { (node.isBoss ? 36 : 25) * scale }

    private var fill: Color {
        switch (state, node.isBoss) {
        case (.locked, _): Palette.paperRule
        case (.won, true): Palette.lavender
        case (.won, false): Palette.mustard
        case (.available, true): Palette.rose
        case (.available, false): Palette.sage
        }
    }

    var body: some View {
        Button(action: action) {
            medallion
                .overlay(alignment: .bottom) {
                    // Hangs below the medallion, so `.position` centers the
                    // medallion itself on the node's point, as on the web.
                    Text(node.localizedLabel)
                        .font(Typeface.display(fixedSize: (node.isBoss ? 16 : 14) * scale))
                        .foregroundStyle(Palette.charcoal.opacity(locked ? 0.55 : 1))
                        .fixedSize()
                        .padding(.horizontal, 4 * scale)
                        .background(Capsule().fill(Palette.paper.opacity(0.85)))
                        .alignmentGuide(.bottom) { $0[.top] - 4 * scale }
                }
                .mapBob(activeMotion.contains(.bob), scale: scale)
        }
        .buttonStyle(.plain)
        .trackingScrollVisibility(!motion.isEmpty) { onScreen = $0 }
        .accessibilityElement(children: .ignore)
        // On the iPhone map a locked node does nothing when tapped; it isn't
        // a button.
        .accessibilityRemoveTraits(locked && !tapSelects ? .isButton : [])
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityLabel(Text(node.localizedLabel))
        .accessibilityValue(accessibilityValue)
        .accessibilityHint(accessibilityHint)
        .accessibilityIdentifier("map.node.\(node.id)")
    }

    private var tilt: Double { (MapWobble.seeded(Double(node.id) * 13) - 0.5) * 5 }

    private var medallion: some View {
        ZStack {
            if isSelected {
                Circle()
                    .strokeBorder(Palette.charcoal, lineWidth: 3)
                    .frame(width: (radius + 15 * scale) * 2, height: (radius + 15 * scale) * 2)
            }
            if isCurrent {
                Circle()
                    .strokeBorder(Palette.rose.opacity(0.85), style: StrokeStyle(lineWidth: 2, dash: [3, 4]))
                    .frame(width: (radius + 9 * scale) * 2, height: (radius + 9 * scale) * 2)
                    .rotationEffect(.degrees(tilt))
                    .mapPulse(activeMotion.contains(.pulse))
            }
            // Paper backing, so the road doesn't show through the crayon.
            Circle()
                .fill(Palette.paper)
                .frame(width: radius * 2 + 2, height: radius * 2 + 2)
            Circle()
                .fill(Palette.charcoal.opacity(locked ? 0.08 : 0.15))
                .frame(width: radius * 2, height: radius * 2)
                .offset(x: 2 * scale, y: 3 * scale)
            Circle()
                .fill(fill.opacity(locked ? 0.55 : 0.95))
                .frame(width: radius * 2, height: radius * 2)
            Circle()
                .strokeBorder(Palette.charcoal.opacity(locked ? 0.45 : 0.95), lineWidth: 2)
                .frame(width: radius * 2, height: radius * 2)
            Ellipse()
                .fill(Color(hex: 0xFFF8E2).opacity(locked ? 0.1 : 0.28))
                .frame(width: radius * 0.9, height: radius * 0.36)
                .rotationEffect(.degrees(tilt - 18))
                .offset(x: -radius * 0.32, y: -radius * 0.4)
            icon
            if won {
                Text(verbatim: "✓")
                    .font(Typeface.display(fixedSize: 14 * scale))
                    .foregroundStyle(Palette.charcoal)
                    .frame(width: 22 * scale, height: 22 * scale)
                    .background(Circle().fill(Palette.mustard.opacity(0.95)))
                    .overlay(Circle().strokeBorder(Palette.charcoal, lineWidth: 1.4))
                    .rotationEffect(.degrees(tilt - 12))
                    .offset(x: radius * 0.78, y: -radius * 0.78)
            }
        }
        .frame(width: radius * 2, height: radius * 2)
        .overlay(alignment: .leading) {
            if isCurrent {
                Text("you →")
                    .font(Typeface.display(fixedSize: 18 * scale))
                    .foregroundStyle(Palette.roseInk)
                    .fixedSize()
                    .rotationEffect(.degrees(-6))
                    .alignmentGuide(.leading) { $0[.trailing] + 14 * scale }
                    .accessibilityHidden(true)
            }
        }
    }

    @ViewBuilder private var icon: some View {
        if let art = node.bossArt {
            // The art is drawn for this medallion: 72 × 72 at r = 36.
            Image(art)
                .resizable()
                .frame(width: radius * 2, height: radius * 2)
                .opacity(locked ? 0.4 : 1)
                .mapBossIdle(activeMotion.contains(.bossIdle))
        } else {
            Text(verbatim: node.icon)
                .font(.system(size: (node.isBoss ? 26 : 18) * scale))
                .opacity(locked ? 0.3 : 1)
                .mapBossIdle(activeMotion.contains(.bossIdle))
        }
    }

    private var accessibilityValue: Text {
        switch state {
        case .locked: Text("locked")
        case .available: Text("not won yet")
        case .won: Text("won")
        }
    }

    private var accessibilityHint: Text {
        if tapSelects { return Text("Shows it in the panel.") }
        return switch (state, node.isBoss) {
        case (.locked, _): Text("Win the nodes before it to unlock it.")
        case (_, true): Text("Starts a boss battle.")
        case (_, false): Text("Starts a battle.")
        }
    }
}

private extension View {
    /// Reports whether the view is on screen, only for the few nodes that
    /// animate, so the other 40 don't pay for visibility tracking.
    @ViewBuilder func trackingScrollVisibility(_ enabled: Bool, _ action: @escaping (Bool) -> Void) -> some View {
        if enabled {
            onScrollVisibilityChange(threshold: 0.01, action)
        } else {
            self
        }
    }
}

/// PaperNode.jsx's small deterministic wobble, so nodes don't sit on a
/// perfect grid.
enum MapWobble {
    /// `seeded` in src/components/map-paper/paperUtils.js.
    static func seeded(_ seed: Double) -> Double {
        let x = sin(seed * 9973.137) * 43758.5453
        return x - x.rounded(.down)
    }
}

private extension MapPoint {
    func wobbled(for node: MapNode) -> MapPoint {
        MapPoint(
            x: x + (MapWobble.seeded(Double(node.id) * 7) - 0.5) * 3,
            y: y + (MapWobble.seeded(Double(node.id) * 11 + 1) - 0.5) * 3)
    }
}
