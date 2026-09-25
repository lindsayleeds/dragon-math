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
    /// Picks its own × / ÷ and digit (#159).
    case provingGrounds
    /// Picks its own passage and difficulty (#165).
    case memorize
    /// Twelve problems on the operation and number picked in the lair (#156).
    case eggHatchery(LairFacts)
    /// Skip counts by the number picked in the facts grid (#157).
    case steppingStones(baseNumber: Int)
    /// Picks its own grade and difficulty (#160).
    case spelling
    /// Picks its own game and sounds (#162).
    case phonics
    /// The self-leveling campaign on the operation picked (#158); it needs
    /// no number.
    case munchers(BattleOp)
    case comingSoon(LairGame, LairFacts?)

    init(game: LairGame, facts: LairFacts?) {
        // A game's ticket adds its case and matches `game.id` here, before
        // this fallback.
        switch game.id {
        case "proving-grounds": self = .provingGrounds
        case "dragon-memorize": self = .memorize
        case "dragon-spelling": self = .spelling
        case "dragon-phonics": self = .phonics
        case "dragon-egg-hatchery" where facts?.number != nil: self = .eggHatchery(facts!)
        case "stepping-stones" where facts?.number != nil: self = .steppingStones(baseNumber: facts!.number!)
        case "dragon-munchers": self = .munchers(facts?.operation ?? .mul)
        default: self = .comingSoon(game, facts)
        }
    }
}
