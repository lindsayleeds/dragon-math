import Foundation
import GameRules
import Store
import Sync
import Testing
@testable import DragonAcademy

private let day: TimeInterval = 24 * 3600
private let start = Date(timeIntervalSince1970: 1_800_000_000)

/// A clock the test moves by hand.
private final class HandClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current = start
    func now() -> Date { lock.withLock { current } }
    func advance(_ seconds: TimeInterval) { lock.withLock { current += seconds } }
}

/// Each kid's plan, by server id; a missing kid (or `offline`) fails the read.
private final class PerKidPlanStatus: PlanStatusService, @unchecked Sendable {
    private let lock = NSLock()
    private var plans: [Int: String]
    private var failure: PlanStatusError?
    private(set) var asked: [Int?] = []

    init(_ plans: [Int: String]) { self.plans = plans }

    func set(_ plan: String, for id: Int) { lock.withLock { plans[id] = plan } }
    func fail(_ error: PlanStatusError?) { lock.withLock { failure = error } }

    func status(childID: Int?) async throws(PlanStatusError) -> PlanStatusSnapshot {
        let result: Result<String, PlanStatusError> = lock.withLock {
            asked.append(childID)
            if let failure { return .failure(failure) }
            guard let id = childID, let plan = plans[id] else { return .failure(.unavailable) }
            return .success(plan)
        }
        return PlanStatusSnapshot(plan: try result.get(), source: nil, appAccountToken: nil)
    }
}

private func kid(_ remoteID: Int) -> Profile {
    Profile(id: UUID(), kind: .child, remoteID: remoteID, displayName: "Kid \(remoteID)", createdAt: start)
}

private let guest = Profile(id: UUID(), kind: .guest, remoteID: nil, displayName: "Guest", createdAt: start)
private let munchers = LairGame.named("dragon-munchers")!
private let eggHatchery = LairGame.named("dragon-egg-hatchery")!

@MainActor
private struct Harness {
    let clock = HandClock()
    let server: PerKidPlanStatus
    let store: FakePremiumStore
    let cache: InMemoryPlanStatusCache
    var session: SyncSession = .parent
    var kids: [Int] = [11, 12]

    init(plans: [Int: String] = [:], entitled: Set<String> = [], cache: InMemoryPlanStatusCache = .init()) {
        server = PerKidPlanStatus(plans)
        store = FakePremiumStore(entitled: entitled)
        self.cache = cache
    }

    func access() -> PremiumAccess {
        let clock = clock
        let session = session
        let kids = kids
        return PremiumAccess(
            premiumStore: store, planStatus: server, cache: cache,
            session: { session }, kidIDs: { kids }, now: { clock.now() })
    }
}

@MainActor @Suite struct PremiumAccessTests {
    // MARK: - Offline grace

    @Test func aCachedPremiumPlanHoldsForTheGraceWindowThenFallsBackToFree() async {
        let harness = Harness(plans: [11: "premium"])
        let access = harness.access()
        await access.refresh()
        #expect(access.isPremium(kid(11)))

        // Offline from here on: every read fails, the cached plan stands.
        harness.server.fail(.unavailable)
        harness.clock.advance(6 * day)
        await access.refresh()
        #expect(access.isPremium(kid(11)))

        harness.clock.advance(day - 1)
        #expect(access.isPremium(kid(11)))
        harness.clock.advance(1)
        #expect(!access.isPremium(kid(11)))
        #expect(access.isLocked(munchers, for: kid(11)))
    }

    @Test func theGraceIsSevenDays() {
        #expect(PremiumAccess.offlineGrace == 7 * day)
    }

    @Test func aFreshReadRestartsTheGrace() async {
        let harness = Harness(plans: [11: "premium"])
        let access = harness.access()
        await access.refresh()
        harness.clock.advance(6 * day)
        await access.refresh()
        harness.clock.advance(6 * day)
        #expect(access.isPremium(kid(11)))
    }

    @Test func theCacheOutlivesTheAppWithItsReadTime() async {
        let cache = InMemoryPlanStatusCache()
        let first = Harness(plans: [11: "premium"], cache: cache)
        await first.access().refresh()

        // A relaunch, offline and signed out, five days later.
        var relaunch = Harness(cache: cache)
        relaunch.session = .none
        relaunch.clock.advance(5 * day)
        let access = relaunch.access()
        await access.refresh()
        #expect(access.isPremium(kid(11)))
        relaunch.clock.advance(2 * day)
        #expect(!access.isPremium(kid(11)))
    }

