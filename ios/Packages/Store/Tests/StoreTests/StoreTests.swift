import Foundation
import Store
import Testing

/// A clock the test advances by hand, one second per read.
final class TickingClock: @unchecked Sendable {
    private let lock = NSLock()
    private var next = Date(timeIntervalSince1970: 1_800_000_000)

    func now() -> Date {
        lock.withLock {
            defer { next += 1 }
            return next
        }
    }
}

/// A payload kind the Store has never heard of, to prove kinds are open.
struct HintUsed: EventPayload, Equatable {
    static let kind: EventKind = "test.hint-used"
    let problem: String
    let hintsLeft: Int
}

@Test func moduleIsLinked() {
    #expect(StoreModule.name == "Store")
}

@Suite struct InMemoryStore {
    let clock = TickingClock()
    let store: SQLiteStore

    init() throws {
        let clock = clock
        store = try .inMemory(now: { clock.now() })
    }

    @Test func createsOneGuestProfile() async throws {
        #expect(store.guestProfile.kind == .guest)
        #expect(store.guestProfile.remoteID == nil)
        #expect(try await store.profiles() == [store.guestProfile])
    }

    @Test func addsChildProfilesOncePerRemoteID() async throws {
        let child = try await store.addChildProfile(remoteID: 42, displayName: "Ada")
        let again = try await store.addChildProfile(remoteID: 42, displayName: "Ada")
        #expect(child.kind == .child)
        #expect(child.remoteID == 42)
        #expect(again == child)
        #expect(try await store.profiles() == [store.guestProfile, child])
    }

    @Test func keepsEachChildsTelemetrySetting() async throws {
        let ada = try await store.addChildProfile(remoteID: 42, displayName: "Ada")
        let bo = try await store.addChildProfile(remoteID: 43, displayName: "Bo")
        #expect(!ada.telemetryOptOut)

        try await store.setTelemetryOptOut(true, for: ada.id)
        var profiles = try await store.profiles()
        #expect(profiles.first { $0.id == ada.id }?.telemetryOptOut == true)
        #expect(profiles.first { $0.id == bo.id }?.telemetryOptOut == false)
        // Adding the child again (the parent view reloading) keeps the setting.
        #expect(try await store.addChildProfile(remoteID: 42, displayName: "Ada").telemetryOptOut)

        try await store.setTelemetryOptOut(false, for: ada.id)
        profiles = try await store.profiles()
        #expect(profiles.first { $0.id == ada.id }?.telemetryOptOut == false)
    }

    @Test func savingAChildProfileUpdatesItsNameAndAvatarButNotItsIdentity() async throws {
        let added = try await store.addChildProfile(remoteID: 42, displayName: "New adventurer")
        let won = try await store.record(NodeWon(nodeID: 3), for: added.id)

        let renamed = try await store.saveChildProfile(remoteID: 42, displayName: "sparky", avatar: "🐉")
        #expect(renamed.id == added.id)
        #expect(renamed.createdAt == added.createdAt)
        #expect(renamed.displayName == "sparky")
        #expect(renamed.avatar == "🐉")
        #expect(try await store.profiles() == [store.guestProfile, renamed])
        #expect(try await store.events(for: renamed.id) == [won])
        // A parent's telemetry setting survives a rename.
        try await store.setTelemetryOptOut(true, for: added.id)
        #expect(try await store.saveChildProfile(remoteID: 42, displayName: "blaze", avatar: "🐉").telemetryOptOut)

        let fresh = try await store.saveChildProfile(remoteID: 43, displayName: "ember", avatar: nil)
        #expect(fresh.kind == .child)
        #expect(fresh.avatar == nil)
        #expect(try await store.profiles().map(\.id) == [store.guestProfile.id, renamed.id, fresh.id])
    }

    /// A family iPad: siblings take turns, and each keeps their own events,
    /// queue and progress.
    @Test func siblingsOnOneDeviceKeepSeparateEventsQueuesAndProgress() async throws {
        let ada = try await store.saveChildProfile(remoteID: 1, displayName: "sparky", avatar: "🐉")
        let bo = try await store.saveChildProfile(remoteID: 2, displayName: "ember", avatar: "🦊")
        let adaWin = try await store.record(NodeWon(nodeID: 1, stars: 3), for: ada.id)
        let boWin = try await store.record(NodeWon(nodeID: 5, stars: 1), for: bo.id)
        let adaDragons = try await store.record(DragonsCollected(dragonIDs: [7]), for: ada.id)

        #expect(try await store.events(for: ada.id) == [adaWin, adaDragons])
        #expect(try await store.events(for: bo.id) == [boWin])
        let kinds: Set<EventKind> = [NodeWon.kind, DragonsCollected.kind]
        #expect(try await store.pendingEvents(for: bo.id, kinds: kinds, limit: 10) == [boWin])
        #expect(try await store.progress(for: ada.id) == ProfileProgress(nodesWon: [1], stars: [1: 3], dragons: [7: 1]))
        #expect(try await store.progress(for: bo.id) == ProfileProgress(nodesWon: [5], stars: [5: 1]))
        #expect(try await store.progress(for: store.guestProfile.id) == ProfileProgress())
    }

