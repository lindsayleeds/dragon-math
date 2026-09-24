// The seeded random number generator (SplitMix64) the game rules draw from, so
// a rule run from a fixed seed is repeatable — the Swift port of
// src/rules/seededRandom.js.
//
// Draw-compatibility contract: the JavaScript generator is the reference, and
// this one must match it bit for bit (ADR 0005). Seeded with the same 64-bit
// value, the nth `nextUInt64()` here equals the nth `nextUint64()` there, and
// the nth `next()` equals the nth JS `next()` exactly — same Double, not merely
// close. `next()` is the top 53 bits of one 64-bit output times 2^-53, and each
// call to either method consumes exactly one output, so a rule that draws the
// same way in both languages sees the same numbers. golden/prng.json (written
// by `npm run golden:generate`) is the check; SeededRandomTests reads it.
//
// Rules therefore draw only through `RandomSource.next()`, in the order their
// JS twin documents, and never through the standard library's random APIs
// (`Int.random(in:using:)`, `shuffled(using:)`, …): those turn raw output into
// values with their own algorithms, which JavaScript doesn't reproduce. That's
// also why SeededRandom doesn't conform to RandomNumberGenerator.
//
// Only 64-bit wrapping arithmetic (`&+`, `&*`), which is what the JS side's
// BigInt.asUintN(64) emulates — no Foundation, like the rest of GameRules.

/// A source of floats in [0, 1) that rules take instead of reaching for a
/// global generator — the Swift form of the JavaScript rules' injected
/// `rng: () => number`. Pass a `SeededRandom` for repeatable results (tests,
/// golden parity) or a `SystemRandomSource` for live play, the way the web
/// falls back to `Math.random`.
public protocol RandomSource {
    /// The next float in [0, 1). Advances the source.
    mutating func next() -> Double
}

/// The top 53 bits of a 64-bit output times 2^-53: every value on an even
/// 2^-53 grid in [0, 1), exactly as JS computes `Number(x >> 11n) * 2 ** -53`.
/// Both steps are exact in Double, so there is no rounding to disagree on.
private func unitFloat(_ bits: UInt64) -> Double {
    Double(bits >> 11) * 0x1p-53
}

/// SplitMix64: one 64-bit state word, an add and three xor-shift-multiply
/// steps. A value type — copying it forks the sequence, so both copies draw the
/// same numbers from that point on.
public struct SeededRandom: RandomSource, Sendable, Equatable {
    private static let goldenGamma: UInt64 = 0x9e37_79b9_7f4a_7c15
    private static let mix1: UInt64 = 0xbf58_476d_1ce4_e5b9
    private static let mix2: UInt64 = 0x94d0_49bb_1331_11eb

    private var state: UInt64

    /// A fresh generator. Same seed as `createSeededRandom(seed)` in JS, same
    /// sequence.
    public init(seed: UInt64) {
        state = seed
    }

    /// The raw 64-bit output — for exact comparison against golden data.
    public mutating func nextUInt64() -> UInt64 {
        state = state &+ Self.goldenGamma
        var z = state
        z = (z ^ (z >> 30)) &* Self.mix1
        z = (z ^ (z >> 27)) &* Self.mix2
        return z ^ (z >> 31)
    }

    /// A float in [0, 1), a drop-in for `Math.random`; one 64-bit draw.
    public mutating func next() -> Double {
        unitFloat(nextUInt64())
    }
}

/// Non-repeatable randomness from the system generator, for live play where no
/// seed is wanted — the counterpart of the web's `Math.random` default. Uses
/// the same 53-bit construction as `SeededRandom.next()`.
public struct SystemRandomSource: RandomSource {
    private var generator = SystemRandomNumberGenerator()

    public init() {}

    public mutating func next() -> Double {
        unitFloat(generator.next())
    }
}
