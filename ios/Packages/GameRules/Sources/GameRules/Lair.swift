// The Learning Lair: its catalog types and the decisions its three-step funnel
// makes — the Swift port of src/data/games.js and of the choices in
// src/pages/LearningLairPage.jsx and LearningLairOperationPage.jsx.
//
// The funnel is SUBJECT → game → (for a math game) which facts. The data itself
// is generated into LairCatalog.swift by scripts/generate-swift-game-catalog.mjs.
//
// `subject`, `skills` and `practices` look redundant and are not (games.js):
//   subject    — the lair's front door (Math / Spelling / Phonics / Memorize).
//   skills     — the operations the funnel asks the player to pick between.
//   practices  — the skill tags a card is badged with and the filter chips use;
//                a superset of `skills`.

/// A top-level fork of the lair (`SUBJECTS` in games.js).
public struct LairSubject: Sendable, Hashable, Identifiable {
    public let id: String
    public let label: String
    public let emoji: String
    public let blurb: String
    /// Accent color, 0xRRGGBB.
    public let color: UInt32

    public init(id: String, label: String, emoji: String, blurb: String, color: UInt32) {
        self.id = id
        self.label = label
        self.emoji = emoji
        self.blurb = blurb
        self.color = color
    }
}

/// A skill badge and filter chip (`SKILL_TAGS` in games.js). The math tags are
/// the operations; the literacy ones exist only here.
public struct LairSkillTag: Sendable, Hashable, Identifiable {
    public let id: String
    public let label: String
    public let symbol: String
    /// An operation's caption ("times tables"); empty for literacy tags.
    public let blurb: String
    /// Accent color, 0xRRGGBB.
    public let color: UInt32

    public init(id: String, label: String, symbol: String, blurb: String, color: UInt32) {
        self.id = id
        self.label = label
        self.symbol = symbol
        self.blurb = blurb
        self.color = color
    }

    /// The tag for a skill key, if there is one.
    public static func named(_ id: String) -> LairSkillTag? {
        all.first { $0.id == id }
    }

    /// The tag for an operation.
    public static func operation(_ op: BattleOp) -> LairSkillTag {
        // Every operation is a tag: SKILL_TAGS is built from OPERATIONS.
        named(op.rawValue)!
    }
}

/// A Learning Lair game (`GAME_TYPES` in games.js).
public struct LairGame: Sendable, Hashable, Identifiable {
    public let id: String
    public let subject: String
    public let name: String
    public let emoji: String
    public let description: String
    public let skills: [BattleOp]
    public let practices: [String]
    /// Self-contained: picks its own operation or content (a `route` on the
    /// web), so the funnel launches it without asking for facts.
    public let hasOwnPage: Bool
    /// Paid plans only (`PAID_GAME_IDS`). The lair marks it; gating is #149.
    public let premium: Bool

    public init(
        id: String, subject: String, name: String, emoji: String, description: String,
        skills: [BattleOp], practices: [String], hasOwnPage: Bool, premium: Bool
    ) {
        self.id = id
        self.subject = subject
        self.name = name
        self.emoji = emoji
        self.description = description
        self.skills = skills
        self.practices = practices
        self.hasOwnPage = hasOwnPage
        self.premium = premium
    }

    /// The game with this id, if the catalog has it.
    public static func named(_ id: String) -> LairGame? {
        all.first { $0.id == id }
    }

    /// Dragon Munchers runs a self-leveling campaign, so it needs an operation
    /// but no base number (LearningLairOperationPage launches it straight away
    /// in progression mode).
    public var picksItsOwnNumber: Bool { id == "dragon-munchers" }
}

/// The facts a math game practices: an operation and, for most games, the base
/// number (1–12) picked from the grid.
public struct LairFacts: Sendable, Hashable, Codable {
    public let operation: BattleOp
    /// nil for a game that picks its own number (``LairGame/picksItsOwnNumber``).
    public let number: Int?

    public init(operation: BattleOp, number: Int?) {
        self.operation = operation
        self.number = number
    }
}

/// Where the funnel goes after a pick.
public enum LairStep: Sendable, Hashable {
    /// Ask which operation this multi-skill game should practice.
    case chooseOperation(LairGame)
    /// Ask which number (1–12) to practice for this operation.
    case chooseNumber(LairGame, BattleOp)
    /// Launch the game with these facts; nil for a self-contained game.
    case play(LairGame, LairFacts?)
}

/// The lair's decisions, free of any UI.
public enum Lair {
    /// The numbers the facts picker offers (the web's mastery grid).
    public static let numbers = Array(1...12)

    /// Subjects that have at least one game, in order — removing a subject's
    /// last game removes its card rather than opening an empty list.
    public static func stockedSubjects(
        _ subjects: [LairSubject] = LairSubject.all, games: [LairGame] = LairGame.all
    ) -> [LairSubject] {
        subjects.filter { subject in games.contains { $0.subject == subject.id } }
    }

    /// A subject's games in catalog order, narrowed to one skill tag when a
    /// filter chip is on.
    public static func games(
        in subject: String, filter: String? = nil, from games: [LairGame] = LairGame.all
    ) -> [LairGame] {
        games.filter { $0.subject == subject && (filter.map($0.practices.contains) ?? true) }
    }

    /// The filter chips for a subject: the tags its games practice, in tag
    /// order — and none at all unless the subject has more than one game and
    /// the chips would offer more than one tag (one chip filtering one card is
    /// noise).
    public static func filterChips(
        for subject: String, games: [LairGame] = LairGame.all, tags: [LairSkillTag] = LairSkillTag.all
    ) -> [LairSkillTag] {
        let subjectGames = Self.games(in: subject, from: games)
        guard subjectGames.count > 1 else { return [] }
        let practised = Set(subjectGames.flatMap(\.practices))
        let chips = tags.filter { practised.contains($0.id) }
        return chips.count > 1 ? chips : []
    }

    /// After tapping a game card. `filter` is the skill chip that was on, which
    /// already says which operation the player wants.
    public static func pick(_ game: LairGame, filter: String? = nil) -> LairStep {
        if game.hasOwnPage || game.skills.isEmpty { return .play(game, nil) }
        if let filter, let op = BattleOp(rawValue: filter), game.skills.contains(op) {
            return pick(op, for: game)
        }
        if game.skills.count == 1 { return pick(game.skills[0], for: game) }
        return .chooseOperation(game)
    }

    /// After choosing an operation for a game.
    public static func pick(_ operation: BattleOp, for game: LairGame) -> LairStep {
        game.picksItsOwnNumber
            ? .play(game, LairFacts(operation: operation, number: nil))
            : .chooseNumber(game, operation)
    }

    /// After choosing a number: the game launches with exactly these facts.
    public static func pick(number: Int, operation: BattleOp, for game: LairGame) -> LairStep {
        .play(game, LairFacts(operation: operation, number: number))
    }
}
