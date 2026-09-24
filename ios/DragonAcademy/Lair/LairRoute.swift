import GameRules

/// The Learning Lair's screens, pushed onto the app's NavigationStack as
/// `Route.lair(_:)`. The funnel is SUBJECT → game → facts → the game itself
/// (CLAUDE.md "Learning Lair"); each step is one push, so Back unwinds one step
/// at a time like the web's back tab.
enum LairRoute: Hashable {
    /// The front door: one card per subject.
    case subjects
    /// A subject's games, with the skill-filter chips when it has several.
    case games(LairSubject)
    /// The facts picker for a math game: which operation (when `operation` is
    /// nil), then which number.
    case facts(LairGame, operation: BattleOp?)
    /// The game, launched with the facts the player chose (nil for a
    /// self-contained game).
    case play(LairGame, LairFacts?)

    /// The screen a funnel decision leads to.
    init(_ step: LairStep) {
        switch step {
        case .chooseOperation(let game): self = .facts(game, operation: nil)
        case .chooseNumber(let game, let op): self = .facts(game, operation: op)
        case .play(let game, let facts): self = .play(game, facts)
        }
    }
}

/// What the lair launches for a game. Games not built on iOS yet get the
/// "coming soon" page, which still receives the facts, so the hub works end to
/// end; each game's own ticket swaps its case in here.
enum LairGameDestination: Equatable {
    case comingSoon(LairGame, LairFacts?)

    init(game: LairGame, facts: LairFacts?) {
        // No lair game is built on iOS yet. A game's ticket adds its case and
        // matches `game.id` here, before this fallback.
        self = .comingSoon(game, facts)
    }
}
