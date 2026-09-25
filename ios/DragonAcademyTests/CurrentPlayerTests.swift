import Foundation
import Store
import Sync
import Testing
@testable import DragonAcademy

/// The server's family, scripted; nil children means offline.
private final class StubFamily: FamilyService, @unchecked Sendable {
    private let lock = NSLock()
    private var _children: [RemoteChild]?

    init(_ children: [RemoteChild]?) { _children = children }

    var remote: [RemoteChild]? {
        get { lock.withLock { _children } }
        set { lock.withLock { _children = newValue } }
    }

    func children() async throws(FamilyError) -> [RemoteChild] {
        guard let children = remote else { throw .unavailable }
        return children
    }

    func createChild(name: String?) async throws(FamilyError) -> RemoteChild { throw .unavailable }

    func setTelemetryOptOut(_ optOut: Bool, childID: Int) async throws(FamilyError) -> Bool { throw .unavailable }
}

/// A JWT-shaped token carrying `claims`; the signature is junk.
private func jwt(_ claims: String) -> String {
    let base64url = Data(claims.utf8).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    return "eyJhbGciOiJIUzI1NiJ9.\(base64url).c2ln"
}

private let parentJWT = jwt(#"{"id":9,"account_type":"parent","exp":4102444800}"#)

private let ada = RemoteChild(id: 1, username: "sparky", realName: "Ada Lovelace", avatar: "🐉")
private let bo = RemoteChild(id: 2, username: "ember", realName: "Bo", avatar: "🦊")

@MainActor
private func makePlayer(
    signedIn: Bool = true, family: [RemoteChild]? = [ada, bo]
) throws -> (CurrentPlayer, SQLiteStore, StubFamily) {
    let store = try SQLiteStore.inMemory()
    let service = StubFamily(family)
    return (CurrentPlayer(store: store, family: service, parentSignedIn: signedIn), store, service)
}

@MainActor
private func kid(_ player: CurrentPlayer, _ label: String) throws -> Profile {
    try #require(player.kids.first { $0.label == label }).profile
}

@Suite @MainActor struct CurrentPlayerTests {
    @Test func withNoParentTheGuestPlays() async throws {
        let (player, store, _) = try makePlayer(signedIn: false)
        await player.refresh()

        #expect(player.mode == .guest)
        #expect(player.profile == store.guestProfile)
        #expect(!player.isPicking)
        // Guest mode doesn't reach the server for the family.
        #expect(player.kids.isEmpty)
    }

    @Test func withAParentSignedInTheKidScreensStartAtThePicker() async throws {
        let (player, _, _) = try makePlayer()
        #expect(player.isPicking)

        await player.refresh()

        #expect(player.isPicking)
        #expect(player.profile == nil)
        #expect(player.kids.map(\.label) == ["sparky", "ember"])
        #expect(player.kids.map(\.profile.avatar) == ["🐉", "🦊"])
    }

    @Test func thePickerShowsHandlesNeverTheNamesParentsEntered() async throws {
        let newKid = RemoteChild(id: 3, username: nil, realName: "Cy Young", avatar: "⚔️")
        let (player, store, _) = try makePlayer(family: [ada, bo, newKid])

        await player.refresh()

        #expect(player.kids.map(\.label) == ["sparky", "ember", "New adventurer"])
        let stored = try await store.profiles().map(\.displayName)
        #expect(!stored.contains { $0.contains("Ada") || $0.contains("Bo") || $0.contains("Cy") })
    }

    @Test func kidsWhoShareANameAreNumbered() async throws {
        let (player, _, _) = try makePlayer(family: [
            RemoteChild(id: 1, username: nil, realName: "Ada"),
            ada.with(id: 5),
            RemoteChild(id: 2, username: nil, realName: "Bo"),
        ])

        await player.refresh()

        #expect(player.kids.map(\.label) == ["New adventurer 1", "sparky", "New adventurer 2"])
    }

    @Test func tappingAnAvatarPlaysAsThatKidAndSwitchingGoesBackToThePicker() async throws {
        let (player, _, _) = try makePlayer()
        await player.refresh()
        let sparky = try kid(player, "sparky")

        player.choose(sparky)
        #expect(player.profile == sparky)
        #expect(!player.isPicking)

        player.switchKid()
        #expect(player.isPicking)

        let ember = try kid(player, "ember")
        player.choose(ember)
        #expect(player.profile == ember)
    }

    /// The acceptance criterion: on a shared iPad each kid's events and
    /// progress stay their own however often they swap.
    @Test func eachKidsEventsAndProgressStaySeparateAcrossSwitches() async throws {
        let (player, store, _) = try makePlayer()
        await player.refresh()
        let sparky = try kid(player, "sparky")
        let ember = try kid(player, "ember")

        func play(_ node: Int, stars: Int) async throws {
            let profile = try #require(player.profile)
            try await store.record(NodeWon(nodeID: node, stars: stars), for: profile.id)
        }

        player.choose(sparky)
        try await play(1, stars: 3)
        player.switchKid()
        player.choose(ember)
        try await play(1, stars: 1)
        try await play(2, stars: 2)
        player.switchKid()
        player.choose(sparky)
        try await play(2, stars: 3)

        #expect(try await store.progress(for: sparky.id) == ProfileProgress(nodesWon: [1, 2], stars: [1: 3, 2: 3]))
        #expect(try await store.progress(for: ember.id) == ProfileProgress(nodesWon: [1, 2], stars: [1: 1, 2: 2]))
        #expect(try await store.events(for: sparky.id).count == 2)
        #expect(try await store.events(for: ember.id).count == 2)
        #expect(try await store.events(for: store.guestProfile.id).isEmpty)
    }

    /// Switching kids is local: no parental gate, and the session (the
    /// parent's, which uploads every kid's queue) doesn't change.
    @Test func switchingKidsLeavesTheParentSessionAlone() async throws {
        let (player, _, _) = try makePlayer()
        let tokens = SessionTokens(token: parentJWT)
        await player.refresh()

        for label in ["sparky", "ember", "sparky"] {
            player.choose(try kid(player, label))
            player.switchKid()
        }

        #expect(await tokens.current() == parentJWT)
        #expect(await tokens.syncSession() == .parent)
    }

    @Test func signingInOpensThePickerAndSigningOutReturnsToTheGuest() async throws {
        let (player, store, _) = try makePlayer(signedIn: false)
        await player.refresh()
        #expect(player.profile == store.guestProfile)

        await player.parentSessionChanged(signedIn: true)
        #expect(player.mode == .family)
        #expect(player.isPicking)
        #expect(player.kids.map(\.label) == ["sparky", "ember"])
        player.choose(try kid(player, "ember"))

        await player.parentSessionChanged(signedIn: false)
        #expect(player.mode == .guest)
        #expect(player.profile == store.guestProfile)
        // The guest can't pick a family profile.
        player.choose(try #require(player.kids.first).profile)
        #expect(player.profile == store.guestProfile)
    }

    @Test func offlineThePickerShowsTheKidsAlreadyOnTheDevice() async throws {
        let (player, _, service) = try makePlayer()
        await player.refresh()
        service.remote = nil

        await player.refresh()

        #expect(player.kids.map(\.label) == ["sparky", "ember"])
    }

    @Test func aHandleChangedElsewhereShowsOnTheNextRefresh() async throws {
        let (player, _, service) = try makePlayer()
        await player.refresh()
        let sparky = try kid(player, "sparky")
        player.choose(sparky)

        service.remote = [ada.with(username: "blaze", avatar: "🦄"), bo]
        await player.refresh()

        #expect(player.kids.map(\.label) == ["blaze", "ember"])
        // Still the same kid (same profile, same events), now with the new name.
        #expect(player.profile?.id == sparky.id)
        #expect(player.profile?.displayName == "blaze")
        #expect(player.profile?.avatar == "🦄")
    }
}

@Suite struct SessionTokensSyncSessionTests {
    @Test func aParentsTokenUploadsForEveryChild() async {
        #expect(await SessionTokens(token: parentJWT).syncSession() == .parent)
    }

    @Test func aKidsTokenUploadsOnlyForThatKid() async {
        let kid = jwt(#"{"id":7,"account_type":"child","family_parent_id":9,"exp":4102444800}"#)
        #expect(await SessionTokens(token: kid).syncSession() == .child(7))
    }

    @Test func aKidsTokenWithoutAnIDUploadsNothing() async {
        let kid = jwt(#"{"account_type":"child"}"#)
        #expect(await SessionTokens(token: kid).syncSession() == SyncSession.none)
    }

    @Test func signedOutUploadsNothing() async {
        #expect(await SessionTokens().syncSession() == SyncSession.none)
    }
}

private extension RemoteChild {
    func with(id: Int? = nil, username: String? = nil, avatar: String? = nil) -> RemoteChild {
        RemoteChild(
            id: id ?? self.id, username: username ?? self.username, realName: realName, avatar: avatar ?? self.avatar)
    }
}
