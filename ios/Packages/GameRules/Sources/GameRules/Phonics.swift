// Dragon Phonics rounds — the Swift port of src/data/phonicsRounds.js and the
// answer rules of src/data/phonicsCurriculum.js, pinned by the `rounds` cases
// of golden/phonics.json. The data (every element, stage and mode) is generated
// into PhonicsData.swift by `npm run ios:phonics-data`.
//
// An ELEMENT is one sound (`key`, also its clip's name), shown as `g`, which
// may be typed as any of `accepts`. A round is up to ten distinct elements from
// the chosen stages, each with its choice tiles (Sound Match, Sound Hunt) or
// none (Sound Spell).
//
// Draw order (copied from the JavaScript): buildRound draws, in turn,
//   1. pickRoundElements — one draw per element picked: r = rng() × total
//      weight, then the first element whose running weight takes r to ≤ 0
//      (the last one if rounding leaves r above 0), removed from the pool;
//   2. then item by item:
//      - choose: buildElementOptions — shuffles the same-type eligible pool,
//        then the whole eligible pool (both shuffles always run, even when
//        `near` already filled the tiles), then [answer, ...picked];
//      - find-in-word: one draw for the word (floor(rng() × words)), then
//        buildWordOptions — the same three shuffles;
//      - type-it: nothing.
// Every shuffle is Fisher–Yates from the end: j = floor(rng() × (i + 1)) for
// i = count - 1 down to 1.
//
// Mastery only weights the pick (a weak sound comes up more often); the rule
// that judges mastery is the server's (server/lib/phonicsMastery.js).

/// One sound-spelling of the curriculum (src/data/phonicsCurriculum.js).
public struct PhonicsElement: Sendable, Hashable, Identifiable {
    /// Permanent id: stored mastery is keyed by it, and it names the clip
    /// (`phonics/<key>.mp3`).
    public let key: String
    /// The letters shown on a tile.
    public let g: String
    /// How it's written as a sound: "/sh/".
    public let sound: String
    /// "consonant", "digraph", "vowel-team"…: where distractors fall back to.
    public let type: String
    public let stage: Int
    /// Example words that contain it.
    public let words: [String]
    /// Elements it's genuinely confused with; distractors come from here first.
    public let near: [String]
    /// Every spelling that counts as typing it; always includes `g`.
    public let accepts: [String]
    /// A teaching note ("the k is silent"), or "".
    public let note: String

    public var id: String { key }

    public init(
        key: String, g: String, sound: String, type: String, stage: Int, words: [String], near: [String],
        accepts: [String], note: String
    ) {
        self.key = key
        self.g = g
        self.sound = sound
        self.type = type
        self.stage = stage
        self.words = words
        self.near = near
        self.accepts = accepts
        self.note = note
    }
}

/// One of the eight stages, in the order a reader meets them.
public struct PhonicsStage: Sendable, Hashable, Identifiable {
    public let stage: Int
    public let label: String
    public let emoji: String
    public let blurb: String

    public var id: Int { stage }
    public var key: String { "stage-\(stage)" }
    /// The stage's elements, in curriculum order.
    public var elements: [PhonicsElement] { PhonicsElement.all.filter { $0.stage == stage } }

    public init(stage: Int, label: String, emoji: String, blurb: String) {
        self.stage = stage
        self.label = label
        self.emoji = emoji
        self.blurb = blurb
    }
}

/// One of the four games (`PHONICS_MODES`), as the web's picker shows it.
public struct PhonicsMode: Sendable, Hashable, Identifiable {
    /// "choose", "type-it", "find-in-word" or "missing-sound": what an attempt
    /// records as its `mode`.
    public let key: String
    public let name: String
    public let emoji: String
    public let tagline: String
    public let blurb: String
    /// "easier", "medium" or "harder".
    public let difficulty: String
    /// "recognition", "recall" or "analysis".
    public let skill: String

    public var id: String { key }

