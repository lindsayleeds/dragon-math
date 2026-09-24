// Unicode normalization for the game rules — the one piece of Memorize that
// GameRules can't compute. GameRules imports nothing (a test enforces it), and
// the standard library has no public NFKD, so the rules take the
// decomposition as a `CompatibilityDecomposition` argument and this package,
// which may import Foundation, supplies it. Everything else about matching a
// word — the lower-casing, the first code point — stays in GameRules.
//
// The split, end to end: `Memorize.normalizeWord(word)` here =
// GameRules' `Memorize.normalizeWord(word, decompose: TextNormalization.nfkd)`
// = JavaScript's `word.normalize('NFKD').toLowerCase()`. TextNormalizationTests
// checks it against the `normalize` table (and every first letter) in
// golden/memorize.json.
import Foundation
import GameRules

public enum TextNormalization {
    /// Unicode compatibility decomposition (NFKD), as JavaScript's
    /// `String.prototype.normalize('NFKD')` computes it.
    public static let nfkd: CompatibilityDecomposition = { $0.decomposedStringWithCompatibilityMapping }
}

extension Memorize {
    /// `normalizeMemoryWord`: NFKD, then JavaScript's lower case.
    public static func normalizeWord(_ word: String) -> String {
        normalizeWord(word, decompose: TextNormalization.nfkd)
    }

    /// `firstMemoryLetter`: what a Hard-mode key press must equal.
    public static func firstLetter(_ word: String) -> String {
        firstLetter(word, decompose: TextNormalization.nfkd)
    }

    /// `unsupportedMemoryWords`: words Hard mode can't be played with.
    public static func unsupportedWords(_ text: String) -> [String] {
        unsupportedWords(text, decompose: TextNormalization.nfkd)
    }
}

extension MemorizePractice {
    /// A practice run that matches words with `TextNormalization.nfkd`.
    public init(body: String, difficulty: MemorizeDifficulty, settings: MemorizeSettings = .defaults, rng: Rng) {
        self.init(body: body, difficulty: difficulty, settings: settings, rng: rng, decompose: TextNormalization.nfkd)
    }
}
