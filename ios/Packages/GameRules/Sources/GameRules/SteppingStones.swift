// Stepping Stones — skip counting across a stream. The Swift port of
// src/rules/steppingStones.js, pinned by golden/stepping-stones.json.
//
// The otter crosses `numStones` rocks; hop i (1-based) asks for baseNumber × i,
// offered among `choicesPerHop` lily pads, and a wrong pad sends the run back to
// the start. Both are tunables from the `stepping_stones` section of
// GET /api/rule-settings.
//
// Draw order (copied from the JavaScript module header): generateHops draws hop
// by hop, i = 1 … numStones, and for each hop
//   1. shuffles its distractor pool (built in candidate order) — pool.count - 1
//      draws — and keeps the first choicesPerHop - 1;
//   2. shuffles [correct, ...kept distractors] — choicesPerHop - 1 draws for a
//      full set (one fewer per missing distractor).
// Every shuffle is Fisher–Yates from the end: j = floor(rng() * (i + 1)) for
// i = count - 1 down to 1. buildPath draws nothing.
//
// Pad placement around the target rock, animation timings and the run timer
// are the screen's (the web's SteppingStones.jsx); `SteppingStonesCrossing`
// is the part of that component's state that is a rule: where the otter is,
// and what a tap does.

/// The Stepping Stones tunables, decoded straight from the `stepping_stones`
/// section of GET /api/rule-settings (snake-case keys, the served types) —
/// `DEFAULT_STEPPING_STONES_SETTINGS` in src/data/ruleSettings.js.
public struct SteppingStonesSettings: Sendable, Equatable, Decodable {
    /// Rocks in a crossing.
    public var numStones: Int
    /// Lily pads offered per hop, the right one included.
    public var choicesPerHop: Int

    enum CodingKeys: String, CodingKey {
        case numStones = "num_stones"
        case choicesPerHop = "choices_per_hop"
    }

    public init(numStones: Int, choicesPerHop: Int) {
        self.numStones = numStones
        self.choicesPerHop = choicesPerHop
    }

    /// The fallback until the server's settings arrive. Must equal the web's
    /// DEFAULT_STEPPING_STONES_SETTINGS (and so the server's served values).
    public static let defaults = SteppingStonesSettings(numStones: 10, choicesPerHop: 4)

    /// Served values checked like the web's steppingStonesSettingsFromServer:
    /// a value out of range falls back to its default.
    public static func served(numStones: Int, choicesPerHop: Int) -> SteppingStonesSettings {
        SteppingStonesSettings(
            numStones: numStones >= 1 ? numStones : defaults.numStones,
            // At least the right answer and one distractor.
            choicesPerHop: choicesPerHop >= 2 ? choicesPerHop : defaults.choicesPerHop)
    }
}

/// One lily pad: the number on it, and whether it's the next multiple.
public struct SteppingStoneChoice: Sendable, Hashable, Decodable {
    public let value: Int
    public let isCorrect: Bool

    public init(value: Int, isCorrect: Bool) {
        self.value = value
        self.isCorrect = isCorrect
    }
}

/// One rock of a crossing: its multiple and the pads offered for it, in the
/// order they're laid out.
public struct SteppingStoneHop: Sendable, Hashable, Decodable {
    public let target: Int
    public let choices: [SteppingStoneChoice]

    public init(target: Int, choices: [SteppingStoneChoice]) {
        self.target = target
        self.choices = choices
    }
}

/// A rock's position as percentages of the stream (x across, y down).
public struct StonePosition: Sendable, Hashable, Decodable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public enum SteppingStones {
    /// Fisher–Yates from the end, one draw per step.
    public static func shuffle<T>(_ items: [T], rng: inout some RandomSource) -> [T] {
        var a = items
        var i = a.count - 1
        while i > 0 {
            let j = Int((rng.next() * Double(i + 1)).rounded(.down))
            a.swapAt(i, j)
            i -= 1
        }
        return a
    }