    public init(
        key: String, name: String, emoji: String, tagline: String, blurb: String, difficulty: String, skill: String
    ) {
        self.key = key
        self.name = name
        self.emoji = emoji
        self.tagline = tagline
        self.blurb = blurb
        self.difficulty = difficulty
        self.skill = skill
    }

    public static func named(_ key: String) -> PhonicsMode? { all.first { $0.key == key } }
}

/// The modes `buildRound` deals for (`ROUND_MODES`).
public enum PhonicsRoundMode: String, Sendable, Hashable, CaseIterable, Decodable {
    /// Sound Match: hear a sound, tap its letters.
    case choose
    /// Sound Spell: hear a sound, type its letters.
    case typeIt = "type-it"
    /// Sound Hunt: hear a word, find the sound inside it.
    case findInWord = "find-in-word"

    /// Tiles a multiple-choice item shows (`OPTION_COUNT`, 4 by default).
    var optionCount: Int { 4 }
}

/// Which stages a round draws from: a stage, several, or all of them (the
/// JavaScript's number, array or 'all').
public enum PhonicsStages: Sendable, Hashable {
    case all
    case stages([Int])

    public static func stage(_ stage: Int) -> PhonicsStages { .stages([stage]) }
}

/// One element's mastery as GET /api/phonics/mastery reports it — the fields
/// a round reads. A missing level counts as "new".
public struct PhonicsMasteryState: Sendable, Hashable, Decodable {
    /// "new", "learning", "solid" or "mastered".
    public var level: String?
    /// A solid or mastered sound not practised for a while.
    public var stale: Bool?
    /// Recent accuracy, 0–1; nil before any attempts.
    public var accuracy: Double?

    public init(level: String? = nil, stale: Bool? = nil, accuracy: Double? = nil) {
        self.level = level
        self.stale = stale
        self.accuracy = accuracy
    }
}

/// One question of a round.
public struct PhonicsItem: Sendable, Hashable {
    /// The answer.
    public let element: PhonicsElement
    /// Sound Hunt's word, which the sound is hidden in; nil otherwise.
    public let word: String?
    /// The tiles, answer included; nil for Sound Spell.
    public let options: [PhonicsElement]?

    public init(element: PhonicsElement, word: String?, options: [PhonicsElement]?) {
        self.element = element
        self.word = word
        self.options = options
    }
}

/// One answer as the server stores it (a phonics_attempts row, `toAttempt`).
public struct PhonicsAttemptRecord: Sendable, Hashable {
    public let elementKey: String
    public let mode: String
    public let correct: Bool
    /// For a wrong answer, the element it named (tapped, or typed as one of
    /// its spellings); nil otherwise.
    public let chosen: String?
    /// From the prompt finishing to the answer, in whole milliseconds.
    public let responseMs: Int?

    public init(elementKey: String, mode: String, correct: Bool, chosen: String?, responseMs: Int?) {
        self.elementKey = elementKey
        self.mode = mode
        self.correct = correct
        self.chosen = chosen
        self.responseMs = responseMs
    }
}

public enum Phonics {
    public static let elementByKey: [String: PhonicsElement] = {
        var byKey: [String: PhonicsElement] = [:]
        for element in PhonicsElement.all { byKey[element.key] = element }
        return byKey
    }()

    /// Every element in `stages` (`elementsForStages`), in curriculum order.
    public static func elements(for stages: PhonicsStages) -> [PhonicsElement] {
        switch stages {
        case .all: return PhonicsElement.all
        case .stages(let wanted): return PhonicsElement.all.filter { wanted.contains($0.stage) }
        }
    }

    // MARK: - Answers

    /// Lower case, without spaces, underscores or hyphens: "A_e" → "ae".
    static func normalized(_ spelling: String) -> String {
        String(spelling.lowercased().filter { !$0.isWhitespace && $0 != "_" && $0 != "-" })
    }

    /// Whether `typed` is a legitimate spelling of the element's sound
    /// (`isAcceptedSpelling`): case, spaces and a magic-e frame's underscore
    /// are ignored, so "ae", "a_e" and "a-e" all count for /ā/.
    public static func isAcceptedSpelling(_ element: PhonicsElement, typed: String) -> Bool {
        let t = normalized(typed)
        guard !t.isEmpty else { return false }
        return element.accepts.contains { normalized($0) == t }
    }