    @Test func recordsEventsWithDeviceIDsAndTimestamps() async throws {
        let guest = store.guestProfile.id
        let first = try await store.record(NodeWon(nodeID: 3), for: guest)
        let second = try await store.record(NodeWon(nodeID: 4), for: guest)

        #expect(first.id != second.id)
        #expect(first.profileID == guest)
        #expect(first.kind == "node.won")
        #expect(first.uploadState == .pending)
        #expect(second.occurredAt > first.occurredAt)
        #expect(String(decoding: first.payload, as: UTF8.self) == #"{"nodeId":3}"#)
        #expect(try await store.events(for: guest) == [first, second])
    }

    @Test func eventsAreScopedToTheirProfile() async throws {
        let child = try await store.addChildProfile(remoteID: 7, displayName: "Bo")
        try await store.record(NodeWon(nodeID: 1), for: store.guestProfile.id)
        let childEvent = try await store.record(NodeWon(nodeID: 2), for: child.id)
        #expect(try await store.events(for: child.id) == [childEvent])
        #expect(try await store.progress(for: child.id).nodesWon == [2])
        #expect(try await store.progress(for: store.guestProfile.id).nodesWon == [1])
    }

    @Test func storesAndDecodesUnknownKinds() async throws {
        let hint = HintUsed(problem: "3 × 4", hintsLeft: 2)
        let event = try await store.record(hint, for: store.guestProfile.id)
        let fetched = try #require(try await store.events(for: store.guestProfile.id).first)
        #expect(fetched.kind == HintUsed.kind)
        #expect(try fetched.decode(HintUsed.self) == hint)
        #expect(try fetched.decode(NodeWon.self) == nil)
        #expect(fetched == event)
    }

    @Test func derivesNodesWon() async throws {
        let guest = store.guestProfile.id
        #expect(try await store.progress(for: guest) == ProfileProgress())
        try await store.record(NodeWon(nodeID: 1), for: guest)
        try await store.record(NodeWon(nodeID: 2), for: guest)
        try await store.record(NodeWon(nodeID: 1), for: guest)
        try await store.record(HintUsed(problem: "1 + 1", hintsLeft: 0), for: guest)
        #expect(try await store.progress(for: guest).nodesWon == [1, 2])
    }

