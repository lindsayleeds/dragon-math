import Audio
import Foundation
import GameRules
import Observation
import OSLog
import Store
import Sync

/// Where a grade word's recorded clip is in the app bundle. project.yml
/// bundles public/audio/spelling as the folder `spelling` (the web's
/// /audio/spelling/<word>.mp3), so every grade word plays offline. A word with
/// an example sentence has its whole prompt — word, sentence, word — under
/// `spelling/prompts` instead, as the web's `audioUrlsFor` picks.
enum SpellingClips {
    static let folder = "spelling"

    static func url(for word: String, in bundle: Bundle = .main) -> URL? {
        let word = word.lowercased()
        let subdirectory = Spelling.promptWords.contains(word) ? "\(folder)/prompts" : folder
        return bundle.url(forResource: word, withExtension: "mp3", subdirectory: subdirectory)
    }
}

/// Drives one Dragon Spelling game — the state of
/// src/components/DragonSpelling.jsx. The rules (which words, in what order,
/// Easy's scrambled tiles) are GameRules' `Spelling`, drawn from one generator
/// in the order its header gives: the round, then — in Easy — each word's
/// tiles as it comes up; "play again" draws the next round from the same one.
///
/// Each word is spoken as it comes up (and again on "Hear the word") through
/// `speak`, which plays the bundled clip through the silent switch. A right
/// answer plays the correct sound and a wrong one the wrong sound, as on the
/// web. Nothing per word is recorded: the web posts no spelling attempts and
/// the server has no spelling sync kind. A finished round is a
/// `SpellingRoundFinished` event (the best score per grade and difficulty is
/// read from those; the web keeps it in localStorage) plus its dragon prize as
/// `DragonsCollected` (sync `dragons_collected`), like the web's
/// <DragonPrizeReveal>.
@MainActor @Observable
final class SpellingModel {
    /// The web's beats, in ms (DragonSpelling.jsx).
    enum Timing {
        /// Medium shows the word this long before it's hidden to type.
        static let flash = 2_500.0
        /// Easy's hint shows the word this long.
        static let peek = 1_600.0
    }

    enum Phase: Equatable {
        /// Medium: the word is on screen.
        case flash
        /// Waiting for the answer.
        case spell
        /// Right or wrong, until the kid taps on.
        case feedback
        case done
    }

    struct WordResult: Equatable {
        var word: String
        var correct: Bool
    }

    /// The end card's score against the best before it.
    struct Best: Equatable {
        var best: Int
        var isNew: Bool
    }

    /// Letters a typed answer may run past the word (the web's gentle cap).
    static let typingSlack = 4

    let grade: SpellingGrade
    let difficulty: SpellingDifficulty

    private(set) var words: [String] = []
    private(set) var index = 0
    private(set) var results: [WordResult] = []
    private(set) var phase: Phase = .spell
    /// Medium/Hard: the letters typed so far.
    private(set) var typed = ""
    /// Easy: the current word's tiles, in tray order.
    private(set) var tiles: [SpellingTile] = []
    /// Easy: tile ids placed into the word's slots, in order.
    private(set) var placed: [Int] = []
    /// Easy: the hint is showing the word.
    private(set) var peeking = false
    /// Medium/Hard: the first-letter hint is showing.
    private(set) var showHint = false
    /// Words a hint was used on this round.
    private(set) var hintCount = 0
    private(set) var lastCorrect = false
    private(set) var best: Best?
    private(set) var prize: PrizeState = .none

    /// The pending flash or peek timer, and the finished round's writes, for
    /// tests to await.
    private(set) var beat: Task<Void, Never>?
    private(set) var lastWrite: Task<Void, Never>?

    private let store: (any Store)?
    private let profileID: Profile.ID?
    private let sync: SyncEngine?
    private let sleep: @Sendable (Double) async throws -> Void
    @ObservationIgnored private let speak: @MainActor (String) async -> Void
    @ObservationIgnored private let playSound: @MainActor (SoundEffect) -> Void
    @ObservationIgnored private let loadPrizeContext: @MainActor () async -> PrizeContext
    @ObservationIgnored private var rng: AnyRandomSource
    /// Prizes draw from their own generator, so the round's draws stay the
    /// golden file's.
    @ObservationIgnored private var prizeRNG: AnyRandomSource
    /// The word being said, for tests to await.
    @ObservationIgnored private(set) var speaking: Task<Void, Never>?
    private var hintUsedForWord = false
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Spelling")

