import Foundation
import GameRules
import OSLog
import Store
import SwiftUI
import Sync

/// Whether the kid playing has Premium, for the kid screens (premium-only
/// games in the Learning Lair). The purchase screen has its own
/// `PremiumModel`; both follow the same rule (ADR 0008, docs/APP_STORE.md):
///
/// - **The server's plan**, read per kid with `GET /api/plan/status?child_id=`
///   (the best plan among all the kid's guardians, so a classroom kid is
///   premium through their teacher's plan with no purchase), and cached on the
///   device with the time it was read. Offline, the cached plan is trusted for
///   ``offlineGrace`` after that read; past it the kid is treated as free.
/// - **OR StoreKit's entitlement on this device**, which needs no network and
///   covers a purchase the server hasn't heard of yet, and the grace having
///   run out while the subscription is still current.
///
/// The guest has no server plan, so only the device's entitlement counts.
///
/// The app refreshes it on returning to the foreground (the local
/// entitlement), after every sync run (the server's plan, since a sync means
/// the network and a session are there), when the parent area closes, and on
/// every StoreKit transaction update.
@MainActor
@Observable
final class PremiumAccess {
    /// How long a plan read from the server is trusted with no newer read:
    /// about a week offline (a trip, a flight) keeps a paying family's games
    /// open, while a lapsed or cancelled plan doesn't stay unlocked for long
    /// on a device that never reconnects.
    static let offlineGrace: TimeInterval = 7 * 24 * 3600

    /// How far a read may be in the future of the device clock (a small clock
    /// correction) and still count. Winding the clock back further than this
    /// doesn't make an old read trustworthy again.
    static let clockSkewAllowance: TimeInterval = 5 * 60

    /// The last plan read per kid (server id).
    private(set) var statuses: [Int: CachedPlanStatus]
    /// StoreKit holds a current Premium entitlement on this device.
    private(set) var isLocallyEntitled = false

    private let premiumStore: any PremiumStore
    private let planStatus: any PlanStatusService
    private let cache: any PlanStatusCache
    private let session: @Sendable () async -> SyncSession
    private let kidIDs: @Sendable () async -> [Int]
    private let now: @Sendable () -> Date
    /// Everyone is premium (the debug `-DAPremium YES` launch argument).
    private let alwaysPremium: Bool
    private var watchingTransactions: Task<Void, Never>?
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Premium")

    /// - Parameters:
    ///   - session: whose session the API client has now; nothing is asked of
    ///     the server while it is ``SyncSession/none``.
    ///   - kidIDs: the server ids of the kids on this device.
    ///   - now: the clock the grace window is measured with.
    ///   - alwaysPremium: unlock everything, for UI tests and screenshots.
    init(
        premiumStore: any PremiumStore,
        planStatus: any PlanStatusService,
        cache: any PlanStatusCache,
        session: @escaping @Sendable () async -> SyncSession,
        kidIDs: @escaping @Sendable () async -> [Int],
        now: @escaping @Sendable () -> Date = { Date() },
        alwaysPremium: Bool = false
    ) {
        self.premiumStore = premiumStore
        self.planStatus = planStatus
        self.cache = cache
        self.session = session
        self.kidIDs = kidIDs
        self.now = now
        self.alwaysPremium = alwaysPremium
        statuses = cache.load()
    }

    /// The kids on a Store's device: its child profiles' server ids.
    static func kidIDs(in store: any Store) -> @Sendable () async -> [Int] {
        { (try? await store.profiles())?.filter { $0.kind == .child }.compactMap(\.remoteID) ?? [] }
    }

    /// Whether `profile` plays with Premium right now.
    func isPremium(_ profile: Profile?) -> Bool {
        if alwaysPremium || isLocallyEntitled { return true }
        guard let id = profile?.remoteID, let status = statuses[id] else { return false }
        return status.isPremium && isTrusted(status)
    }

    /// Whether `game` is closed to `profile`: a premium-only game on a free plan.
    func isLocked(_ game: LairGame, for profile: Profile?) -> Bool {
        game.premium && !isPremium(profile)
    }

    /// A cached read is trusted from when it was made until the grace ends.
    func isTrusted(_ status: CachedPlanStatus) -> Bool {
        let age = now().timeIntervalSince(status.fetchedAt)
        return age >= -Self.clockSkewAllowance && age < Self.offlineGrace
    }

    /// Re-reads the device's StoreKit entitlement (no network).
    func refreshEntitlement() async {
        isLocallyEntitled = await !premiumStore.entitledProductIDs().isEmpty
    }

    /// Re-reads the entitlement and, with a session, each kid's plan from the
    /// server. A kid whose read fails keeps their cached plan (and its age).
    func refresh() async {
        await refreshEntitlement()
        let ids: [Int]
        switch await session() {
        case .none: return
        case .parent: ids = await kidIDs()
        case .child(let id): ids = [id]
        }
        var statuses = self.statuses
        for id in ids {
            do {
                let status = try await planStatus.status(childID: id)
                statuses[id] = CachedPlanStatus(plan: status.plan, fetchedAt: now())
            } catch .signedOut {
                log.info("Plan status: the session was refused; keeping the cached plans")
                break
            } catch {
                log.info("Plan status: couldn't read kid \(id); keeping the cached plan")
            }
        }
        self.statuses = statuses
        cache.save(statuses)
    }

    /// The parent signed out: the cached plans belonged to their family.
    func forgetCachedPlans() {
        statuses = [:]
        cache.save([:])
    }

    /// Follows StoreKit transactions (renewals, refunds, an approved Ask to
    /// Buy) for the app's lifetime. Call once at launch.
    func watchTransactions() {
        guard watchingTransactions == nil else { return }
        let updates = premiumStore.transactionUpdates()
        watchingTransactions = Task { [weak self] in
            await self?.refreshEntitlement()
            for await _ in updates {
                await self?.refreshEntitlement()
            }
        }
    }
}

extension EnvironmentValues {
    /// Nil in previews and tests that don't set one: every game is open there.
    @Entry var premiumAccess: PremiumAccess? = nil
}