    @Test func queuesPendingEventsUntilUploaded() async throws {
        let guest = store.guestProfile.id
        var recorded: [StoredEvent] = []
        for node in 1...5 {
            recorded.append(try await store.record(NodeWon(nodeID: node), for: guest))
        }

        let batch = try await store.pendingEvents(limit: 3)
        #expect(batch.map(\.id) == recorded.prefix(3).map(\.id))

        try await store.markUploaded(batch.map(\.id) + [UUID()])
        let rest = try await store.pendingEvents(limit: 10)
        #expect(rest.map(\.id) == recorded.suffix(2).map(\.id))
        #expect(try await store.events(for: guest).map(\.uploadState) == [
            .uploaded, .uploaded, .uploaded, .pending, .pending,
        ])
        // Uploading doesn't change derived progress.
        #expect(try await store.progress(for: guest).nodesWon == [1, 2, 3, 4, 5])
    }

    @Test func pendingEventsForOneProfileAndSomeKinds() async throws {
        let guest = store.guestProfile.id
        let child = try await store.addChildProfile(remoteID: 8, displayName: "Di")
        let hint = try await store.record(HintUsed(problem: "1 + 2", hintsLeft: 1), for: child.id)
        try await store.record(NodeWon(nodeID: 1), for: guest)
        let first = try await store.record(NodeWon(nodeID: 2), for: child.id)
        let second = try await store.record(NodeWon(nodeID: 3, stars: 2), for: child.id)
        let third = try await store.record(NodeWon(nodeID: 4), for: child.id)

        let wins = try await store.pendingEvents(for: child.id, kinds: [NodeWon.kind], limit: 2)
        #expect(wins.map(\.id) == [first.id, second.id])
        try await store.markUploaded([first.id])
        #expect(try await store.pendingEvents(for: child.id, kinds: [NodeWon.kind], limit: 5).map(\.id)
            == [second.id, third.id])
        #expect(try await store.pendingEvents(for: child.id, kinds: [NodeWon.kind, HintUsed.kind], limit: 5)
            .map(\.id) == [hint.id, second.id, third.id])
        #expect(try await store.pendingEvents(for: child.id, kinds: [], limit: 5).isEmpty)
    }

    @Test func nodeWonStarsAreOptional() async throws {
        let event = try await store.record(NodeWon(nodeID: 5, stars: 3), for: store.guestProfile.id)
        #expect(String(decoding: event.payload, as: UTF8.self) == #"{"nodeId":5,"stars":3}"#)
        #expect(try event.decode(NodeWon.self) == NodeWon(nodeID: 5, stars: 3))
        // Events recorded before stars existed still decode.
        let old = StoredEvent(
            id: UUID(), profileID: store.guestProfile.id, kind: NodeWon.kind, payload: Data(#"{"nodeId":6}"#.utf8),
            occurredAt: .now, uploadState: .pending)
        #expect(try old.decode(NodeWon.self) == NodeWon(nodeID: 6))
    }

    @Test func derivesProvingBestsPerLevel() async throws {
        let guest = store.guestProfile.id
        let run = { (mode: String, digit: Int, medal: String, ms: Int) in
            ProvingMedalEarned(mode: mode, digit: digit, medal: medal, elapsedMs: ms, wrongCount: 0)
        }
        try await store.record(run("mul", 7, "silver", 52_000), for: guest)
        try await store.record(run("mul", 7, "bronze", 48_500), for: guest)
        try await store.record(run("mul", 7, "gold", 44_000), for: guest)
        try await store.record(run("mul", 7, "bronze", 70_000), for: guest)
        try await store.record(run("div", 3, "bronze", 81_000), for: guest)
        try await store.record(NodeWon(nodeID: 2), for: guest)

        let progress = try await store.progress(for: guest)
        #expect(progress.provingBests == [
            "mul-7": ProvingBest(medal: "gold", bestMs: 44_000),
            "div-3": ProvingBest(medal: "bronze", bestMs: 81_000),
        ])
        #expect(progress.nodesWon == [2])
    }

    @Test func provingMedalPayloadIsStable() async throws {
        let event = try await store.record(
            ProvingMedalEarned(mode: "div", digit: 4, medal: "silver", elapsedMs: 55_120, wrongCount: 0),
            for: store.guestProfile.id)
        #expect(event.kind == "proving.medal")
        #expect(String(decoding: event.payload, as: UTF8.self)
            == #"{"digit":4,"elapsedMs":55120,"medal":"silver","mode":"div","wrongCount":0}"#)
    }

    @Test func observesProgress() async throws {
        let guest = store.guestProfile.id
        var updates = store.observeProgress(for: guest).makeAsyncIterator()

        #expect(try await updates.next() == ProfileProgress())
        try await store.record(NodeWon(nodeID: 9), for: guest)
        #expect(try await updates.next() == ProfileProgress(nodesWon: [9]))
        // Events that don't change progress don't emit.
        try await store.record(NodeWon(nodeID: 9), for: guest)
        try await store.record(NodeWon(nodeID: 10), for: guest)
        #expect(try await updates.next() == ProfileProgress(nodesWon: [9, 10]))
    }

    @Test func cachesContentByNameReplacingOlderCopies() async throws {
        #expect(try await store.cachedContent("rule_settings") == nil)

        try await store.saveContent("rule_settings", version: "v1", json: Data(#"{"a":1}"#.utf8))
        try await store.saveContent("dragon_catalog", version: "c1", json: Data(#"{"dragons":[]}"#.utf8))
        let first = try #require(try await store.cachedContent("rule_settings"))
        #expect(first.name == "rule_settings")
        #expect(first.version == "v1")
        #expect(first.json == Data(#"{"a":1}"#.utf8))

        try await store.saveContent("rule_settings", version: "v2", json: Data(#"{"a":2}"#.utf8))
        let second = try #require(try await store.cachedContent("rule_settings"))
        #expect(second.version == "v2")
        #expect(second.json == Data(#"{"a":2}"#.utf8))
        #expect(second.syncedAt > first.syncedAt)
        #expect(try await store.cachedContent("dragon_catalog")?.version == "c1")
    }
}

@Suite struct OnDiskStore {
    @Test func persistsAcrossReopen() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "StoreTests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "nested/store.sqlite")

        let guest: Profile
        let child: Profile
        let events: [StoredEvent]
        do {
            let store = try SQLiteStore.onDisk(at: url)
            guest = store.guestProfile
            child = try await store.addChildProfile(remoteID: 5, displayName: "Cy")
            let won = try await store.record(NodeWon(nodeID: 12), for: guest.id)
            let hint = try await store.record(HintUsed(problem: "2 + 2", hintsLeft: 1), for: guest.id)
            try await store.markUploaded([won.id])
            events = try await store.events(for: guest.id)
            #expect(events.map(\.id) == [won.id, hint.id])
            try await store.saveContent("node_config", version: "n1", json: Data(#"{"configs":[]}"#.utf8))
        }

        let reopened = try SQLiteStore.onDisk(at: url)
        #expect(reopened.guestProfile == guest)
        #expect(try await reopened.profiles() == [guest, child])
        #expect(try await reopened.events(for: guest.id) == events)
        #expect(try await reopened.pendingEvents(limit: 10).map(\.id) == [events[1].id])
        #expect(try await reopened.progress(for: guest.id).nodesWon == [12])
        // An offline launch plays from the content synced last time.
        #expect(try await reopened.cachedContent("node_config")?.json == Data(#"{"configs":[]}"#.utf8))
    }
}