    /// A zig-zag path of `n` stones drifting from the left bank toward the
    /// right as it descends the vertical stream.
    public static func buildPath(_ n: Int = SteppingStonesSettings.defaults.numStones) -> [StonePosition] {
        (0..<max(0, n)).map { i in
            let t = n == 1 ? 0.5 : Double(i) / Double(n - 1)
            let xBase = 22 + t * 56
            let zig = Double(i % 2 == 0 ? -1 : 1) * 8
            return StonePosition(x: clamp(xBase + zig, 16, 84), y: clamp(10 + t * 78, 8, 90))
        }
    }

    /// The distractor candidates for hop `i`, in pool order: off-by-one/two
    /// slips and the "over-skip" to the multiple after the target. Non-positive
    /// values, the answer, earlier multiples and repeats are dropped.
    public static func distractorPool(baseNumber: Int, hop i: Int) -> [Int] {
        let target = baseNumber * i
        let previous = Set((0..<max(0, i - 1)).map { baseNumber * ($0 + 1) })
        let candidates = [
            target + 1,
            target - 1,
            target + 2,
            target - 2,
            target + baseNumber,
            target + baseNumber + 1,
        ]
        var pool: [Int] = []
        for c in candidates where c > 0 && c != target && !previous.contains(c) && !pool.contains(c) {
            pool.append(c)
        }
        return pool
    }

    /// A whole crossing: each hop offers the next multiple among distractors.
    public static func generateHops(
        baseNumber: Int, settings: SteppingStonesSettings = .defaults, rng: inout some RandomSource
    ) -> [SteppingStoneHop] {
        guard settings.numStones >= 1 else { return [] }
        return (1...settings.numStones).map { i in
            let target = baseNumber * i
            let distractors = shuffle(distractorPool(baseNumber: baseNumber, hop: i), rng: &rng)
                .prefix(max(0, settings.choicesPerHop - 1))
            let choices = shuffle(
                [SteppingStoneChoice(value: target, isCorrect: true)]
                    + distractors.map { SteppingStoneChoice(value: $0, isCorrect: false) },
                rng: &rng)
            return SteppingStoneHop(target: target, choices: choices)
        }
    }

    private static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
        max(lo, min(hi, v))
    }
}

/// Where a crossing stands: how many rocks the otter has landed on, and what a
/// tap on a pad does. A wrong pad sends the run back to the near bank (a
/// restart), a right one lands the otter; the last rock wins the crossing.
public struct SteppingStonesCrossing: Sendable, Equatable {
    public enum Tap: Sendable, Equatable {
        /// Landed on rock `index` (0-based); `won` when it was the last.
        case landed(index: Int, won: Bool)
        /// The otter fell in; the run starts again from the near bank.
        case fell
        /// The crossing is already over, or there's no such pad.
        case ignored
    }

    public let baseNumber: Int
    public let hops: [SteppingStoneHop]
    /// Rocks landed on so far; also the index of the rock being asked for.
    public private(set) var landed = 0
    /// Times the otter fell in and started over.
    public private(set) var restarts = 0
    /// Right pads in a row since the last fall.
    public private(set) var streak = 0

    public init(baseNumber: Int, hops: [SteppingStoneHop]) {
        self.baseNumber = baseNumber
        self.hops = hops
    }

    /// Deals a fresh crossing.
    public init(baseNumber: Int, settings: SteppingStonesSettings = .defaults, rng: inout some RandomSource) {
        self.init(baseNumber: baseNumber, hops: SteppingStones.generateHops(
            baseNumber: baseNumber, settings: settings, rng: &rng))
    }

    public var won: Bool { !hops.isEmpty && landed == hops.count }

    /// The hop being asked for, nil once the crossing is won.
    public var currentHop: SteppingStoneHop? { landed < hops.count ? hops[landed] : nil }

    /// Taps pad `choice` of the current hop.
    public mutating func tap(_ choice: Int) -> Tap {
        guard let hop = currentHop, hop.choices.indices.contains(choice) else { return .ignored }
        if hop.choices[choice].isCorrect {
            landed += 1
            streak += 1
            return .landed(index: landed - 1, won: won)
        }
        landed = 0
        streak = 0
        restarts += 1
        return .fell
    }
}