    @Test func aReadFromFarInTheFutureIsNotTrusted() {
        let cache = InMemoryPlanStatusCache([11: CachedPlanStatus(plan: "premium", fetchedAt: start + 30 * day)])
        let access = Harness(cache: cache).access()
        // The clock was wound back past the read; that doesn't make it fresh.
        #expect(!access.isPremium(kid(11)))
    }

    @Test func aFreePlanFromTheServerReplacesACachedPremiumOne() async {
        let harness = Harness(plans: [11: "premium"])
        let access = harness.access()
        await access.refresh()
        harness.server.set("free", for: 11)
        await access.refresh()
        #expect(!access.isPremium(kid(11)))
    }

    // MARK: - Classroom kids

    @Test func aClassroomKidIsPremiumWithoutAPurchaseAndTheirSiblingIsNot() async {
        let harness = Harness(plans: [11: "classroom", 12: "free"])
        let access = harness.access()
        await access.refresh()

        #expect(harness.server.asked == [11, 12])
        #expect(access.isPremium(kid(11)))
        #expect(!access.isLocked(munchers, for: kid(11)))
        #expect(!access.isPremium(kid(12)))
        #expect(access.isLocked(munchers, for: kid(12)))
    }

    @Test func aKidsOwnSessionReadsOnlyThatKid() async {
        var harness = Harness(plans: [11: "classroom", 12: "premium"])
        harness.session = .child(11)
        let access = harness.access()
        await access.refresh()

        #expect(harness.server.asked == [11])
        #expect(access.isPremium(kid(11)))
    }

    @Test func signedOutAsksTheServerNothing() async {
        var harness = Harness(plans: [11: "premium"])
        harness.session = .none
        let access = harness.access()
        await access.refresh()

        #expect(harness.server.asked.isEmpty)
        #expect(!access.isPremium(kid(11)))
    }

    @Test func signingOutForgetsTheFamilysPlans() async {
        let harness = Harness(plans: [11: "premium"])
        let access = harness.access()
        await access.refresh()
        access.forgetCachedPlans()

        #expect(!access.isPremium(kid(11)))
        #expect(harness.cache.load().isEmpty)
    }

    // MARK: - StoreKit's local entitlement

    @Test func theLocalEntitlementUnlocksEveryoneEvenPastTheGrace() async {
        let harness = Harness(plans: [11: "free"], entitled: [PremiumProducts.yearly])
        let access = harness.access()
        await access.refresh()
        harness.server.fail(.unavailable)
        harness.clock.advance(30 * day)

        #expect(access.isPremium(kid(11)))
        #expect(access.isPremium(kid(99)))
        #expect(access.isPremium(guest))
        #expect(!access.isLocked(munchers, for: guest))
    }

    @Test func theEntitlementIsReadOfflineAndSignedOut() async {
        var harness = Harness(entitled: [PremiumProducts.monthly])
        harness.session = .none
        let access = harness.access()
        #expect(!access.isPremium(guest))
        await access.refreshEntitlement()
        #expect(access.isPremium(guest))
    }

    @Test func theGuestWithoutAnEntitlementIsFree() async {
        let harness = Harness(plans: [11: "premium"])
        let access = harness.access()
        await access.refresh()
        #expect(!access.isPremium(guest))
        #expect(!access.isPremium(nil))
    }

    // MARK: - Lair gating

    @Test func onlyPremiumGamesLockOnAFreePlan() async {
        let harness = Harness(plans: [11: "free"])
        let access = harness.access()
        await access.refresh()

        let locked = LairGame.all.filter { access.isLocked($0, for: kid(11)) }
        #expect(locked == LairGame.all.filter(\.premium))
        #expect(!locked.isEmpty)
        #expect(!access.isLocked(eggHatchery, for: kid(11)))
    }

    @Test func theDebugOverrideOpensEverything() {
        let access = PremiumAccess(
            premiumStore: FakePremiumStore(), planStatus: PerKidPlanStatus([:]), cache: InMemoryPlanStatusCache(),
            session: { .none }, kidIDs: { [] }, alwaysPremium: true)
        #expect(LairGame.all.allSatisfy { !access.isLocked($0, for: guest) })
    }

    // MARK: - The persisted cache

    @Test func userDefaultsCacheRoundTrips() throws {
        let suite = "PremiumAccessTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let cache = UserDefaultsPlanStatusCache(defaults: defaults)
        let statuses = [11: CachedPlanStatus(plan: "classroom", fetchedAt: start)]

        cache.save(statuses)

        #expect(UserDefaultsPlanStatusCache(defaults: defaults).load() == statuses)
    }
}
