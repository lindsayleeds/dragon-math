import GameRules
import Testing

private func game(_ id: String) throws -> LairGame {
    try #require(LairGame.named(id))
}

private func fake(
    _ id: String, subject: String = "math", skills: [BattleOp] = [], practices: [String] = [],
    ownPage: Bool = false
) -> LairGame {
    LairGame(
        id: id, subject: subject, name: id, emoji: "", description: "",
        skills: skills, practices: practices, hasOwnPage: ownPage, premium: false)
}

@Suite struct LairCatalogTests {
    @Test func everyGameHasAKnownSubject() {
        let subjects = Set(LairSubject.all.map(\.id))
        #expect(!LairGame.all.isEmpty)
        for game in LairGame.all {
            #expect(subjects.contains(game.subject), "\(game.id) is unreachable")
        }
    }

    @Test func practicesAreKnownTagsAndCoverSkills() {
        for game in LairGame.all {
            for tag in game.practices { #expect(LairSkillTag.named(tag) != nil, "\(game.id): \(tag)") }
            for op in game.skills { #expect(game.practices.contains(op.rawValue), "\(game.id): \(op)") }
        }
    }

    @Test func paidGamesAreMarked() throws {
        #expect(Set(LairGame.all.filter(\.premium).map(\.id))
            == ["dragon-munchers", "dragon-spelling", "proving-grounds"])
        #expect(try !game("dragon-egg-hatchery").premium)
    }

    @Test func subjectsAreTheFrontDoorInOrder() {
        #expect(Lair.stockedSubjects().map(\.id) == ["math", "spelling", "phonics", "memorize"])
    }

    @Test func aSubjectWithNoGamesIsNotStocked() {
        let stocked = Lair.stockedSubjects(games: [fake("a", subject: "phonics")])
        #expect(stocked.map(\.id) == ["phonics"])
    }

    @Test func gamesGroupBySubjectInCatalogOrder() {
        #expect(Lair.games(in: "math").map(\.id)
            == ["dragon-egg-hatchery", "dragon-munchers", "stepping-stones", "proving-grounds"])
        #expect(Lair.games(in: "spelling").map(\.id) == ["dragon-spelling"])
        #expect(Lair.games(in: "memorize").map(\.id) == ["dragon-memorize"])
    }

    @Test func aFilterNarrowsBySkillTag() {
        #expect(Lair.games(in: "math", filter: "div").map(\.id) == ["dragon-egg-hatchery", "proving-grounds"])
        #expect(Lair.games(in: "math", filter: "add").map(\.id) == ["dragon-egg-hatchery"])
    }
}

@Suite struct LairFilterChipTests {
    @Test func mathGetsOneChipPerOperation() {
        #expect(Lair.filterChips(for: "math").map(\.id) == ["add", "sub", "mul", "div"])
    }

    @Test func aOneGameSubjectGetsNoChips() {
        #expect(Lair.filterChips(for: "spelling").isEmpty)
        #expect(Lair.filterChips(for: "phonics").isEmpty)
        #expect(Lair.filterChips(for: "memorize").isEmpty)
    }

    @Test func twoGamesPractisingOneTagGetNoChips() {
        let games = [fake("a", practices: ["mul"]), fake("b", practices: ["mul"])]
        #expect(Lair.filterChips(for: "math", games: games).isEmpty)
    }

    @Test func twoGamesWithTwoTagsGetChips() {
        let games = [fake("a", practices: ["mul"]), fake("b", practices: ["div"])]
        #expect(Lair.filterChips(for: "math", games: games).map(\.id) == ["mul", "div"])
    }
}

@Suite struct LairFlowTests {
    @Test func aSelfContainedGameLaunchesWithoutFacts() throws {
        for id in ["proving-grounds", "dragon-spelling", "dragon-phonics", "dragon-memorize"] {
            let g = try game(id)
            #expect(Lair.pick(g) == .play(g, nil))
        }
    }

    @Test func aMultiSkillGameAsksForTheOperation() throws {
        let hatchery = try game("dragon-egg-hatchery")
        #expect(Lair.pick(hatchery) == .chooseOperation(hatchery))
    }

    @Test func theFilterChipAnswersTheOperation() throws {
        let hatchery = try game("dragon-egg-hatchery")
        #expect(Lair.pick(hatchery, filter: "sub") == .chooseNumber(hatchery, .sub))
        // A chip the game can't hand over (a literacy tag) doesn't count.
        #expect(Lair.pick(hatchery, filter: "spelling") == .chooseOperation(hatchery))
    }

    @Test func aOneSkillGameSkipsTheOperation() throws {
        let stones = try game("stepping-stones")
        #expect(Lair.pick(stones) == .chooseNumber(stones, .mul))
    }

    @Test func munchersNeedsNoNumber() throws {
        let munchers = try game("dragon-munchers")
        #expect(Lair.pick(munchers) == .play(munchers, LairFacts(operation: .mul, number: nil)))
    }

    @Test func theChosenFactsReachTheGame() throws {
        let hatchery = try game("dragon-egg-hatchery")
        guard case .chooseOperation(let g) = Lair.pick(hatchery) else {
            Issue.record("expected an operation step"); return
        }
        guard case .chooseNumber(let g2, let op) = Lair.pick(.div, for: g) else {
            Issue.record("expected a number step"); return
        }
        #expect(Lair.pick(number: 7, operation: op, for: g2)
            == .play(hatchery, LairFacts(operation: .div, number: 7)))
    }

    @Test func theNumberGridIsOneToTwelve() {
        #expect(Lair.numbers == Array(1...12))
    }
}
