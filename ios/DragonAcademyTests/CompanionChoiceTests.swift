import Foundation
import GameRules
import Store
import Testing
@testable import DragonAcademy

@MainActor
struct CompanionChoiceTests {
    let store: SQLiteStore
    let guest: Profile.ID
    let syncRequests = SyncCounter()

    init() throws {
        store = try SQLiteStore.inMemory()
        guest = store.guestProfile.id
    }

    @MainActor final class SyncCounter {
        var count = 0
    }

    @Test func pipUntilAnotherIsChosen() async throws {
        #expect(try await CompanionChoice.current(in: store, for: guest) == .pip)
        #expect(try await CompanionChoice.current(in: nil, for: nil) == .pip)
    }

    @Test func aChoicePersistsAsAQueuedEventAndRequestsASync() async throws {
        try await store.record(NodeWon(nodeID: 8, stars: 3), for: guest)
        let forest = Companion.named("forest_dragon")
        let counter = syncRequests

        let recorded = try await CompanionChoice.choose(
            forest, in: store, for: guest, requestSync: { counter.count += 1 })

        #expect(recorded)
        #expect(counter.count == 1)
        #expect(try await CompanionChoice.current(in: store, for: guest) == forest)
        let event = try #require(try await store.events(for: guest).last)
        #expect(event.uploadState == .pending)
        #expect(try event.decode(CompanionChosen.self) == CompanionChosen(companionID: "forest_dragon"))
    }

    @Test func aCompanionNotYetBefriendedCantBeChosen() async throws {
        let counter = syncRequests
        let recorded = try await CompanionChoice.choose(
            .named("storm_dragon"), in: store, for: guest, requestSync: { counter.count += 1 })
        #expect(!recorded)
        #expect(counter.count == 0)
        #expect(try await store.events(for: guest).isEmpty)
    }

    @Test func choosingTheCurrentCompanionRecordsNothing() async throws {
        let recorded = try await CompanionChoice.choose(.pip, in: store, for: guest, requestSync: {})
        #expect(!recorded)
        #expect(try await store.events(for: guest).isEmpty)
    }

    @Test func theLatestChoiceWinsAndAnUnbefriendedOneFallsBackToPip() {
        #expect(CompanionChoice.current(in: ProfileProgress(nodesWon: [8, 16], companionID: "sunfire_dragon")).id
            == "sunfire_dragon")
        #expect(CompanionChoice.current(in: ProfileProgress(nodesWon: [8], companionID: "sunfire_dragon")) == .pip)
        #expect(CompanionChoice.current(in: ProfileProgress(companionID: "not_a_dragon")) == .pip)
    }
}
