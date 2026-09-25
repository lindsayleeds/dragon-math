import GameRules
import Testing

@Suite struct MapDataTests {
    @Test func theMapHasFiveWorldsAnd41Nodes() {
        #expect(GameMap.worlds.map(\.id) == [1, 2, 3, 4, 5])
        #expect(GameMap.nodes.map(\.id) == Array(1...41))
        #expect(GameMap.worlds.map(\.nodeIDs) == [1...8, 9...16, 17...25, 26...33, 34...41])
    }

    @Test func eachWorldEndsWithItsBossAndOnlyThere() {
        #expect(GameMap.nodes.filter(\.isBoss).map(\.id) == [8, 16, 25, 33, 41])
        for world in GameMap.worlds {
            let nodes = GameMap.nodes(in: world)
            #expect(nodes.last?.isBoss == true)
            #expect(nodes.dropLast().allSatisfy { !$0.isBoss })
            #expect(nodes.allSatisfy { $0.worldID == world.id })
        }
    }

    @Test func everyBossHasItsArtAndRegularNodesHaveNone() {
        #expect(GameMap.nodes.filter(\.isBoss).map(\.bossArt) == [
            "BossForestDragon", "BossSunfireDragon", "BossCrystalDragon", "BossSakuraDragon", "BossStormDragon",
        ])
        #expect(GameMap.nodes.filter { !$0.isBoss }.allSatisfy { $0.bossArt == nil })
    }

    @Test func worldsFollowTheNodeRanges() {
        #expect([1, 8, 9, 16, 17, 25, 26, 33, 34, 41].map { GameMap.world(forNode: $0)?.id }
            == [1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
        #expect(GameMap.world(forNode: 42) == nil)
        #expect(GameMap.world(forNode: 0) == nil)
    }

    /// The bands stack edge to edge from the bottom of the map up, the art
    /// tiles cover their band exactly, and every node and heading sits inside.
    @Test func worldsTileTheMap() {
        #expect(GameMap.top == 1000)
        #expect(GameMap.bottom == 5700)
        for (lower, upper) in zip(GameMap.worlds, GameMap.worlds.dropFirst()) {
            #expect(lower.bandTop == upper.bandBottom)
        }
        for world in GameMap.worlds {
            for tile in [world.background, world.road] {
                #expect(tile.top == world.bandTop)
                #expect(tile.height == world.bandBottom - world.bandTop)
            }
            #expect(world.background.name == "MapWorld\(world.id)Background")
            #expect(world.road.name == "MapWorld\(world.id)Road")
            #expect((world.bandTop...world.bandBottom).contains(world.chapterCenter.y))
            for node in GameMap.nodes(in: world) {
                #expect((world.bandTop...world.bandBottom).contains(node.position.y))
                #expect((0...GameMap.width).contains(node.position.x))
            }
        }
    }

    @Test func theJourneyClimbsTheMap() {
        let ys = GameMap.nodes.map(\.position.y)
        #expect(zip(ys, ys.dropFirst()).allSatisfy { $0 > $1 })
        #expect(GameMap.node(1)?.label == "Meadow Gate")
        #expect(GameMap.node(41)?.label == "Storm Dragon")
        #expect(GameMap.worlds.map(\.chapterHeading) == [
            "~ chapter one ~", "~ chapter two ~", "~ chapter three ~", "~ chapter four ~", "~ chapter five ~",
        ])
    }

    @Test func aNodesBattleIsItsBuiltInConfig() throws {
        for node in GameMap.nodes {
            #expect(node.battleConfig == BattleConfig.defaults[node.id])
            #expect(node.battleLayout == BattleLayout.forConfig(node.battleConfig, fallbackWorldId: node.worldID))
        }
        let boss = try #require(GameMap.node(41))
        #expect(boss.battleConfig == BattleConfig(ops: [.add, .sub, .mul], min: 2, max: 15, aiSeconds: 3.0))
    }
}

@Suite struct MapProgressTests {
    @Test func aNewPlayerCanOnlyPlayTheFirstNode() {
        let progress = MapProgress()
        #expect(progress.state(of: 1) == .available)
        #expect(GameMap.nodes.dropFirst().allSatisfy { progress.state(of: $0.id) == .locked })
        #expect(progress.canPlay(1))
        #expect(!progress.canPlay(2))
        #expect(progress.current?.id == 1)
        #expect(progress.wonCount == 0)
    }

    @Test func winningANodeUnlocksTheNext() {
        let progress = MapProgress(nodesWon: [1, 2], frontier: 3)
        #expect(progress.state(of: 1) == .won)
        #expect(progress.state(of: 2) == .won)
        #expect(progress.state(of: 3) == .available)
        #expect(progress.state(of: 4) == .locked)
        #expect(progress.current?.id == 3)
        #expect(progress.focus?.id == 3)
        #expect(progress.wonCount == 2)
    }

    /// A frontier placed ahead (the Dragon's Trial, or another device's
    /// progress) counts the nodes before it as behind the player, as on the
    /// web.
    @Test func nodesBeforeAPlacedFrontierArePassed() {
        let progress = MapProgress(nodesWon: [], frontier: 17)
        #expect((1...16).allSatisfy { progress.state(of: $0) == .won && progress.canPlay($0) })
        #expect(progress.state(of: 17) == .available)
        #expect(progress.state(of: 18) == .locked)
        #expect(progress.current?.id == 17)
        #expect(progress.wonCount == 16)
    }

    /// A node won out of order (e.g. on the web, from an older frontier rule)
    /// stays won even past the frontier.
    @Test func aWinPastTheFrontierStaysWon() {
        let progress = MapProgress(nodesWon: [1, 5], frontier: 2)
        #expect(progress.state(of: 5) == .won)
        #expect(progress.state(of: 3) == .locked)
    }

    @Test func theBossUnlocksAfterTheWorldsLastRegularNode() {
        #expect(MapProgress(nodesWon: Set(1...6), frontier: 7).state(of: 8) == .locked)
        #expect(MapProgress(nodesWon: Set(1...7), frontier: 8).state(of: 8) == .available)
        #expect(MapProgress(nodesWon: Set(1...8), frontier: 9).state(of: 9) == .available)
    }

    @Test func aFinishedMapHasNoCurrentNodeAndFocusesTheLastBoss() {
        let progress = MapProgress(nodesWon: Set(1...41), frontier: 42)
        #expect(progress.current == nil)
        #expect(progress.focus?.id == 41)
        #expect(progress.wonCount == 41)
        #expect(GameMap.nodes.allSatisfy { progress.canPlay($0.id) })
    }
}
