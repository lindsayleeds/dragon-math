// Dragon Memorize rules — the Swift port of src/rules/memorize.js: how a
// passage is split into sentences and words, which words each difficulty
// hides, what a Hard-mode key press must match, and how the word tiles are
// shuffled. golden/memorize.json is the check; MemorizeTests reads it.
//
// A passage is practiced one sentence at a time (`sentences`). Per sentence:
//   - easy:   the words at `hiddenWordIndexes(words, sentenceIndex:)` are
//             blanks, filled in order from a shuffled bank of just those words.
//   - medium: every word is a tile, shuffled; the child rebuilds the sentence.
//   - hard:   no tiles; the child presses `firstLetter` of each word in order.
//
// Draw order (same as the JavaScript, which is the reference):
//   - shuffledTiles(words): tiles (id = the word's index in the list), then
//     Fisher–Yates from the end: for i = n-1 down to 1,
//     j = floor(next() * (i + 1)), swap. n-1 draws.
//   - practiceTiles: easy → shuffledTiles of the hidden words in hidden order
//     (ids index that list, not the sentence); medium → shuffledTiles(words);
//     hard → [] with no draws. A practice run draws from ONE generator:
//     sentence 0's tiles, then sentence 1's when the child advances, and so on.
//
// Text is handled as Unicode scalars (code points). The JavaScript splitter
// indexes UTF-16 code units, but every character it tests for is in the BMP
// and a surrogate half never matches one, so the two agree. The word pattern
// `[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*` is matched by hand with the standard
// library's general categories, and JavaScript's `\s` is spelled out.
//
// Unicode normalization is the one thing the standard library can't do:
// `normalizeWord` is NFKD then JavaScript's toLowerCase, and NFKD needs
// Foundation (or ICU), which GameRules never imports. So the decomposition is
// passed in — the app hands over `TextNormalization.nfkd` (the TextNormalization
// package, Foundation's compatibility decomposition, tested there against the
// golden normalize table). The lower-casing is done here, per scalar, with
// JavaScript's one context rule (a word-final capital sigma becomes ς).

/// A Memorize difficulty. Raw values are the web's and the server's ids.
public enum MemorizeDifficulty: String, Sendable, CaseIterable, Codable {
    case easy, medium, hard

    /// The passage's `mastery_level` completing it at this difficulty earns:
    /// 1 easy, 2 medium, 3 hard (`DIFFICULTY_LEVEL` on the server).
    public var masteryLevel: Int {
        switch self {
        case .easy: 1
        case .medium: 2
        case .hard: 3
        }
    }
}

/// Memorize tunables, the `memorize` section of GET /api/rule-settings —
/// `DEFAULT_MEMORIZE_SETTINGS` in src/data/ruleSettings.js.
public struct MemorizeSettings: Sendable, Equatable {
    /// Easy hides word i of sentence s when
    /// (i + s) % easyHideEvery == easyHideOffset.
    public var easyHideEvery: Int
    public var easyHideOffset: Int

    public init(easyHideEvery: Int, easyHideOffset: Int) {
        self.easyHideEvery = easyHideEvery
        self.easyHideOffset = easyHideOffset
    }

    /// The fallback until the server's settings arrive. Must equal the web's.
    public static let defaults = MemorizeSettings(easyHideEvery: 4, easyHideOffset: 1)

    /// Settings from a served `memorize` section, repaired exactly as
    /// `memorizeSettingsFromServer` does: a missing or non-positive
    /// `easy_hide_every` and a missing or negative offset fall back to the
    /// defaults, and an offset the modulo can never produce is replaced.
    public init(servedEasyHideEvery every: Int?, easyHideOffset offset: Int?) {
        let d = Self.defaults
        let easyHideEvery = every.flatMap { $0 >= 1 ? $0 : nil } ?? d.easyHideEvery
        let offset = offset.flatMap { $0 >= 0 ? $0 : nil } ?? d.easyHideOffset
        self.init(
            easyHideEvery: easyHideEvery,
            easyHideOffset: offset < easyHideEvery ? offset : d.easyHideOffset % easyHideEvery)
    }
}

/// A piece of a sentence as it is shown: a word (with its index among the
/// sentence's words) or the text between words.
public enum MemorizeSegment: Sendable, Equatable {
    case word(String, index: Int)
    case separator(String)
}

/// One tile in a bank. `id` is the word's position in the list that was
/// shuffled — the hidden words for easy, the sentence's words for medium.
public struct MemorizeTile: Sendable, Equatable, Identifiable {
    public var id: Int
    public var word: String

    public init(id: Int, word: String) {
        self.id = id
        self.word = word
    }
}

