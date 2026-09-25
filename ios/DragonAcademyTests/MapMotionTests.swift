import Foundation
import GameRules
import Testing
@testable import DragonAcademy

struct MapMotionTests {
    @Test func theTrailRunsFromTheFirstNodeToTheFrontier() {
        let layout = MapLayout(width: 400)
        let progress = MapProgress(nodesWon: [1, 2, 3, 4], frontier: 5)
        #expect(MapTrail.nodes(for: progress).map(\.id) == [1, 2, 3, 4, 5])
        let expected = (1...5).compactMap(GameMap.node).map { layout.point($0.position) }
        #expect(MapTrail.points(for: progress, in: layout) == expected)
    }

    @Test func aNewPlayersTrailIsOnlyTheFirstNode() {
        #expect(MapTrail.nodes(for: MapProgress()).map(\.id) == [1])
    }

    @Test func theTrailCoversTheWholeRoadOnceEverythingIsWon() {
        let progress = MapProgress(nodesWon: Set(GameMap.nodes.map(\.id)), frontier: GameMap.nodes.count + 1)
        #expect(MapTrail.nodes(for: progress).map(\.id) == GameMap.nodes.map(\.id))
    }

    @Test func onlyTheCurrentNodeAndTheBossAheadMove() throws {
        let progress = MapProgress(nodesWon: [1, 2, 3, 4], frontier: 5)
        let moving = GameMap.nodes.filter { !MapNodeMotion.of($0, in: progress, reduceMotion: false).isEmpty }
        #expect(moving.map(\.id) == [5, 8])
        #expect(MapNodeMotion.of(try #require(GameMap.node(5)), in: progress, reduceMotion: false) == [.bob, .pulse])
        #expect(MapNodeMotion.of(try #require(GameMap.node(8)), in: progress, reduceMotion: false) == .bossIdle)
    }

    @Test func aBossOnTheFrontierHopsPulsesAndIdles() throws {
        let progress = MapProgress(nodesWon: Set(1...7), frontier: 8)
        let boss = try #require(GameMap.node(8))
        #expect(MapNodeMotion.of(boss, in: progress, reduceMotion: false) == [.bob, .pulse, .bossIdle])
    }

    @Test func reduceMotionStillsEveryNode() {
        for frontier in [1, 5, 8, 41] {
            let progress = MapProgress(nodesWon: Set(1..<frontier), frontier: frontier)
            for node in GameMap.nodes {
                #expect(MapNodeMotion.of(node, in: progress, reduceMotion: true).isEmpty)
            }
        }
    }
}