    /// The attempt row for an answer (`toAttempt`). A right answer names no
    /// confusion; a wrong typed answer is matched back to the element it spells.
    public static func attempt(
        element: PhonicsElement, mode: String, correct: Bool, chosenElement: PhonicsElement? = nil,
        typed: String? = nil, responseMs: Int? = nil
    ) -> PhonicsAttemptRecord {
        var chosen = correct ? nil : chosenElement?.key
        if chosen == nil, let typed, !correct {
            let norm = normalized(typed)
            chosen = PhonicsElement.all.first { other in
                other.key != element.key && other.accepts.contains { normalized($0) == norm }
            }?.key
        }
        return PhonicsAttemptRecord(
            elementKey: element.key, mode: mode, correct: correct, chosen: chosen, responseMs: responseMs)
    }

    // MARK: - Which sounds to ask

    /// How much likelier a weak element is to be picked (`LEVEL_WEIGHT`).
    static let levelWeight: [String: Int] = ["learning": 6, "new": 4, "solid": 2, "mastered": 1]
    /// Added to a stale element (`STALE_BONUS`).
    static let staleBonus = 4

    /// An element's pick weight (`weightFor`).
    public static func weight(for element: PhonicsElement, mastery: [String: PhonicsMasteryState]?) -> Int {
        let state = mastery?[element.key]
        let level = state?.level.flatMap { $0.isEmpty ? nil : $0 } ?? "new"
        let base = levelWeight[level] ?? levelWeight["new"]!
        return base + (state?.stale == true ? staleBonus : 0)
    }

    /// Up to `count` distinct elements, weighted by mastery
    /// (`pickRoundElements`); a smaller pool makes a shorter round.
    public static func pickRoundElements(
        _ pool: [PhonicsElement], count: Int = questionsPerRound, mastery: [String: PhonicsMasteryState]? = nil,
        rng: inout some RandomSource
    ) -> [PhonicsElement] {
        var remaining = pool
        var picked: [PhonicsElement] = []
        let want = min(count, remaining.count)
        while picked.count < want {
            let weights = remaining.map { weight(for: $0, mastery: mastery) }
            let total = weights.reduce(0, +)
            var r = rng.next() * Double(total)
            var idx = weights.count - 1
            for i in weights.indices {
                r -= Double(weights[i])
                if r <= 0 {
                    idx = i
                    break
                }
            }
            picked.append(remaining.remove(at: idx))
        }
        return picked
    }

    // MARK: - Tiles

    /// Fisher–Yates from the end, as the JavaScript's `shufflePhonics`.
    public static func shuffle<T>(_ items: [T], rng: inout some RandomSource) -> [T] {
        var a = items
        var i = a.count - 1
        while i > 0 {
            let j = Int(rng.next() * Double(i + 1))
            a.swapAt(i, j)
            i -= 1
        }
        return a
    }

    /// `near` first, then the same type, then anything: `count - 1` distinct
    /// wrong tiles from `eligible`, plus the answer, shuffled. Both shuffles
    /// always draw.
    private static func options(
        for element: PhonicsElement, count: Int, eligible: [PhonicsElement], rng: inout some RandomSource
    ) -> [PhonicsElement] {
        var byKey: [String: PhonicsElement] = [:]
        for el in eligible { byKey[el.key] = el }
        var picked: [PhonicsElement] = []
        func take(_ candidates: [PhonicsElement?]) {
            for el in candidates {
                if picked.count >= count - 1 { return }
                if let el, !picked.contains(where: { $0.key == el.key }) { picked.append(el) }
            }
        }
        take(element.near.map { byKey[$0] })
        take(shuffle(eligible.filter { $0.type == element.type }, rng: &rng))
        take(shuffle(eligible, rng: &rng))
        return shuffle([element] + picked, rng: &rng)
    }

