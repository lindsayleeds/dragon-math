import Foundation
import GameRules
import Store
import Testing
@testable import DragonAcademy

struct MapScreenTests {
    /// The map reads its locks from the Store's derived progress.
    @Test func progressComesFromTheStoresWins() async throws {
        let store = try SQLiteStore.inMemory()
        let guest = store.guestProfile.id
        try await store.record(NodeWon(nodeID: 1, stars: 3), for: guest)
        try await store.record(NodeWon(nodeID: 2, stars: 1), for: guest)

        var updates = store.observeProgress(for: guest).makeAsyncIterator()
        let progress = MapProgress(try #require(try await updates.next()))

        #expect(progress.state(of: 1) == .won)
        #expect(progress.state(of: 2) == .won)
        #expect(progress.state(of: 3) == .available)
        #expect(progress.state(of: 4) == .locked)
        #expect(progress.current?.id == 3)
    }

    @Test func aFrontierFromTheServerUnlocksUpToIt() {
        let progress = MapProgress(ProfileProgress(nodesWon: [1], frontier: 9))
        #expect(progress.state(of: 8) == .won)
        #expect(progress.state(of: 9) == .available)
        #expect(progress.current?.id == 9)
    }

    @Test func theLayoutFillsTheWidth() throws {
        let layout = MapLayout(width: 200)
        #expect(layout.scale == 0.5)
        #expect(layout.size == CGSize(width: 200, height: 2350))
        // Node 1 (200, 5640) is 4640 below the map's top edge (y 1000).
        let node1 = try #require(GameMap.node(1))
        #expect(layout.point(node1.position) == CGPoint(x: 100, y: 2320))
        let world1 = GameMap.worlds[0]
        #expect(layout.frame(world1.background) == CGRect(x: 0, y: 1902.5, width: 200, height: 447.5))
    }

    @Test func scrollingCentersANodeButStaysOnTheMap() throws {
        let layout = MapLayout(width: 400)
        // Map units are points at this width, so the offsets are whole numbers
        // up to floating-point noise.
        func near(_ a: CGFloat, _ b: CGFloat) -> Bool { abs(a - b) < 0.001 }
        let middle = try #require(GameMap.node(20))
        #expect(near(layout.scrollOffset(centering: middle, viewportHeight: 800), 3510 - 1000 - 400))
        let first = try #require(GameMap.node(1))
        #expect(near(layout.scrollOffset(centering: first, viewportHeight: 800), 4700 - 800))
        let last = try #require(GameMap.node(41))
        #expect(near(layout.scrollOffset(centering: last, viewportHeight: 800), 0))
    }
}
