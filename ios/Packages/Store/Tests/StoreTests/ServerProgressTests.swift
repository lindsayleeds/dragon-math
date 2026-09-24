import Foundation
import Store
import Testing

/// Derived progress once Sync has saved what the server has from the child's
/// other devices: the union of both, with nothing counted twice.
@Suite struct ServerProgressTests {
    let store: SQLiteStore
    let child: Profile

    init() async throws {
        let clock = TickingClock()
        store = try .inMemory(now: { clock.now() })
        child = try await store.addChildProfile(remoteID: 42, displayName: "Ada")
    }

    /// What Sync does after an upload: note what the server has
    /// acknowledged, then save the server's progress as covering it.
    func pull(_ server: ServerProgress) async throws {
        let covered = try await store.uploadedEventsNotInServerProgress(for: child.id)
        try await store.saveServerProgress(server, for: child.id, covering: covered)
    }

    func upload(_ events: [StoredEvent]) async throws {
        try await store.markUploaded(events.map(\.id))
    }

    @Test func mergesWinsStarsAndTheFrontier() async throws {
        try await store.record(NodeWon(nodeID: 1, stars: 1), for: child.id)
        try await store.record(NodeWon(nodeID: 4), for: child.id)
        try await store.record(NodeWon(nodeID: 5, stars: 3), for: child.id)

        try await pull(ServerProgress(
            currentNodeID: 3, stars: [1: 3, 2: 0, 5: 2], dragons: [7: 2], playMinutes: 12))

        #expect(try await store.progress(for: child.id) == ProfileProgress(
            nodesWon: [1, 2, 4, 5], stars: [1: 3, 2: 0, 5: 3], frontier: 6, dragons: [7: 2], playMinutes: 12))
    }

    @Test func theServerFrontierCanBeAhead() async throws {
        try await store.record(NodeWon(nodeID: 1, stars: 2), for: child.id)
        try await pull(ServerProgress(currentNodeID: 9))
        #expect(try await store.progress(for: child.id).frontier == 9)
    }

    @Test func aProfileWithNothingStartsAtNodeOne() async throws {
        #expect(try await store.progress(for: child.id) == ProfileProgress(frontier: 1))
        try await pull(ServerProgress())
        #expect(try await store.progress(for: child.id) == ProfileProgress(frontier: 1))
    }

    @Test func dragonsAlreadyInTheServerTotalAreNotCountedTwice() async throws {
        let caught = [
            try await store.record(DragonsCollected(dragonIDs: [5, 5]), for: child.id),
            try await store.record(DragonsCollected(dragonIDs: [6]), for: child.id),
        ]
        #expect(try await store.progress(for: child.id).dragons == [5: 2, 6: 1])

        try await upload(caught)
        // The server has these and one more dragon 5 from the other device.
        try await pull(ServerProgress(dragons: [5: 3, 6: 1]))
        #expect(try await store.progress(for: child.id).dragons == [5: 3, 6: 1])

        // A new catch counts on top until a later pull includes it.
        let more = try await store.record(DragonsCollected(dragonIDs: [5]), for: child.id)
        #expect(try await store.progress(for: child.id).dragons == [5: 4, 6: 1])
        try await upload([more])
        #expect(try await store.progress(for: child.id).dragons == [5: 4, 6: 1])
        try await pull(ServerProgress(dragons: [5: 4, 6: 1]))
        #expect(try await store.progress(for: child.id).dragons == [5: 4, 6: 1])
    }

    @Test func anUploadWhosePullFailedStillCountsLocally() async throws {
        try await pull(ServerProgress(dragons: [1: 1]))
        let caught = try await store.record(DragonsCollected(dragonIDs: [2]), for: child.id)
        try await upload([caught])
        // No pull since: the saved server progress predates this catch.
        #expect(try await store.progress(for: child.id).dragons == [1: 1, 2: 1])
    }

    @Test func coversOnlyThisProfilesUploadedEvents() async throws {
        let other = try await store.addChildProfile(remoteID: 43, displayName: "Bo")
        let uploaded = try await store.record(DragonsCollected(dragonIDs: [1]), for: child.id)
        let pending = try await store.record(DragonsCollected(dragonIDs: [2]), for: child.id)
        let theirs = try await store.record(DragonsCollected(dragonIDs: [3]), for: other.id)
        try await upload([uploaded, theirs])

        #expect(try await store.uploadedEventsNotInServerProgress(for: child.id) == [uploaded.id])
        // Even if told otherwise, a pending event or another profile's isn't covered.
        try await store.saveServerProgress(
            ServerProgress(dragons: [1: 1]), for: child.id, covering: [uploaded.id, pending.id, theirs.id])

        #expect(try await store.uploadedEventsNotInServerProgress(for: child.id).isEmpty)
        #expect(try await store.uploadedEventsNotInServerProgress(for: other.id) == [theirs.id])
        #expect(try await store.progress(for: child.id).dragons == [1: 1, 2: 1])
        #expect(try await store.progress(for: other.id).dragons == [3: 1])
    }

    @Test func aNewPullReplacesTheLast() async throws {
        try await pull(ServerProgress(currentNodeID: 3, stars: [1: 1, 2: 2], dragons: [1: 1], playMinutes: 4))
        try await pull(ServerProgress(currentNodeID: 4, stars: [1: 2, 3: 1], dragons: [2: 1], playMinutes: 9))
        #expect(try await store.progress(for: child.id) == ProfileProgress(
            nodesWon: [1, 3], stars: [1: 2, 3: 1], frontier: 4, dragons: [2: 1], playMinutes: 9))
    }

    @Test func observersSeeAPull() async throws {
        var updates = store.observeProgress(for: child.id).makeAsyncIterator()
        #expect(try await updates.next() == ProfileProgress())
        try await pull(ServerProgress(currentNodeID: 2, stars: [1: 3]))
        #expect(try await updates.next() == ProfileProgress(nodesWon: [1], stars: [1: 3]))
    }

    @Test func dragonsCollectedIsStoredAsUploaded() async throws {
        let event = try await store.record(DragonsCollected(dragonIDs: [4, 4, 9]), for: child.id)
        #expect(String(decoding: event.payload, as: UTF8.self) == #"{"dragonIds":[4,4,9]}"#)
        #expect(event.kind == "dragons.collected")
    }
}
