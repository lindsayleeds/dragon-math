// The dragon world map: its worlds, nodes and art tiles (the data is
// generated into MapNodes.swift from src/data/mapData.js), and which nodes a
// player may play given their progress — `deriveNodeState` in
// src/utils/nodeHelpers.js.
//
// Coordinates are the web map's SVG space: 400 wide, y growing downward, the
// journey starting at the bottom (node 1) and climbing to the final boss.

/// A point in map coordinates.
public struct MapPoint: Sendable, Equatable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public enum MapNodeKind: String, Sendable, Equatable {
    case regular
    case boss
}

/// One stop on the road (`MAP_NODES`).
public struct MapNode: Sendable, Equatable, Identifiable {
    public let id: Int
    public let kind: MapNodeKind
    /// English source text; the app looks it up in its String Catalog.
    public let label: String
    /// The emoji drawn in a regular node's medallion (and a boss's, if it has
    /// no art).
    public let icon: String
    public let position: MapPoint
    public let worldID: Int
    /// The boss's vector imageset (`Boss…` in ios/ArtExports), if it has one.
    public let bossArt: String?

    public init(
        id: Int, kind: MapNodeKind, label: String, icon: String, position: MapPoint, worldID: Int,
        bossArt: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.label = label
        self.icon = icon
        self.position = position
        self.worldID = worldID
        self.bossArt = bossArt
    }

    public var isBoss: Bool { kind == .boss }

    /// The built-in battle for this node (the server's node config, once
    /// synced, overrides it).
    public var battleConfig: BattleConfig { .defaultConfig(forNode: id) }

    /// The grid this node's battle is played on.
    public var battleLayout: BattleLayout { .forConfig(battleConfig, fallbackWorldId: worldID) }
}

/// A vector imageset covering part of the map, full width: `name` is the
/// asset, `top` its top edge in map coordinates.
public struct MapArtTile: Sendable, Equatable {
    public let name: String
    public let top: Double
    public let height: Double

    public init(name: String, top: Double, height: Double) {
        self.name = name
        self.top = top
        self.height = height
    }
}

/// A chapter of the map (`WORLDS`).
public struct MapWorld: Sendable, Equatable, Identifiable {
    public let id: Int
    /// English source text, e.g. "Mushroom Forest".
    public let name: String
    /// English source text, e.g. "~ chapter one ~".
    public let chapterHeading: String
    public let nodeIDs: ClosedRange<Int>
    /// Where the chapter heading is centered: `chapterX`, and the middle of
    /// the web's two text lines (`chapterY - 14`).
    public let chapterCenter: MapPoint
    /// The world name's crayon color, 0xRRGGBB.
    public let chapterColor: UInt32
    /// The y-range the world's band covers.
    public let bandTop: Double
    public let bandBottom: Double
    /// The watercolor, wallpaper, dot grid and torn edge for this band.
    public let background: MapArtTile
    /// The pencil road through this band, drawn over the background.
    public let road: MapArtTile

    public init(
        id: Int, name: String, chapterHeading: String, nodeIDs: ClosedRange<Int>, chapterCenter: MapPoint,
        chapterColor: UInt32, bandTop: Double, bandBottom: Double, background: MapArtTile, road: MapArtTile
    ) {
        self.id = id
        self.name = name
        self.chapterHeading = chapterHeading
        self.nodeIDs = nodeIDs
        self.chapterCenter = chapterCenter
        self.chapterColor = chapterColor
        self.bandTop = bandTop
        self.bandBottom = bandBottom
        self.background = background
        self.road = road
    }
}

/// The whole map as the app shows it. `worlds`, `nodes` and `width` are
/// generated (MapNodes.swift).
public enum GameMap {
    /// The part of the map the worlds cover: from the top of the last world's
    /// band to the bottom of the first's.
    public static var top: Double { worlds.map(\.bandTop).min() ?? 0 }
    public static var bottom: Double { worlds.map(\.bandBottom).max() ?? 0 }
    public static var height: Double { bottom - top }

    public static func node(_ id: Int) -> MapNode? {
        nodes.first { $0.id == id }
    }

    public static func world(_ id: Int) -> MapWorld? {
        worlds.first { $0.id == id }
    }

    /// The world a node belongs to (`worldForNode`).
    public static func world(forNode nodeID: Int) -> MapWorld? {
        worlds.first { $0.nodeIDs.contains(nodeID) }
    }

    public static func nodes(in world: MapWorld) -> [MapNode] {
        nodes.filter { world.nodeIDs.contains($0.id) }
    }
}

/// What a node looks like and whether it can be played.
public enum MapNodeState: String, Sendable, Equatable {
    /// Beyond the frontier: shown faded, can't be played yet.
    case locked
    /// The frontier: the next battle, marked "you →".
    case available
    /// Won, or passed over (the frontier is past it, e.g. placed there by the
    /// Dragon's Trial); can be replayed.
    case won

    public var isPlayable: Bool { self != .locked }
}

/// A player's place on the map: the nodes they've won and their frontier,
/// the furthest node unlocked (the Store's `ProfileProgress`).
public struct MapProgress: Sendable, Equatable {
    public var nodesWon: Set<Int>
    public var frontier: Int

    public init(nodesWon: Set<Int> = [], frontier: Int = 1) {
        self.nodesWon = nodesWon
        self.frontier = frontier
    }

    /// `deriveNodeState`: won if won, else available at the frontier, won
    /// before it and locked after it.
    public func state(of nodeID: Int) -> MapNodeState {
        if nodesWon.contains(nodeID) { return .won }
        if nodeID == frontier { return .available }
        if nodeID < frontier { return .won }
        return .locked
    }

    public func canPlay(_ nodeID: Int) -> Bool {
        state(of: nodeID).isPlayable
    }

    /// The node the "you →" note points at: the frontier while it's a node on
    /// the map that hasn't been won; nil once every node is behind the player.
    public var current: MapNode? {
        guard state(of: frontier) == .available else { return nil }
        return GameMap.node(frontier)
    }

    /// The node the map scrolls to when it opens: the current node, or the
    /// last one once the whole map is won.
    public var focus: MapNode? {
        current ?? GameMap.nodes.last
    }

    /// How many of the map's nodes are won (the web's "n / 41 quests").
    public var wonCount: Int {
        GameMap.nodes.filter { state(of: $0.id) == .won }.count
    }
}
