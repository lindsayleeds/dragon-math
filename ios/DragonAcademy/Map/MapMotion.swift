import GameRules
import SwiftUI

/// Which of the map's looping animations a node runs (#136). Only the node
/// to play next and the boss waiting ahead of it move — never all 41 — and
/// Reduce Motion stills them all.
struct MapNodeMotion: OptionSet, Equatable {
    let rawValue: Int

    /// The web's `paperHop`: a gentle hop on the node to play next.
    static let bob = MapNodeMotion(rawValue: 1 << 0)
    /// The web's `pulseRing`: its dashed rose ring swells and fades.
    static let pulse = MapNodeMotion(rawValue: 1 << 1)
    /// The boss the player is heading for breathes and sways.
    static let bossIdle = MapNodeMotion(rawValue: 1 << 2)

    /// What `node` does on a map showing `progress`.
    static func of(_ node: MapNode, in progress: MapProgress, reduceMotion: Bool) -> MapNodeMotion {
        guard !reduceMotion else { return [] }
        var motion: MapNodeMotion = []
        if progress.current?.id == node.id { motion.formUnion([.bob, .pulse]) }
        if node.id == progress.nextBoss?.id { motion.insert(.bossIdle) }
        return motion
    }
}

/// Timings from MapPagePaper.module.css, in the web's map units.
enum MapMotionTiming {
    /// `paperHop 1.4s ease-in-out infinite`: up 2.5px and back.
    static let bobCycle = 1.4
    static let bobHeight: CGFloat = 2.5
    /// `pulseRing 1.8s ease-in-out infinite`: opacity 0.85 → 0.4, scale → 1.12.
    static let pulseCycle = 1.8
    static let pulseScale: CGFloat = 1.12
    static let pulseDimmedOpacity = 0.4 / 0.85
    /// The boss's idle breath: slower than the node's hop so it reads as a
    /// big creature at rest.
    static let bossIdleCycle = 3.2
    static let bossIdleScale: CGFloat = 1.05
    static let bossIdleSway = 2.5
    /// The trail drawing its newest leg when the frontier moves on.
    static let trailDraw = 0.9
}

extension MapProgress {
    /// The first boss not yet won at or beyond the frontier: the one the
    /// player is heading for.
    var nextBoss: MapNode? {
        GameMap.nodes.first { $0.isBoss && $0.id >= frontier && state(of: $0.id) != .won }
    }
}

/// The progress trail over the road: the road's own curve (`buildPath` in
/// src/data/mapData.js) from the first node up to the frontier.
enum MapTrail {
    /// The nodes the trail passes through, in order: node 1 up to the
    /// frontier (every node once the whole map is behind the player).
    static func nodes(for progress: MapProgress) -> [MapNode] {
        GameMap.nodes.filter { $0.id <= progress.frontier }.sorted { $0.id < $1.id }
    }

    /// The trail's points on screen, one per node, at the road's (unwobbled)
    /// node positions.
    static func points(for progress: MapProgress, in layout: MapLayout) -> [CGPoint] {
        nodes(for: progress).map { layout.point($0.position) }
    }

    /// The road's curve through `points`: each leg a cubic whose controls sit
    /// 45% and 55% of the way along in y, above each end.
    static func path(through points: ArraySlice<CGPoint>) -> Path {
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first)
        for (a, b) in zip(points, points.dropFirst()) {
            let dy = b.y - a.y
            path.addCurve(
                to: b,
                control1: CGPoint(x: a.x, y: a.y + dy * 0.45),
                control2: CGPoint(x: b.x, y: a.y + dy * 0.55))
        }
        return path
    }
}

/// The trail drawn in crayon over the pencil road. When the frontier moves
/// on, the newest leg draws itself in (unless Reduce Motion is on).
struct MapTrailView: View {
    let points: [CGPoint]
    let scale: CGFloat
    let animated: Bool

    /// How much of the newest leg is drawn.
    @State private var lead: CGFloat = 1

    var body: some View {
        ZStack {
            stroke(MapTrail.path(through: points.dropLast()))
            stroke(MapTrail.path(through: points.suffix(2)).trimmedPath(from: 0, to: lead))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: points.count) { old, new in
            guard animated, new > old else { return }
            lead = 0
            Task { @MainActor in
                withAnimation(.easeOut(duration: MapMotionTiming.trailDraw)) { lead = 1 }
            }
        }
    }

    /// A waxy mustard crayon swipe with a darker core, so the pencil dashes
    /// still show through.
    private func stroke(_ path: Path) -> some View {
        ZStack {
            path.stroke(
                Palette.mustard.opacity(0.45),
                style: StrokeStyle(lineWidth: 10 * scale, lineCap: .round, lineJoin: .round))
            path.stroke(
                Palette.mustard.opacity(0.9),
                style: StrokeStyle(lineWidth: 3 * scale, lineCap: .round, lineJoin: .round))
        }
    }
}

extension View {
    /// The node's hop, while `active`.
    @ViewBuilder func mapBob(_ active: Bool, scale: CGFloat) -> some View {
        if active {
            phaseAnimator([false, true]) { view, up in
                view.offset(y: up ? -MapMotionTiming.bobHeight * scale : 0)
            } animation: { _ in
                .easeInOut(duration: MapMotionTiming.bobCycle / 2)
            }
        } else {
            self
        }
    }

    /// The current node's ring swelling and fading, while `active`.
    @ViewBuilder func mapPulse(_ active: Bool) -> some View {
        if active {
            phaseAnimator([false, true]) { view, out in
                view
                    .scaleEffect(out ? MapMotionTiming.pulseScale : 1)
                    .opacity(out ? MapMotionTiming.pulseDimmedOpacity : 1)
            } animation: { _ in
                .easeInOut(duration: MapMotionTiming.pulseCycle / 2)
            }
        } else {
            self
        }
    }

    /// A boss breathing in and swaying at rest, while `active`.
    @ViewBuilder func mapBossIdle(_ active: Bool) -> some View {
        if active {
            phaseAnimator(BossIdlePhase.allCases) { view, phase in
                view
                    .scaleEffect(phase.sway == 0 ? 1 : MapMotionTiming.bossIdleScale, anchor: .bottom)
                    .rotationEffect(.degrees(phase.sway * MapMotionTiming.bossIdleSway), anchor: .bottom)
            } animation: { _ in
                .easeInOut(duration: MapMotionTiming.bossIdleCycle / Double(BossIdlePhase.allCases.count))
            }
        } else {
            self
        }
    }
}

/// Rest, breathe in leaning one way, rest, breathe in leaning the other.
private enum BossIdlePhase: CaseIterable {
    case rest, left, rest2, right

    var sway: Double {
        switch self {
        case .rest, .rest2: 0
        case .left: -1
        case .right: 1
        }
    }
}