    /// Sound Match's tiles (`buildElementOptions`). An element spelled like
    /// one of the answer's accepted spellings is never a wrong tile.
    public static func buildElementOptions(
        _ element: PhonicsElement, count: Int = 4, pool: [PhonicsElement] = PhonicsElement.all,
        rng: inout some RandomSource
    ) -> [PhonicsElement] {
        let answerSpellings = Set(element.accepts.map { $0.lowercased() })
        let eligible = pool.filter { el in
            el.key != element.key
                && !answerSpellings.contains(el.g.lowercased())
                && !el.accepts.contains { answerSpellings.contains($0.lowercased()) }
        }
        return options(for: element, count: count, eligible: eligible, rng: &rng)
    }

    /// Whether any of the element's spellings is in `word`
    /// (`spellingAppearsIn`). A magic-e frame (a_e) matches vowel, one
    /// consonant, e.
    public static func spellingAppears(_ element: PhonicsElement, in word: String) -> Bool {
        let w = Array(word.lowercased().utf8)
        return element.accepts.contains { spelling in
            let s = Array(spelling.lowercased().utf8)
            if s.contains(UInt8(ascii: "_")) || (s.count == 3 && s[1] == UInt8(ascii: "-")) {
                let vowel = s[0]
                let tail = s[s.count - 1]
                guard w.count >= 3 else { return false }
                for i in 0...(w.count - 3) where w[i] == vowel && consonants.contains(w[i + 1]) && w[i + 2] == tail {
                    return true
                }
                return false
            }
            return contains(w, s)
        }
    }

    private static let consonants = Set("bcdfghjklmnpqrstvwxyz".utf8)

    private static func contains(_ haystack: [UInt8], _ needle: [UInt8]) -> Bool {
        if needle.isEmpty { return true }
        guard haystack.count >= needle.count else { return false }
        for start in 0...(haystack.count - needle.count) where haystack[start..<(start + needle.count)].elementsEqual(needle) {
            return true
        }
        return false
    }

    /// Sound Hunt's tiles (`buildWordOptions`): wrong tiles are sounds NOT in
    /// the word, so no item has two right answers.
    public static func buildWordOptions(
        _ element: PhonicsElement, word: String, count: Int = 4, pool: [PhonicsElement] = PhonicsElement.all,
        rng: inout some RandomSource
    ) -> [PhonicsElement] {
        let eligible = pool.filter { $0.key != element.key && !spellingAppears($0, in: word) }
        return options(for: element, count: count, eligible: eligible, rng: &rng)
    }

    // MARK: - Rounds

    /// One round (`buildRound`). `only` narrows what's ASKED (a review list),
    /// never where wrong tiles come from; a list with nothing in the pool
    /// asks the whole pool.
    public static func buildRound(
        mode: PhonicsRoundMode, stages: PhonicsStages = .all, count: Int = questionsPerRound,
        mastery: [String: PhonicsMasteryState]? = nil, only: [String]? = nil, rng: inout some RandomSource
    ) -> [PhonicsItem] {
        var optionPool = elements(for: stages)
        var askPool = optionPool

        if let only, !only.isEmpty {
            let wanted = Set(only)
            let restricted = optionPool.filter { wanted.contains($0.key) }
            if !restricted.isEmpty { askPool = restricted }
        }
        if mode == .findInWord { askPool = askPool.filter { !$0.words.isEmpty } }
        if optionPool.count <= mode.optionCount { optionPool = PhonicsElement.all }

        let picked = pickRoundElements(askPool, count: count, mastery: mastery, rng: &rng)
        return picked.map { element in
            switch mode {
            case .choose:
                let options = buildElementOptions(element, count: mode.optionCount, pool: optionPool, rng: &rng)
                return PhonicsItem(element: element, word: nil, options: options)
            case .findInWord:
                let word = element.words[Int(rng.next() * Double(element.words.count))]
                let options = buildWordOptions(element, word: word, count: mode.optionCount, rng: &rng)
                return PhonicsItem(element: element, word: word, options: options)
            case .typeIt:
                return PhonicsItem(element: element, word: nil, options: nil)
            }
        }
    }