    /// - Parameters:
    ///   - rng: the round and tile draws (`SystemRandomSource` in play).
    ///   - prizeRNG: the end-of-round prize draws.
    ///   - sleep: waits the given milliseconds; tests make it instant.
    ///   - speak: says a word (plays its bundled clip).
    ///   - playSound: `AudioPlayer.play`.
    ///   - prizeContext: what a prize draws from (`PrizeContext.load`).
    init(
        grade: SpellingGrade, difficulty: SpellingDifficulty,
        store: (any Store)?, profileID: Profile.ID?, sync: SyncEngine?,
        rng: some RandomSource = SystemRandomSource(),
        prizeRNG: some RandomSource = SystemRandomSource(),
        sleep: @escaping @Sendable (Double) async throws -> Void = { try await Task.sleep(for: .milliseconds($0)) },
        speak: @escaping @MainActor (String) async -> Void = { _ in },
        playSound: @escaping @MainActor (SoundEffect) -> Void = { _ in },
        prizeContext: @escaping @MainActor () async -> PrizeContext = { PrizeContext() }
    ) {
        self.grade = grade
        self.difficulty = difficulty
        self.store = store
        self.profileID = profileID
        self.sync = sync
        self.rng = AnyRandomSource(rng)
        self.prizeRNG = AnyRandomSource(prizeRNG)
        self.sleep = sleep
        self.speak = speak
        self.playSound = playSound
        loadPrizeContext = prizeContext
        words = Spelling.drawRound(grade.source, rng: &self.rng)
        setUpWord()
    }

    var word: String? { words.indices.contains(index) ? words[index] : nil }
    var correctCount: Int { results.count(where: \.correct) }
    /// 1-based, for "word 3 of 10".
    var wordNumber: Int { min(index + 1, words.count) }

    /// Easy: the word as built from the placed tiles.
    var builtFromTiles: String {
        placed.compactMap { id in tiles.first { $0.id == id }?.letter }.joined()
    }

    /// Easy: the tiles still in the tray.
    var trayTiles: [SpellingTile] { tiles.filter { !placed.contains($0.id) } }

    /// What "Check it" submits.
    var answer: String { difficulty.usesTiles ? builtFromTiles : typed }

    var canSubmit: Bool {
        guard phase == .spell, let word else { return false }
        return difficulty.usesTiles ? builtFromTiles.count == word.count : !typed.trimmingCharacters(in: .whitespaces).isEmpty
    }

    // MARK: - Words

    /// Resets the input for the current word, draws its tiles (Easy), and
    /// says it; Medium shows it first, then hides it.
    private func setUpWord() {
        beat?.cancel()
        typed = ""
        placed = []
        peeking = false
        showHint = false
        hintUsedForWord = false
        guard let word else { return }
        tiles = difficulty.usesTiles ? Spelling.letterTiles(word, rng: &rng) : []
        if difficulty == .medium {
            phase = .flash
            beat = Task { [weak self] in
                guard let self else { return }
                try? await self.sleep(Timing.flash)
                guard !Task.isCancelled, self.phase == .flash else { return }
                self.phase = .spell
            }
        } else {
            phase = .spell
        }
        sayWord()
    }

    /// "Hear the word": says the current word again.
    func sayWord() {
        guard let word else { return }
        speaking?.cancel()
        let speak = speak
        speaking = Task { await speak(word) }
    }

    /// Checks the answer and shows whether it was right.
    func submit() {
        guard canSubmit, let word else { return }
        let correct = Spelling.isCorrect(answer, for: word)
        lastCorrect = correct
        results.append(WordResult(word: word, correct: correct))
        playSound(correct ? .correct : .wrong)
        beat?.cancel()
        peeking = false
        phase = .feedback
    }

    /// The feedback card's "OK!"/"Got it": the next word, or the end card.
    func advance() {
        guard phase == .feedback else { return }
        if index + 1 >= words.count {
            finish()
        } else {
            index += 1
            setUpWord()
        }
    }

    /// "Play again": a fresh round from the same generator.
    func playAgain() {
        guard phase == .done else { return }
        words = Spelling.drawRound(grade.source, rng: &rng)
        index = 0
        results = []
        hintCount = 0
        best = nil
        prize = .none
        setUpWord()
    }

    /// Leaving the game: stops the word and any timer.
    func leave() {
        beat?.cancel()
        speaking?.cancel()
    }

    // MARK: - Typing (Medium, Hard)

    func press(_ letter: Character) {
        guard phase == .spell, !difficulty.usesTiles, let word else { return }
        guard typed.count < word.count + Self.typingSlack else { return }
        typed.append(contentsOf: letter.lowercased())
    }

