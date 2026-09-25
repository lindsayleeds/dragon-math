import GameRules
import SwiftUI
import Testing
@testable import DragonAcademy

/// The iPad map's detail panel (#135): which layout each size class gets,
/// what the panel says about a node, and where its Play button goes.
struct MapDetailTests {
    /// Nodes 1 and 2 won (3 and 1 stars), node 3 up next, 4 on locked.
    private let progress = MapProgress(nodesWon: [1, 2], frontier: 3)
    private let stars = [1: 3, 2: 1]

    private func node(_ id: Int) throws -> MapNode { try #require(GameMap.node(id)) }

    // MARK: Layout

    @Test func aRegularWidthGetsThePanel() {
        #expect(MapArrangement.forSizeClass(.regular) == .withDetailPanel)
    }

    @Test func compactAndUnknownWidthsKeepTheIPhoneMap() {
        // iPhone, a narrow Split View or Slide Over, a small Stage Manager window.
        #expect(MapArrangement.forSizeClass(.compact) == .mapOnly)
        #expect(MapArrangement.forSizeClass(nil) == .mapOnly)
    }

    @Test func onTheIPhoneMapATapPlaysUnlessLocked() throws {
        let map = MapArrangement.mapOnly
        #expect(map.tap(try node(1), progress: progress) == .play(nodeID: 1))
        #expect(map.tap(try node(3), progress: progress) == .play(nodeID: 3))
        #expect(map.tap(try node(4), progress: progress) == .ignore)
    }

    @Test func besideThePanelATapSelectsEvenALockedNode() throws {
        let panel = MapArrangement.withDetailPanel
        #expect(panel.tap(try node(1), progress: progress) == .select(nodeID: 1))
        #expect(panel.tap(try node(3), progress: progress) == .select(nodeID: 3))
        #expect(panel.tap(try node(4), progress: progress) == .select(nodeID: 4))
    }

    // MARK: Detail content

    @Test func aLockedNodeHasNoStarsAndNoPlay() throws {
        let detail = MapNodeDetail(node: try node(4), progress: progress, stars: stars)
        #expect(detail.node.id == 4)
        #expect(detail.world?.id == 1)
        #expect(detail.status == .locked)
        #expect(detail.stars == nil)
        #expect(detail.play == nil)
    }

    @Test func anUnlockedNodeCanBePlayedWithNoStarsYet() throws {
        let detail = MapNodeDetail(node: try node(3), progress: progress, stars: stars)
        #expect(detail.status == .unlocked)
        #expect(detail.stars == nil)
        #expect(detail.play == .play(nodeID: 3))
    }

    @Test func aCompleteNodeShowsItsBestStarsAndCanBeReplayed() throws {
        let first = MapNodeDetail(node: try node(1), progress: progress, stars: stars)
        #expect(first.status == .complete)
        #expect(first.stars == 3)
        #expect(first.play == .play(nodeID: 1))
        #expect(MapNodeDetail(node: try node(2), progress: progress, stars: stars).stars == 1)
    }

    @Test func aCompleteNodeWithoutRecordedStarsShowsNone() throws {
        // Passed over by a Dragon's Trial placement: complete, never won here.
        let placed = MapProgress(nodesWon: [], frontier: 9)
        let detail = MapNodeDetail(node: try node(5), progress: placed, stars: [:])
        #expect(detail.status == .complete)
        #expect(detail.stars == nil)
        #expect(detail.play == .play(nodeID: 5))
    }

    @Test func theNodesNameAndWorldComeFromTheMap() throws {
        let boss = try #require(GameMap.nodes.first { $0.isBoss })
        let detail = MapNodeDetail(node: boss, progress: progress, stars: stars)
        #expect(detail.node.label == boss.label)
        #expect(detail.world == GameMap.world(forNode: boss.id))
        #expect(detail.node.isBoss)
    }

    @Test func beforeAnyTapThePanelShowsTheCurrentNode() throws {
        #expect(MapNodeDetail(selected: nil, progress: progress, stars: stars)?.node.id == 3)
        #expect(MapNodeDetail(selected: 7, progress: progress, stars: stars)?.node.id == 7)
        // The whole map won: the last node.
        let done = MapProgress(nodesWon: Set(GameMap.nodes.map(\.id)), frontier: GameMap.nodes.count + 1)
        #expect(MapNodeDetail(selected: nil, progress: done, stars: [:])?.node.id == GameMap.nodes.last?.id)
    }

    // MARK: Play routing

    @Test func thePanelsPlayGoesWhereTheIPhoneTapGoes() throws {
        for id in [1, 3] {
            let n = try node(id)
            let detail = MapNodeDetail(node: n, progress: progress, stars: stars)
            #expect(detail.play == MapArrangement.mapOnly.tap(n, progress: progress))
        }
    }
}
