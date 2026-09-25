import Foundation
import Store
import Testing

/// A parent signs up and adds their first child, and agrees to give the
/// guest's play to them (issue #127, ADR 0003).
@Suite struct GuestMoveTests {
    let store: SQLiteStore

    init() throws {
        let clock = TickingClock()
        store = try .inMemory(now: { clock.now() })
    }

    var guest: Profile { store.guestProfile }

    /// What a guest might have done before anyone signed up.
    func playAsGuest() async throws -> [StoredEvent] {
        [
            try await store.record(NodeWon(nodeID: 1, stars: 3), for: guest.id),
            try await store.record(DragonsCollected(dragonIDs: [4, 7]), for: guest.id),
            try await store.record(NodeWon(nodeID: 2, stars: 1), for: guest.id),
            try await store.record(
                ProvingMedalEarned(mode: "mul", digit: 7, medal: "silver", elapsedMs: 41_000, wrongCount: 1),
                for: guest.id),
        ]
    }

    @Test func theGuestsEventsBecomeTheChildsAndTheGuestStartsFresh() async throws {
        let played = try await playAsGuest()
        let guestProgress = try await store.progress(for: guest.id)
        let child = try await store.saveChildProfile(remoteID: 42, displayName: "New adventurer", avatar: "⚔️")

        let moved = try await store.moveGuestEvents(to: child.id)

        #expect(moved == played.count)
        // Same events (ids, payloads, times), in order, still waiting to upload.
        let childEvents = try await store.events(for: child.id)
        #expect(childEvents.map(\.id) == played.map(\.id))
        #expect(childEvents.map(\.payload) == played.map(\.payload))
        #expect(childEvents.map(\.occurredAt) == played.map(\.occurredAt))
        #expect(childEvents.allSatisfy { $0.profileID == child.id && $0.uploadState == .pending })
        let kinds: Set<EventKind> = [NodeWon.kind, DragonsCollected.kind, ProvingMedalEarned.kind]
        #expect(try await store.pendingEvents(for: child.id, kinds: kinds, limit: 10).map(\.id) == played.map(\.id))

        // The progress moves with them.
        #expect(try await store.progress(for: child.id) == guestProgress)
        #expect(guestProgress.nodesWon == [1, 2])
        #expect(guestProgress.dragons == [4: 1, 7: 1])
        #expect(guestProgress.provingBests["mul-7"] == ProvingBest(medal: "silver", bestMs: 41_000))

        // The guest has nothing left.
        #expect(try await store.events(for: guest.id).isEmpty)
        #expect(try await store.progress(for: guest.id) == ProfileProgress())
        #expect(try await store.profiles().map(\.id) == [guest.id, child.id])
    }

    @Test func theChildKeepsTheirOwnEventsToo() async throws {
        let child = try await store.saveChildProfile(remoteID: 42, displayName: "sparky", avatar: nil)
        let own = try await store.record(NodeWon(nodeID: 5, stars: 2), for: child.id)
        let played = try await playAsGuest()

        try await store.moveGuestEvents(to: child.id)

        #expect(Set(try await store.events(for: child.id).map(\.id)) == Set(played.map(\.id) + [own.id]))
        #expect(try await store.progress(for: child.id).nodesWon == [1, 2, 5])
    }

    @Test func aSiblingsEventsStayTheirs() async throws {
        let ada = try await store.saveChildProfile(remoteID: 1, displayName: "sparky", avatar: nil)
        let bo = try await store.saveChildProfile(remoteID: 2, displayName: "ember", avatar: nil)
        let boWin = try await store.record(NodeWon(nodeID: 9), for: bo.id)
        _ = try await playAsGuest()

        try await store.moveGuestEvents(to: ada.id)

        #expect(try await store.events(for: bo.id) == [boWin])
    }

    @Test func playAfterTheMoveStaysWithTheGuest() async throws {
        _ = try await playAsGuest()
        let child = try await store.saveChildProfile(remoteID: 42, displayName: "sparky", avatar: nil)
        try await store.moveGuestEvents(to: child.id)

        let later = try await store.record(NodeWon(nodeID: 1), for: guest.id)

        #expect(try await store.events(for: guest.id) == [later])
        #expect(try await store.events(for: child.id).count == 4)
        // Nothing to move a second time but the new play.
        #expect(try await store.moveGuestEvents(to: child.id) == 1)
    }

    @Test func movesOnlyToAChildProfile() async throws {
        let played = try await playAsGuest()

        await #expect(throws: StoreError.notAChildProfile(guest.id)) {
            try await store.moveGuestEvents(to: guest.id)
        }
        let unknown = UUID()
        await #expect(throws: StoreError.notAChildProfile(unknown)) {
            try await store.moveGuestEvents(to: unknown)
        }
        #expect(try await store.events(for: guest.id) == played)
    }

    @Test func withNoGuestPlayNothingMoves() async throws {
        let child = try await store.saveChildProfile(remoteID: 42, displayName: "sparky", avatar: nil)
        #expect(try await store.moveGuestEvents(to: child.id) == 0)
        #expect(try await store.events(for: child.id).isEmpty)
    }
}