    func backspace() {
        guard phase == .spell, !typed.isEmpty else { return }
        typed.removeLast()
    }

    /// Shows or hides "starts with … · n letters".
    func toggleHint() {
        guard phase == .spell, !difficulty.usesTiles else { return }
        if !showHint { countHint() }
        showHint.toggle()
    }

    // MARK: - Tiles (Easy)

    /// Moves a tray tile into the next empty slot.
    func place(_ tileID: Int) {
        guard phase == .spell, difficulty.usesTiles, tiles.contains(where: { $0.id == tileID }),
              !placed.contains(tileID) else { return }
        placed.append(tileID)
    }

    /// Tapping a filled slot takes that one letter back out.
    func remove(_ tileID: Int) {
        guard phase == .spell else { return }
        placed.removeAll { $0 == tileID }
    }

    /// Backspace: takes back the last-placed letter.
    func undoTile() {
        guard phase == .spell, !placed.isEmpty else { return }
        placed.removeLast()
    }

    /// Hint: flashes the word for a moment. Unlimited, and a second tap
    /// restarts the window; it counts once per word.
    func peek() {
        guard phase == .spell, difficulty.usesTiles else { return }
        countHint()
        beat?.cancel()
        peeking = true
        beat = Task { [weak self] in
            guard let self else { return }
            try? await self.sleep(Timing.peek)
            guard !Task.isCancelled else { return }
            self.peeking = false
        }
    }

    /// Tapping the peek card hides it early.
    func endPeek() {
        beat?.cancel()
        peeking = false
    }

    private func countHint() {
        guard !hintUsedForWord else { return }
        hintUsedForWord = true
        hintCount += 1
    }

    // MARK: - End of round

    private func finish() {
        beat?.cancel()
        phase = .done
        prize = .opening
        let correct = correctCount, total = words.count, hints = hintCount
        if correct >= total { playSound(.correct) }
        let round = SpellingRoundFinished(
            sourceKey: grade.sourceKey, difficulty: difficulty.rawValue, correct: correct, total: total, hints: hints)
        lastWrite = Task { [weak self] in
            guard let self else { return }
            let prior = await self.priorBest()
            let best = Self.best(correct: correct, prior: prior)
            let (cards, dragons) = await self.drawPrize(correct: correct, total: total)
            // A "play again" while this ran has already moved on.
            guard self.phase == .done else { return }
            self.best = best
            self.prize = .revealed(cards)
            var events: [any EventPayload] = [round]
            if !dragons.isEmpty { events.append(DragonsCollected(dragonIDs: dragons)) }
            await self.record(events)
        }
    }

    /// The best score shown on the end card, given the best before this round
    /// (the web's rule: "New best!" only when there was one to beat).
    nonisolated static func best(correct: Int, prior: Int?) -> Best {
        guard let prior else { return Best(best: correct, isNew: false) }
        return correct > prior ? Best(best: correct, isNew: true) : Best(best: prior, isNew: false)
    }

    /// The round's prize: a `high` performance for 80% right, `normal` for
    /// 40%, else `low`, as DragonSpelling.jsx asks.
    private func drawPrize(correct: Int, total: Int) async -> (cards: [PrizeCard], dragonIDs: [Int]) {
        let context = await loadPrizeContext()
        let performance = Spelling.prizePerformance(correct: correct, total: total)
        let count = rollPrizeCount(performance, rng: &prizeRNG, settings: context.settings)
        let drawn = drawDragonPrize(catalog: context.catalog, count: count, rng: &prizeRNG, settings: context.settings)
        return (PrizeCard.cards(for: drawn, owned: context.owned), drawn.map(\.dragonID))
    }

    /// This profile's best score before now for this grade and difficulty.
    private func priorBest() async -> Int? {
        guard let store, let profileID else { return nil }
        do {
            return try await store.events(for: profileID)
                .compactMap { try $0.decode(SpellingRoundFinished.self) }
                .filter { $0.sourceKey == grade.sourceKey && $0.difficulty == difficulty.rawValue }
                .map(\.correct)
                .max()
        } catch {
            log.error("spelling: couldn't read past rounds: \(error)")
            return nil
        }
    }

    private func record(_ events: [any EventPayload]) async {
        guard let store, let profileID else { return }
        do {
            for event in events { try await store.record(event, for: profileID) }
            sync?.requestSync()
        } catch {
            // The round still ends; there's nothing a kid can do.
            log.error("spelling: couldn't record the round: \(error)")
        }
    }
}
