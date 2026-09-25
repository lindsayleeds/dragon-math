// Missing Sound's bridge into the phonics curriculum — the Swift port of
// `cueWordFor` and `curriculumKeyFor` in src/data/phonicsWords.js, pinned by
// the `missingSoundKeys` cases of golden/phonics.json. The word picks and
// tiles are in Phonics.swift (`PhonicsWords`).
//
// Missing Sound keeps its own hand-segmented words and three levels, but its
// answers count toward the same mastery as the other games: the blanked
// grapheme is translated to an element key. Position matters — `st` at the
// front of "stem" is `st`, at the end of "nest" it is `end-st`.

extension PhonicsWords {
    /// The tile's "as in …" example word (`cueWordFor`); "" when there is none.
    public static func cueWord(for grapheme: String) -> String {
        cues[grapheme] ?? ""
    }

    /// The element a word's blank practises (`curriculumKeyFor`): a vowel is
    /// its short vowel, a final grapheme its ending form when the curriculum
    /// has one, otherwise the grapheme itself; nil when the curriculum doesn't
    /// cover it (the doubled `ll` in "bell").
    public static func curriculumKey(for entry: PhonicsWordEntry) -> String? {
        let grapheme = entry.answer
        let isFinal = entry.blank == entry.graphemes.count - 1
        let byKey = Phonics.elementByKey

        if grapheme.count == 1 && vowels.contains(grapheme) {
            let key = "short-\(grapheme)"
            return byKey[key] != nil ? key : nil
        }
        if isFinal && byKey["end-\(grapheme)"] != nil { return "end-\(grapheme)" }
        return byKey[grapheme] != nil ? grapheme : nil
    }

    /// The element a tapped tile names: the word with `option` in the blank,
    /// keyed as `curriculumKey(for:)` keys it.
    public static func curriculumKey(for entry: PhonicsWordEntry, option: String) -> String? {
        var graphemes = entry.graphemes
        graphemes[entry.blank] = option
        return curriculumKey(for: PhonicsWordEntry(graphemes: graphemes, blank: entry.blank))
    }

    /// The attempt a tap records (the web's `onSave` row for mode
    /// `missing-sound`): nil when the word's blank is no curriculum element,
    /// since an attempt against a key nothing can render is worse than none.
    /// Missing Sound speaks a whole word, so it records no response time.
    public static func attempt(for entry: PhonicsWordEntry, option: String) -> PhonicsAttemptRecord? {
        guard let key = curriculumKey(for: entry) else { return nil }
        let correct = option == entry.answer
        return PhonicsAttemptRecord(
            elementKey: key, mode: missingSoundMode, correct: correct,
            chosen: correct ? nil : curriculumKey(for: entry, option: option), responseMs: nil)
    }

    /// The `mode` a Missing Sound attempt records.
    public static let missingSoundMode = "missing-sound"
}
