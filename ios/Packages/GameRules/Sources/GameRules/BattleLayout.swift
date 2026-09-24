// Battle-grid layouts — the Swift port of the layout half of
// src/data/battleData.js. A layout is ASCII art: 'X' is an active cell (shows a
// number), anything else ('.') an invisible spacer. Per-node layouts come from
// the shape library (`BattleShape.all`, generated from src/data/battleShapes.js
// by scripts/generate-swift-battle-shapes.mjs) via the node's `shapeId`; the
// per-world layouts below are the fallback for a node without one (while
// config is loading, or the Dragon's Trial).

/// A parsed layout: `cols` × `rows` positions, row-major.
public struct BattleLayout: Sendable, Equatable {
    public var cols: Int
    public var rows: Int
    /// One entry per position, row-major; true when the position shows a number.
    public var cells: [Bool]

    public init(cols: Int, rows: Int, cells: [Bool]) {
        self.cols = cols
        self.rows = rows
        self.cells = cells
    }

    /// Parses layout art — `parseBattleLayout` on the web. Empty lines are
    /// dropped; the widest line sets `cols`, and shorter lines are padded with
    /// spacers.
    public init(art: String) {
        let lines = art.split(separator: "\n", omittingEmptySubsequences: true).map(Array.init)
        let cols = lines.map(\.count).max() ?? 0
        var cells: [Bool] = []
        cells.reserveCapacity(cols * lines.count)
        for line in lines {
            for c in 0..<cols {
                cells.append(c < line.count && line[c] == "X")
            }
        }
        self.init(cols: cols, rows: lines.count, cells: cells)
    }

    /// Number of active (numbered) cells.
    public var activeCount: Int { cells.reduce(0) { $0 + ($1 ? 1 : 0) } }

    /// The legacy per-world layout art, keyed by world id.
    static let worldArt: [Int: String] = [
        // World 1 — Mushroom Forest: diamond
        1: """
        ..X..
        .XXX.
        XXXXX
        .XXX.
        ..X..
        """,
        // World 2 — Honeyfield Plains: wide Z
        2: """
        XXXXX
        ...XX
        ..X..
        XX...
        XXXXX
        """,
        // World 3 — Crystal Caves: hexagon
        3: """
        .XXX.
        XXXXX
        XXXXX
        .XXX.
        """,
        // World 4 — Sakura Vale: starburst / flower corners
        4: """
        X.X.X
        .XXX.
        XXXXX
        .XXX.
        X.X.X
        """,
        // World 5 — Cloudspire Heights: staircase
        5: """
        XXX...
        .XXX..
        ..XXX.
        ...XXX
        """,
    ]

    /// The legacy layout for a world, or world 1's for an unknown world —
    /// `getBattleLayout` on the web.
    public static func world(_ worldId: Int) -> BattleLayout {
        BattleLayout(art: worldArt[worldId] ?? worldArt[1]!)
    }

    /// The layout for a shape id, falling back to the world layout (then world
    /// 1) when the id is nil or not in the library — `getLayoutForShape`.
    public static func forShape(_ shapeId: String?, fallbackWorldId: Int = 1) -> BattleLayout {
        guard let shapeId, let shape = BattleShape.named(shapeId) else {
            return world(fallbackWorldId)
        }
        return shape.layout
    }

    /// The layout a battle for this config is played on.
    public static func forConfig(_ config: BattleConfig, fallbackWorldId: Int = 1) -> BattleLayout {
        forShape(config.shapeId, fallbackWorldId: fallbackWorldId)
    }
}

/// A named entry in the battle-grid shape library. `cells`, `width` and
/// `height` are the library's own metadata (active cells and art size), kept
/// for pickers and lists; generation uses only `art`.
public struct BattleShape: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var cells: Int
    public var width: Int
    public var height: Int
    public var art: String

    public init(id: String, name: String, cells: Int, width: Int, height: Int, art: String) {
        self.id = id
        self.name = name
        self.cells = cells
        self.width = width
        self.height = height
        self.art = art
    }

    public var layout: BattleLayout { BattleLayout(art: art) }

    private static let byId: [String: BattleShape] =
        Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })

    /// The library shape with this id, if any.
    public static func named(_ id: String) -> BattleShape? { byId[id] }
}