    /// What a "Needs Practice" round drills (`reviewTargets`): learning or
    /// stale elements, lowest accuracy first (ties in curriculum order), at
    /// most `limit`; nil when there are none.
    public static func reviewTargets(_ mastery: [String: PhonicsMasteryState]?, limit: Int = 20) -> [String]? {
        guard let mastery else { return nil }
        let scored = PhonicsElement.all.enumerated()
            .compactMap { index, el -> (Int, PhonicsElement, Double)? in
                guard let state = mastery[el.key], state.level == "learning" || state.stale == true else { return nil }
                return (index, el, state.accuracy ?? 0)
            }
            .sorted { $0.2 != $1.2 ? $0.2 < $1.2 : $0.0 < $1.0 }
            .prefix(limit)
            .map(\.1.key)
        return scored.isEmpty ? nil : Array(scored)
    }
}

// MARK: - Missing Sound

/// A Missing Sound word: its graphemes in order and which one is blanked
/// (src/data/phonicsWords.js `{ g, b }`).
public struct PhonicsWordEntry: Sendable, Hashable {
    public let graphemes: [String]
    public let blank: Int

    public init(graphemes: [String], blank: Int) {
        self.graphemes = graphemes
        self.blank = blank
    }

    /// The whole word (`wordOf`).
    public var word: String { graphemes.joined() }
    /// The blanked grapheme (`answerOf`).
    public var answer: String { graphemes[blank] }
}

/// One of Missing Sound's three levels.
public struct PhonicsLevel: Sendable, Hashable, Identifiable {
    public let key: String
    public let label: String
    public let emoji: String
    /// Tiles per word.
    public let options: Int
    public let blurb: String
    public let words: [PhonicsWordEntry]

    public var id: String { key }

    public init(key: String, label: String, emoji: String, options: Int, blurb: String, words: [PhonicsWordEntry]) {
        self.key = key
        self.label = label
        self.emoji = emoji
        self.options = options
        self.blurb = blurb
        self.words = words
    }
}

/// Missing Sound's word picks and tiles (src/data/phonicsWords.js), pinned by
/// the `words` cases of golden/phonics.json. Draw order: pickWords shuffles the
/// level's whole list (count - 1 draws); buildOptions shuffles the grapheme's
/// pool without the answer, keeps the first count - 1, then shuffles
/// [answer, ...kept].
public enum PhonicsWords {
    public static let vowels = ["a", "e", "i", "o", "u"]
    public static let consonants = [
        "b", "c", "d", "f", "g", "h", "j", "k", "l", "m",
        "n", "p", "r", "s", "t", "v", "w", "y", "z",
    ]
    public static let blends = [
        "sh", "ch", "th", "wh", "ck", "ng",
        "bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr",
        "pl", "pr", "sl", "sn", "sp", "st", "sw", "tr",
    ]

    /// Where a blanked grapheme's wrong tiles come from (`poolFor`).
    public static func pool(for grapheme: String) -> [String] {
        if grapheme.count > 1 { return blends }
        if vowels.contains(grapheme) { return vowels }
        return consonants
    }

    /// `count` distinct words from a level (`pickPhonicsWords`); an unknown
    /// level plays the first.
    public static func pickWords(
        level key: String, count: Int = PhonicsLevel.wordsPerRound, rng: inout some RandomSource
    ) -> [PhonicsWordEntry] {
        let level = PhonicsLevel.all.first { $0.key == key } ?? PhonicsLevel.all[0]
        return Array(Phonics.shuffle(level.words, rng: &rng).prefix(min(count, level.words.count)))
    }

    /// The answer plus `count - 1` same-pool wrong graphemes, shuffled
    /// (`buildOptions`).
    public static func buildOptions(_ entry: PhonicsWordEntry, count: Int, rng: inout some RandomSource) -> [String] {
        let answer = entry.answer
        let pool = pool(for: answer).filter { $0 != answer }
        let distractors = Phonics.shuffle(pool, rng: &rng).prefix(max(0, count - 1))
        return Phonics.shuffle([answer] + distractors, rng: &rng)
    }
}
