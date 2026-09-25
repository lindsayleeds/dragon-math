// Dragon Spelling rules — the Swift port of src/rules/spelling.js, pinned by
// golden/spelling.json. Which words a round plays, in what order, and Easy
// mode's scrambled letter tiles. The grade catalogs are generated into
// SpellingWords.swift (`npm run ios:spelling-words`).
//
// Draw order (copied from the JavaScript module header):
//   - shuffle(items): Fisher–Yates from the end, one draw per step:
//     for i = n-1 down to 1, j = floor(rng() * (i + 1)), swap items[i] and
//     items[j]. n items take n-1 draws (none for 0 or 1 item).
//   - drawRound(source): shuffle(source.words) — the WHOLE pool, so a 100-word
//     grade catalog takes 99 draws — then the first
//     min(source.perRound || n, n) words.
//   - letterTiles(word): shuffle of the word's letters as {id, letter}, where
//     id is the letter's index in the word: length-1 draws.
//   A game on one generator: drawRound first, then — in Easy only — letterTiles
//   for each word in round order as it comes up. Medium and Hard draw nothing
//   after the round. "Play again" draws a fresh round from the same generator.

/// One built-in grade catalog (`gradeSource(grade)` on the web).
public struct SpellingGrade: Sendable, Hashable, Identifiable {
    /// 1–6.
    public let grade: Int
    /// "Grade 1": catalog text, shown verbatim like the web.
    public let label: String
    /// The words in catalog order — the order a round's shuffle starts from.
    public let words: [String]

    public var id: Int { grade }

    public init(grade: Int, label: String, words: [String]) {
        self.grade = grade
        self.label = label
        self.words = words
    }

    /// The grade numbered `grade`, if there is one.
    public static func numbered(_ grade: Int) -> SpellingGrade? {
        all.first { $0.grade == grade }
    }

    /// `source.key` on the web ("grade:4"): what a best score is kept under.
    public var sourceKey: String { "grade:\(grade)" }

    /// The words a round draws from, and how many it plays.
    public var source: SpellingSource { SpellingSource(words: words, perRound: Spelling.wordsPerRound) }
}

/// What a round draws from: a grade catalog (10 of its words) or a list
/// played in full (`perRound` = its length). A `perRound` of 0 means the whole
/// pool, as the web's falsy `perRound` does.
public struct SpellingSource: Sendable, Hashable {
    public var words: [String]
    public var perRound: Int

    public init(words: [String], perRound: Int) {
        self.words = words
        self.perRound = perRound
    }
}

/// One Easy-mode tile. `id` is the letter's position in the word, so repeated
/// letters stay distinct.
public struct SpellingTile: Sendable, Hashable, Identifiable {
    public let id: Int
    public let letter: String

    public init(id: Int, letter: String) {
        self.id = id
        self.letter = letter
    }
}

/// How much on-screen help the speller gets; the words are the same for all
/// three (`SPELLING_DIFFICULTIES`).
public enum SpellingDifficulty: String, Sendable, Hashable, CaseIterable, Identifiable {
    /// Tap the scrambled letters into order; a hint flashes the word.
    case easy
    /// The word flashes once, then it's typed; a hint gives its first letter.
    case medium
    /// Listen and type; a hint gives its first letter.
    case hard

    public var id: String { rawValue }

    /// Whether the word is built from letter tiles (Easy) rather than typed.
    public var usesTiles: Bool { self == .easy }
}

public enum Spelling {
    /// Fisher–Yates from the end, one draw per step (n-1 draws).
    public static func shuffle<T>(_ items: [T], rng: inout some RandomSource) -> [T] {
        var pool = items
        var i = pool.count - 1
        while i > 0 {
            let j = Int((rng.next() * Double(i + 1)).rounded(.down))
            pool.swapAt(i, j)
            i -= 1
        }
        return pool
    }

    /// The words for one round: the whole pool shuffled, then the first
    /// `perRound` (all of them when `perRound` is 0 or more than the pool).
    public static func drawRound(_ source: SpellingSource, rng: inout some RandomSource) -> [String] {
        let pool = shuffle(source.words, rng: &rng)
        let count = source.perRound > 0 ? min(source.perRound, pool.count) : pool.count
        return Array(pool.prefix(count))
    }

    /// Easy mode: the word's letters as scrambled tiles.
    public static func letterTiles(_ word: String, rng: inout some RandomSource) -> [SpellingTile] {
        shuffle(word.enumerated().map { SpellingTile(id: $0.offset, letter: String($0.element)) }, rng: &rng)
    }

    /// Whether `attempt` spells `word`: trimmed and case-insensitive, as the
    /// web's submit compares.
    public static func isCorrect(_ attempt: String, for word: String) -> Bool {
        let guess = attempt.trimmingSpaces().lowercased()
        return !guess.isEmpty && guess == word.lowercased()
    }

    /// The end card's stars out of five: round(correct / total × 5), halves up
    /// like JavaScript's Math.round for these non-negative values.
    public static func stars(correct: Int, total: Int) -> Int {
        guard total > 0 else { return 0 }
        return Int((Double(correct) / Double(total) * 5).rounded(.toNearestOrAwayFromZero))
    }

    /// How the round went, for its dragon prize: 80% or better is `high`,
    /// 40% or better `normal`, else `low` (DragonSpelling.jsx).
    public static func prizePerformance(correct: Int, total: Int) -> PrizePerformance {
        guard total > 0 else { return .low }
        let share = Double(correct) / Double(total)
        return share >= 0.8 ? .high : share >= 0.4 ? .normal : .low
    }
}

private extension String {
    /// Leading and trailing spaces, tabs and newlines removed (no Foundation).
    func trimmingSpaces() -> String {
        let blank: (Character) -> Bool = { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" }
        guard let start = firstIndex(where: { !blank($0) }), let end = lastIndex(where: { !blank($0) }) else { return "" }
        return String(self[start...end])
    }
}
