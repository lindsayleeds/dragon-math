// Battle problem and grid generation — the Swift port of the generation half of
// src/data/battleData.js. golden/battle-problems.json is the check;
// BattleProblemsTests reads it.
//
// Draw order is part of the rule, and matches the JavaScript exactly. Every
// draw is one `rng.next()`; an integer in [lo, hi] is
// `floor(next() * (hi - lo + 1)) + lo`.
//
//   generateProblem:  op = ops[floor(next() * ops.count)], then
//     add, mul:  a in [min, max], b in [min, max]
//     sub:       a in [min, max], b in [min, a]            (never negative)
//     div:       divisor b, then quotient (the answer), both in
//                [max(2, min), max(max(2, min), max)]; a = b * answer
//   buildGrid / buildGrid(layout:):  the answer goes first, then one draw per
//     distractor candidate in [0, distractorMax], redrawn when it equals the
//     answer, until there is one value per cell; then a Fisher–Yates shuffle
//     from the last index down (j = floor(next() * (i + 1))).
//     distractorMax is max² when `mul` is among the ops, otherwise 2 · max.
//
// A battle round deals from ONE generator: generateProblem, then buildGrid.

/// An arithmetic operation a battle can ask about. Raw values are the ids the
/// server's node config and the web use.
public enum BattleOp: String, Sendable, CaseIterable, Codable {
    case add, sub, mul, div

    /// The symbol shown in a problem's text (true minus/times/divide signs,
    /// not ASCII) — `OP_SYMBOL` / `OP_LABEL` on the web.
    public var symbol: String {
        switch self {
        case .add: "+"
        case .sub: "−"
        case .mul: "×"
        case .div: "÷"
        }
    }
}

/// What a battle node asks: which operations, over what operand range, and how
/// fast the opponent answers. The Swift form of the web's
/// `{ ops, range: [min, max], aiSeconds, shapeId }`.
public struct BattleConfig: Sendable, Equatable {
    /// Allowed operations; one is picked per problem. Must not be empty.
    public var ops: [BattleOp]
    /// Operand range, `range[0]` and `range[1]` on the web. Kept as two
    /// numbers rather than a `ClosedRange` because generation reads them as-is
    /// (division lifts `min` to 2) and a server row is not guaranteed ordered.
    public var min: Int
    public var max: Int
    /// Approximate seconds per opponent correct answer (lower is harder).
    public var aiSeconds: Double
    /// Id of the battle-grid shape in `BattleShape.all`; nil falls back to the
    /// world layout.
    public var shapeId: String?

    public init(ops: [BattleOp], min: Int, max: Int, aiSeconds: Double, shapeId: String? = nil) {
        self.ops = ops
        self.min = min
        self.max = max
        self.aiSeconds = aiSeconds
        self.shapeId = shapeId
    }

    /// Upper bound for distractor values: max² with multiplication in play
    /// (products get large), otherwise 2 · max.
    public var distractorMax: Int {
        ops.contains(.mul) ? max * max : max * 2
    }
}

/// One question: `a op b = answer`.
public struct Problem: Sendable, Equatable {
    public var a: Int
    public var b: Int
    public var op: BattleOp
    public var answer: Int

    public init(a: Int, b: Int, op: BattleOp, answer: Int) {
        self.a = a
        self.b = b
        self.op = op
        self.answer = answer
    }

    /// As shown to the player, e.g. "12 ÷ 3".
    public var text: String { "\(a) \(op.symbol) \(b)" }
}

/// Problems a player must answer to win a battle.
public let problemsToWin = 10

/// Side of the square grid `buildGrid(answer:config:gridSize:rng:)` makes by default.
public let defaultGridSize = 6

/// `Math.floor(rng() * (max - min + 1)) + min`.
private func randInt(_ min: Int, _ max: Int, _ rng: inout some RandomSource) -> Int {
    Int((rng.next() * Double(max - min + 1)).rounded(.down)) + min
}

private func pick<T>(_ items: [T], _ rng: inout some RandomSource) -> T {
    items[Int((rng.next() * Double(items.count)).rounded(.down))]
}

/// One problem for this node. Draws as the header describes.
public func generateProblem(_ config: BattleConfig, rng: inout some RandomSource) -> Problem {
    precondition(!config.ops.isEmpty, "BattleConfig.ops must not be empty")
    let op = pick(config.ops, &rng)
    let (min, max) = (config.min, config.max)
    switch op {
    case .add:
        let a = randInt(min, max, &rng)
        let b = randInt(min, max, &rng)
        return Problem(a: a, b: b, op: op, answer: a + b)
    case .sub:
        let a = randInt(min, max, &rng)
        let b = randInt(min, a, &rng)
        return Problem(a: a, b: b, op: op, answer: a - b)
    case .mul:
        let a = randInt(min, max, &rng)
        let b = randInt(min, max, &rng)
        return Problem(a: a, b: b, op: op, answer: a * b)
    case .div:
        // Whole-number division: pick divisor and quotient, show dividend ÷ divisor.
        let divMin = Swift.max(2, min)
        let divMax = Swift.max(divMin, max)
        let b = randInt(divMin, divMax, &rng)
        let answer = randInt(divMin, divMax, &rng)
        return Problem(a: b * answer, b: b, op: op, answer: answer)
    }
}

/// `count` values: the answer exactly once plus distractors in
/// [0, distractorMax], shuffled. Shared by both grid builders.
private func gridValues(answer: Int, config: BattleConfig, count: Int, rng: inout some RandomSource) -> [Int] {
    let distractorMax = config.distractorMax
    var values = [answer]
    while values.count < count {
        let candidate = randInt(0, distractorMax, &rng)
        if candidate != answer { values.append(candidate) }
    }
    var i = values.count - 1
    while i > 0 {
        let j = Int((rng.next() * Double(i + 1)).rounded(.down))
        values.swapAt(i, j)
        i -= 1
    }
    return values
}

/// A `gridSize` × `gridSize` grid, row-major, containing the answer exactly
/// once — `buildGrid` on the web.
public func buildGrid(
    answer: Int, config: BattleConfig, gridSize: Int = defaultGridSize, rng: inout some RandomSource
) -> [Int] {
    gridValues(answer: answer, config: config, count: gridSize * gridSize, rng: &rng)
}

/// A grid shaped like `layout`: parallel to `layout.cells`, a number for each
/// active cell (the answer exactly once) and nil for each spacer —
/// `buildGridFromLayout` on the web, and what a battle round deals.
public func buildGrid(
    answer: Int, config: BattleConfig, layout: BattleLayout, rng: inout some RandomSource
) -> [Int?] {
    var values = gridValues(answer: answer, config: config, count: layout.activeCount, rng: &rng)
        .makeIterator()
    return layout.cells.map { $0 ? values.next() : nil }
}