/// NFKD — compatibility decomposition — of a string. GameRules can't compute
/// it without Foundation, so callers pass one in (`TextNormalization.nfkd`).
public typealias CompatibilityDecomposition = @Sendable (String) -> String

public enum Memorize {
    // MARK: - Words and segments

    /// The passage's words, in order (`passageWords`).
    public static func words(_ text: String) -> [String] {
        let scalars = Array(text.unicodeScalars)
        return wordRanges(scalars).map { string(scalars[$0]) }
    }

    /// Words and the separators around them, in order (`passageSegments`).
    public static func segments(_ text: String) -> [MemorizeSegment] {
        let scalars = Array(text.unicodeScalars)
        var segments: [MemorizeSegment] = []
        var cursor = 0
        for (wordIndex, range) in wordRanges(scalars).enumerated() {
            if range.lowerBound > cursor {
                segments.append(.separator(string(scalars[cursor..<range.lowerBound])))
            }
            segments.append(.word(string(scalars[range]), index: wordIndex))
            cursor = range.upperBound
        }
        if cursor < scalars.count {
            segments.append(.separator(string(scalars[cursor...])))
        }
        return segments
    }

    // MARK: - Sentences

    /// The passage split into sentences (`splitPassage`). A sentence ends at a
    /// run of `.`, `!` or `?`, plus any closing quotes and brackets, followed
    /// by whitespace or the end; the whitespace stays with it. A stop with no
    /// space after it (3.14, a.m.) doesn't end one. Chunks with no words
    /// (a lone "...") join the sentence after them, or the last one if none.
    public static func sentences(_ text: String) -> [String] {
        let source = Array(text.unicodeScalars)
        guard !source.isEmpty else { return [] }
        var sentences: [String] = []
        var start = 0
        var index = 0
        while index < source.count {
            guard isStop(source[index]) else {
                index += 1
                continue
            }
            var end = index + 1
            while end < source.count, isStop(source[end]) { end += 1 }
            while end < source.count, isCloser(source[end]) { end += 1 }
            if end < source.count, !isJSWhitespace(source[end]) {
                index = end
                continue
            }
            while end < source.count, isJSWhitespace(source[end]) { end += 1 }
            sentences.append(string(source[start..<end]))
            start = end
            index = end
        }
        if start < source.count { sentences.append(string(source[start...])) }

        var wordBearing: [String] = []
        var leadingPunctuation = ""
        for sentence in sentences {
            if !words(sentence).isEmpty {
                wordBearing.append(leadingPunctuation + sentence)
                leadingPunctuation = ""
            } else if !wordBearing.isEmpty {
                wordBearing[wordBearing.count - 1] += sentence
            } else {
                leadingPunctuation += sentence
            }
        }
        if !leadingPunctuation.isEmpty, !wordBearing.isEmpty {
            wordBearing[wordBearing.count - 1] += leadingPunctuation
        }
        return wordBearing
    }

    // MARK: - Hiding and tiles

    /// Easy's blanks: word `index` of sentence `sentenceIndex` is hidden when
    /// (index + sentenceIndex) % easyHideEvery == easyHideOffset. A sentence
    /// too short to hit one hides its last word.
    public static func hiddenWordIndexes(
        _ words: [String], sentenceIndex: Int, settings: MemorizeSettings = .defaults
    ) -> [Int] {
        guard !words.isEmpty else { return [] }
        let hidden = words.indices.filter {
            ($0 + sentenceIndex) % settings.easyHideEvery == settings.easyHideOffset
        }
        return hidden.isEmpty ? [words.count - 1] : hidden
    }

    /// The words as tiles, Fisher–Yates shuffled from the end (n-1 draws).
    public static func shuffledTiles(_ words: [String], rng: inout some RandomSource) -> [MemorizeTile] {
        var tiles = words.enumerated().map { MemorizeTile(id: $0.offset, word: $0.element) }
        var i = tiles.count - 1
        while i > 0 {
            let j = Int((rng.next() * Double(i + 1)).rounded(.down))
            tiles.swapAt(i, j)
            i -= 1
        }
        return tiles
    }

    /// The tile bank a sentence shows at `difficulty` (see the header for the
    /// draws): the hidden words for easy, every word for medium, none for hard.
    public static func practiceTiles(
        _ difficulty: MemorizeDifficulty, words: [String], hidden: [Int], rng: inout some RandomSource
    ) -> [MemorizeTile] {
        switch difficulty {
        case .easy: shuffledTiles(hidden.map { words[$0] }, rng: &rng)
        case .medium: shuffledTiles(words, rng: &rng)
        case .hard: []
        }
    }

    // MARK: - Letters

