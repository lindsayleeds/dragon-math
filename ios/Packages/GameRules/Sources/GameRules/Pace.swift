// The game pace — the Swift port of src/rules/pace.js. A per-child parent
// setting (server users.game_pace) that slows down or turns off the clocks a
// child races against, fixed for a game and passed into the battle and
// Munchers reducers:
//
//   normal  the rules as they have always been
//   slow    every race clock runs `GamePace.slowFactor` times slower: the
//           battle opponent's solve delay (base and jitter, not the
//           aiMinDelayMs floor); the Munchers spawn interval, step interval
//           and telegraph. Blanks, flashes, the grid lock and the gobble beat
//           keep their served lengths.
//   off     untimed: the battle opponent never runs (and never draws), and
//           Munchers has no monsters (the spawn and step clocks never arm)
//
// Unknown values read as normal.

/// How fast the clocks a child races against run.
public enum GamePace: String, Sendable, Equatable, CaseIterable {
    case normal
    case slow
    case off

    /// How many times slower the race clocks run at `.slow` (SLOW_PACE_FACTOR).
    public static let slowFactor: Double = 2

    /// A stored or served value; anything unknown is `.normal`.
    public init(normalizing rawValue: String?) {
        self = rawValue.flatMap(GamePace.init(rawValue:)) ?? .normal
    }

    /// The multiplier on the race clocks (1 when untimed: nothing runs).
    public var factor: Double { self == .slow ? GamePace.slowFactor : 1 }

    /// Nothing races the child.
    public var isUntimed: Bool { self == .off }
}
