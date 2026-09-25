import GameRules
import Testing
@testable import DragonAcademy

/// The lair's routes carry what the player picked all the way to the game.
@Suite struct LairRouteTests {
    private func game(_ id: String) throws -> LairGame {
        try #require(LairGame.named(id))
    }

    @Test func eachStepBecomesItsScreen() throws {
        let hatchery = try game("dragon-egg-hatchery")
        let facts = LairFacts(operation: .mul, number: 6)
        #expect(LairRoute(.chooseOperation(hatchery)) == .facts(hatchery, operation: nil))
        #expect(LairRoute(.chooseNumber(hatchery, .sub)) == .facts(hatchery, operation: .sub))
        #expect(LairRoute(.play(hatchery, facts)) == .play(hatchery, facts))
    }

    @Test func tappingThroughTheFunnelHandsTheGameItsFacts() throws {
        // Math → Egg Hatchery → ÷ → 9, as the screens would push it.
        let hatchery = try game("dragon-egg-hatchery")
        var path: [Route] = [.lair(.subjects)]
        let math = try #require(Lair.stockedSubjects().first { $0.id == "math" })
        path.append(.lair(.games(math)))
        path.append(.lair(LairRoute(Lair.pick(hatchery))))
        path.append(.lair(LairRoute(Lair.pick(.div, for: hatchery))))
        path.append(.lair(LairRoute(Lair.pick(number: 9, operation: .div, for: hatchery))))

        guard case .lair(.play(let launched, let facts)) = path.last else {
            Issue.record("the funnel didn't end on a game"); return
        }
        let expected = LairFacts(operation: .div, number: 9)
        #expect(launched == hatchery)
        #expect(facts == expected)
        #expect(LairGameDestination(game: launched, facts: facts) == .eggHatchery(expected))
    }

    @Test func aSelfContainedGameLaunchesStraightFromItsCard() throws {
        let spelling = try game("dragon-spelling")
        #expect(LairRoute(Lair.pick(spelling)) == .play(spelling, nil))
        #expect(LairGameDestination(game: spelling, facts: nil) == .spelling)
    }

    @Test func provingGroundsOpensTheDrillStraightFromItsCard() throws {
        let proving = try game("proving-grounds")
        let route = LairRoute(Lair.pick(proving))
        #expect(route == .play(proving, nil))
        #expect(LairGameDestination(game: proving, facts: nil) == .provingGrounds)
    }

    @Test func phonicsOpensStraightFromItsCard() throws {
        let phonics = try game("dragon-phonics")
        #expect(LairRoute(Lair.pick(phonics)) == .play(phonics, nil))
        #expect(LairGameDestination(game: phonics, facts: nil) == .phonics)
    }

    @Test func memorizeOpensStraightFromItsCard() throws {
        let memorize = try game("dragon-memorize")
        let route = LairRoute(Lair.pick(memorize))
        #expect(route == .play(memorize, nil))
        #expect(LairGameDestination(game: memorize, facts: nil) == .memorize)
    }

    @Test func theEggHatcheryNeedsItsNumber() throws {
        let hatchery = try game("dragon-egg-hatchery")
        let facts = LairFacts(operation: .sub, number: 4)
        #expect(LairGameDestination(game: hatchery, facts: facts) == .eggHatchery(facts))
        // A route without a number can't start a round.
        let noNumber = LairFacts(operation: .sub, number: nil)
        #expect(LairGameDestination(game: hatchery, facts: noNumber) == .comingSoon(hatchery, noNumber))
        #expect(LairGameDestination(game: hatchery, facts: nil) == .comingSoon(hatchery, nil))
    }

    @Test func steppingStonesSkipCountsByThePickedNumber() throws {
        let stones = try game("stepping-stones")
        // One skill (×), so the card goes straight to the number grid.
        #expect(LairRoute(Lair.pick(stones)) == .facts(stones, operation: .mul))
        let facts = LairFacts(operation: .mul, number: 7)
        #expect(LairRoute(Lair.pick(number: 7, operation: .mul, for: stones)) == .play(stones, facts))
        #expect(LairGameDestination(game: stones, facts: facts) == .steppingStones(baseNumber: 7))
        #expect(LairGameDestination(game: stones, facts: nil) == .comingSoon(stones, nil))
    }

    @Test func leavingAGameReturnsToTheLairFrontDoor() throws {
        let stones = try game("stepping-stones")
        let math = try #require(LairSubject.all.first)
        let path: [Route] = [
            .lair(.subjects), .lair(.games(math)), .lair(.facts(stones, operation: .mul)),
            .lair(.play(stones, LairFacts(operation: .mul, number: 3))),
        ]
        #expect(RootView.backToLair(path) == [.lair(.subjects)])
        #expect(RootView.backToLair([.battle(nodeID: 1)]) == [])
    }
}
