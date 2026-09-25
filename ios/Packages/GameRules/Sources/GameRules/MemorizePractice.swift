// A Memorize practice run — the rules half of the web's MemoryPractice
// component (src/pages/DragonMemorizePage.jsx): which sentence is up, what the
// child has placed, whether a pick is right, and when a sentence and the
// passage are done. The view draws it and plays sounds from the feedback.
//
// Tiles are drawn as the web draws them: sentence 0's bank when the run
// starts, then each next sentence's bank when the child advances, all from
// the one generator the run owns (see Memorize.swift).

/// What a pick or key press did, for the view's sound and message.
public enum MemorizeFeedback: Sendable, Equatable {
    /// Ignored: already used, the sentence is done, or not this difficulty.
    case none
    /// Accepted, but the sentence isn't finished (medium: not full yet).
    case placed
    /// Right, and it may have finished the sentence (see `sentenceDone`).
    case correct
    /// Easy: that word belongs in a different blank.
    case wrongBlank
    /// Medium: every tile placed, but out of order.
    case wrongOrder
    /// Hard: not the next word's first letter.
    case wrongLetter
}

public struct MemorizePractice<Rng: RandomSource> {
    public let difficulty: MemorizeDifficulty
    public let sentences: [String]
    public let settings: MemorizeSettings
    private let decompose: CompatibilityDecomposition
    private var rng: Rng

    public private(set) var sentenceIndex = 0
    public private(set) var words: [String] = []
    public private(set) var segments: [MemorizeSegment] = []
    /// Easy's blanks for this sentence.
    public private(set) var hidden: [Int] = []
    /// This sentence's bank (empty for hard).
    public private(set) var tiles: [MemorizeTile] = []
    /// Easy: word indexes filled in so far, in order.
    public private(set) var revealed: [Int] = []
    /// Easy: tiles already used.
    public private(set) var usedTiles: [Int] = []
    /// Medium: tile ids placed so far, in order.
    public private(set) var chosen: [Int] = []
    /// Hard: how many words' letters have been pressed.
    public private(set) var hardIndex = 0
    public private(set) var sentenceDone = false

    /// Starts on sentence 0, drawing its tiles from `rng`.
    public init(
        body: String, difficulty: MemorizeDifficulty, settings: MemorizeSettings = .defaults,
        rng: Rng, decompose: @escaping CompatibilityDecomposition
    ) {
        self.difficulty = difficulty
        self.settings = settings
        self.decompose = decompose
        self.rng = rng
        sentences = Memorize.sentences(body)
        loadSentence()
    }

    /// Whether the current sentence is the last one.
    public var isLastSentence: Bool { sentenceIndex + 1 >= sentences.count }

    /// Medium: the words placed so far, in placing order.
    public var chosenWords: [String] {
        chosen.compactMap { id in tiles.first { $0.id == id }?.word }
    }

    // MARK: - Moves

    /// Easy: fill the next blank with `tile`.
    public mutating func pickEasy(_ tile: MemorizeTile) -> MemorizeFeedback {
        guard difficulty == .easy, !sentenceDone, !usedTiles.contains(tile.id),
            let expected = hidden.first(where: { !revealed.contains($0) })
        else { return .none }
        guard normalized(tile.word) == normalized(words[expected]) else { return .wrongBlank }
        revealed.append(expected)
        usedTiles.append(tile.id)
        if revealed.count == hidden.count { sentenceDone = true }
        return .correct
    }

    /// Medium: place `tile` next. When the last tile goes down the sentence is
    /// checked; out of order leaves the tiles placed for undo or `clearChosen`.
    public mutating func pickMedium(_ tile: MemorizeTile) -> MemorizeFeedback {
        guard difficulty == .medium, !sentenceDone, !chosen.contains(tile.id) else { return .none }
        chosen.append(tile.id)
        guard chosen.count == words.count else { return .placed }
        let built = chosenWords
        let correct = built.count == words.count
            && zip(built, words).allSatisfy { normalized($0) == normalized($1) }
        guard correct else { return .wrongOrder }
        sentenceDone = true
        return .correct
    }

    /// Medium: take back the last tile placed.
    public mutating func undoMedium() {
        guard difficulty == .medium, !sentenceDone, !chosen.isEmpty else { return }
        chosen.removeLast()
    }

    /// Medium: take back every tile, to try the order again.
    public mutating func clearChosen() {
        guard difficulty == .medium, !sentenceDone else { return }
        chosen.removeAll()
    }

    /// Hard: a key press. Matches when it normalizes to the next word's
    /// first letter.
    public mutating func pressLetter(_ letter: String) -> MemorizeFeedback {
        guard difficulty == .hard, !sentenceDone, hardIndex < words.count else { return .none }
        guard normalized(letter) == Memorize.firstLetter(words[hardIndex], decompose: decompose) else {
            return .wrongLetter
        }
        hardIndex += 1
        if hardIndex >= words.count { sentenceDone = true }
        return .correct
    }

    /// Moves to the next sentence, drawing its tiles. Returns false, and does
    /// nothing, when the current sentence isn't done or was the last — the
    /// passage is then complete.
    public mutating func advance() -> Bool {
        guard sentenceDone, !isLastSentence else { return false }
        sentenceIndex += 1
        loadSentence()
        return true
    }

    /// Done with the last sentence: the passage is complete at `difficulty`.
    public var isComplete: Bool { sentenceDone && isLastSentence }

    // MARK: -

    private func normalized(_ word: String) -> String {
        Memorize.normalizeWord(word, decompose: decompose)
    }

    private mutating func loadSentence() {
        let sentence = sentenceIndex < sentences.count ? sentences[sentenceIndex] : ""
        words = Memorize.words(sentence)
        segments = Memorize.segments(sentence)
        hidden = Memorize.hiddenWordIndexes(words, sentenceIndex: sentenceIndex, settings: settings)
        tiles = Memorize.practiceTiles(difficulty, words: words, hidden: hidden, rng: &rng)
        revealed = []
        usedTiles = []
        chosen = []
        hardIndex = 0
        sentenceDone = false
    }
}
