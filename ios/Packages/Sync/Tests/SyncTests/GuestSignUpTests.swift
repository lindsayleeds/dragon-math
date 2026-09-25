import API
import Foundation
import Store
import Sync
import Testing

/// A kid plays as the guest, then a parent signs up and adds them (issue
/// #127, ADR 0003). Nothing about the guest leaves the device until the parent
/// has an account and agrees to move the guest's play to the new child; then
/// it goes up under that child with the parent's session.
@Suite struct GuestSignUpTests {
    static let childID = 42

    let store: SQLiteStore
    let server = FakeSyncServer()
    let session = SessionFlag(signedIn: false)

    init() throws {
        let clock = TickingClock()
        store = try .inMemory(now: { clock.now() })
        // A kid token for the child exists too; it must never be what's used here.
        server.kidTokens = ["kid-token": Self.childID]
    }

    var guest: Profile { store.guestProfile }

    func engine() -> SyncEngine {
        let session = session
        return SyncEngine(
            store: store,
            client: DragonAPIClient(baseURL: baseURL, transport: server) { "parent-jwt" },
            session: { session.signedIn ? .parent : .none },
            configuration: .init(retry: RetryPolicy(maxRetries: 1)),
            content: [],
            sleep: { _ in },
            random: { 0.5 })
    }

    func playAsGuest() async throws -> [StoredEvent] {
        [
            try await store.record(NodeWon(nodeID: 1, stars: 3), for: guest.id),
            try await store.record(NodeWon(nodeID: 2, stars: 2), for: guest.id),
            try await store.record(DragonsCollected(dragonIDs: [4]), for: guest.id),
        ]
    }

    /// Nothing the server saw mentions the guest: no uploads, no progress pulls.
    func expectNothingSent() {
        #expect(server.requests.isEmpty)
        #expect(server.progressRequests.isEmpty)
        #expect(server.appliedEvents.isEmpty)
    }

    @Test func beforeSignUpNothingAboutTheGuestLeavesTheDevice() async throws {
        let played = try await playAsGuest()

        // Signed out.
        #expect(await engine().syncNow().outcome == .noSession)
        expectNothingSent()

        // Signed in, but no child yet.
        session.signedIn = true
        #expect(await engine().syncNow().outcome == .finished)
        expectNothingSent()
        #expect(try await store.events(for: guest.id) == played)
    }

    @Test func movedGuestPlayUploadsUnderTheNewChildWithTheParentsSession() async throws {
        let played = try await playAsGuest()
        session.signedIn = true
        let child = try await store.saveChildProfile(remoteID: Self.childID, displayName: "New adventurer", avatar: "⚔️")

        try await store.moveGuestEvents(to: child.id)
        let report = await engine().syncNow()

        #expect(report.outcome == .finished)
        #expect(report.acknowledged == played.count)
        #expect(report.rejected == 0)
        #expect(server.requests.allSatisfy { $0.authorization == "Bearer parent-jwt" })
        // Every guest win is on the server under the new child, once.
        #expect(Set(server.appliedEvents.map { $0["id"] as! String }) == Set(played.map(\.id.uuidString)))
        #expect(server.appliedEvents.allSatisfy { $0["child_id"] as? Int == Self.childID })
        #expect(server.received.values.allSatisfy { $0 == 1 })
        #expect(server.progressRequests.map(\.childID) == [Self.childID])

        #expect(try await store.events(for: child.id).allSatisfy { $0.uploadState == .uploaded })
        #expect(try await store.progress(for: child.id) == ProfileProgress(
            nodesWon: [1, 2], stars: [1: 3, 2: 2], frontier: 3, dragons: [4: 1]))
        // The guest starts fresh, and its new play stays put.
        #expect(try await store.progress(for: guest.id) == ProfileProgress())
        try await store.record(NodeWon(nodeID: 1, stars: 1), for: guest.id)
        let again = await engine().syncNow()
        #expect(again.acknowledged == 0)
        #expect(server.appliedEvents.count == played.count)
    }

    @Test func decliningKeepsTheGuestsPlayOnTheDevice() async throws {
        let played = try await playAsGuest()
        session.signedIn = true
        let child = try await store.saveChildProfile(remoteID: Self.childID, displayName: "New adventurer", avatar: "⚔️")

        // The parent said no: no move.
        let report = await engine().syncNow()

        #expect(report.outcome == .finished)
        #expect(report.acknowledged == 0)
        #expect(server.requests.isEmpty)
        #expect(server.appliedEvents.isEmpty)
        #expect(try await store.events(for: guest.id) == played)
        #expect(try await store.events(for: child.id).isEmpty)
        #expect(try await store.progress(for: guest.id).nodesWon == [1, 2])
    }
}