    /// NFKD, then lower case the way JavaScript's `toLowerCase` does
    /// (`normalizeMemoryWord`). Two words match when these are equal.
    public static func normalizeWord(_ word: String, decompose: CompatibilityDecomposition) -> String {
        jsLowercased(decompose(word))
    }

    /// The first code point of `normalizeWord` — what a Hard-mode key press
    /// must equal (`firstMemoryLetter`). Empty for an empty word.
    public static func firstLetter(_ word: String, decompose: CompatibilityDecomposition) -> String {
        normalizeWord(word, decompose: decompose).unicodeScalars.first.map { String($0) } ?? ""
    }

    /// Words Hard mode can't be played with: those whose first letter isn't
    /// a–z or 0–9 (`unsupportedMemoryWords`). The server refuses passages
    /// with any.
    public static func unsupportedWords(_ text: String, decompose: CompatibilityDecomposition) -> [String] {
        words(text).filter { word in
            let scalars = Array(firstLetter(word, decompose: decompose).unicodeScalars)
            guard scalars.count == 1 else { return true }
            return !isKeyboardLetter(scalars[0])
        }
    }

    /// The keys Hard mode's keyboard offers, A–Z then 0–9 (`KEYS` on the web).
    public static let keys: [String] = (Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")).map { String($0) }

    // MARK: - Character classes

    /// Ranges of the word pattern's matches, left to right.
    private static func wordRanges(_ scalars: [Unicode.Scalar]) -> [Range<Int>] {
        var ranges: [Range<Int>] = []
        var index = 0
        while index < scalars.count {
            guard isWordScalar(scalars[index]) else {
                index += 1
                continue
            }
            let start = index
            while index < scalars.count, isWordScalar(scalars[index]) { index += 1 }
            // (?:[’'][\p{L}\p{N}]+)* — an apostrophe only joins when a letter
            // or number follows it.
            while index + 1 < scalars.count, isApostrophe(scalars[index]), isWordScalar(scalars[index + 1]) {
                index += 1
                while index < scalars.count, isWordScalar(scalars[index]) { index += 1 }
            }
            ranges.append(start..<index)
        }
        return ranges
    }

    /// `[\p{L}\p{N}]`: any letter or number.
    private static func isWordScalar(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
            .decimalNumber, .letterNumber, .otherNumber:
            true
        default:
            false
        }
    }

    private static func isApostrophe(_ scalar: Unicode.Scalar) -> Bool {
        scalar == "'" || scalar == "\u{2019}"
    }

    /// `[.!?]`
    private static func isStop(_ scalar: Unicode.Scalar) -> Bool {
        scalar == "." || scalar == "!" || scalar == "?"
    }

    /// `[”’"')\]}]`: what may close a sentence after its stop.
    private static func isCloser(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar {
        case "\u{201D}", "\u{2019}", "\"", "'", ")", "]", "}": true
        default: false
        }
    }

    /// JavaScript's `\s`: WhiteSpace and LineTerminator in ECMAScript's sense.
    private static func isJSWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
            true
        default:
            false
        }
    }

    /// `/^[a-z0-9]$/`
    private static func isKeyboardLetter(_ scalar: Unicode.Scalar) -> Bool {
        ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar)
    }

    // MARK: - Lower case

    /// JavaScript's `String.prototype.toLowerCase`: each scalar's full
    /// Unicode lower-case mapping, except that capital sigma becomes final
    /// sigma (ς) at the end of a word — Unicode's Final_Sigma condition: a
    /// cased letter before it and none after it, skipping case-ignorable
    /// characters both ways.
    static func jsLowercased(_ text: String) -> String {
        let scalars = Array(text.unicodeScalars)
        var result = String.UnicodeScalarView()
        for (index, scalar) in scalars.enumerated() {
            if scalar == "\u{03A3}", isFinalSigma(scalars, at: index) {
                result.append("\u{03C2}")
            } else {
                result.append(contentsOf: scalar.properties.lowercaseMapping.unicodeScalars)
            }
        }
        return String(result)
    }

    private static func isFinalSigma(_ scalars: [Unicode.Scalar], at index: Int) -> Bool {
        var before = index - 1
        while before >= 0, scalars[before].properties.isCaseIgnorable { before -= 1 }
        guard before >= 0, scalars[before].properties.isCased else { return false }
        var after = index + 1
        while after < scalars.count, scalars[after].properties.isCaseIgnorable { after += 1 }
        return !(after < scalars.count && scalars[after].properties.isCased)
    }

    private static func string(_ scalars: some Sequence<Unicode.Scalar>) -> String {
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars)
        return String(view)
    }
}
