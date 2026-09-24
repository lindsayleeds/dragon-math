import Foundation
import Testing
@testable import DragonAcademy

private let token = UUID(uuidString: "0F8FAD5B-D9CB-469F-A165-70867728950E")!
private let free = PlanStatusSnapshot(plan: "free", source: nil, appAccountToken: token)
private let premium = PlanStatusSnapshot(plan: "premium", source: "app_store", appAccountToken: token)

private let yearly = PremiumProduct(id: PremiumProducts.yearly, displayName: "Yearly", description: "",
                                    displayPrice: "$59.99", period: .year)
private let monthly = PremiumProduct(id: PremiumProducts.monthly, displayName: "Monthly", description: "",
                                     displayPrice: "$7.99", period: .month)

/// A StoreKit stand-in driven by the test.
private final class ScriptedStore: PremiumStore, @unchecked Sendable {
    private let lock = NSLock()
    var catalog: Result<[PremiumProduct], PremiumStoreError> = .success([monthly, yearly])
    var purchaseResult: Result<PurchaseOutcome, PremiumStoreError> = .success(.purchased(productID: PremiumProducts.yearly))
    var restoreResult: Result<Void, PremiumStoreError> = .success(())
    var entitled: Set<String> = []
    /// Given to `entitled` when a purchase succeeds or a restore runs.
    var restorable: Set<String> = []
    private(set) var purchases: [(productID: String, token: UUID)] = []
    private let updates: AsyncStream<Void>
    private let continuation: AsyncStream<Void>.Continuation

    init() {
        (updates, continuation) = AsyncStream<Void>.makeStream()
    }

    func products(ids: [String]) async throws(PremiumStoreError) -> [PremiumProduct] {
        let all = try catalog.get()
        return ids.compactMap { id in all.first { $0.id == id } }
    }

    func purchase(productID: String, appAccountToken: UUID) async throws(PremiumStoreError) -> PurchaseOutcome {
        let result = lock.withLock {
            purchases.append((productID, appAccountToken))
            if case .success(.purchased(let id)) = purchaseResult { entitled.insert(id) }
            return purchaseResult
        }
        return try result.get()
    }

    func restore() async throws(PremiumStoreError) {
        let result = lock.withLock {
            if case .success = restoreResult { entitled.formUnion(restorable) }
            return restoreResult
        }
        try result.get()
    }

    func entitledProductIDs() async -> Set<String> { lock.withLock { entitled } }

    func transactionUpdates() -> AsyncStream<Void> { updates }

    /// As if a transaction were finished outside a purchase call.
    func deliverUpdate(entitling id: String) {
        lock.withLock {
            entitled.insert(id)
            continuation.yield()
        }
    }

    func endUpdates() { continuation.finish() }
}

/// Answers plan-status requests from a script, then with the last entry.
private final class ScriptedPlanStatus: PlanStatusService, @unchecked Sendable {
    private let lock = NSLock()
    private var results: [Result<PlanStatusSnapshot, PlanStatusError>]
    private(set) var calls = 0

    init(_ results: Result<PlanStatusSnapshot, PlanStatusError>...) { self.results = results }

    func status() async throws(PlanStatusError) -> PlanStatusSnapshot {
        let result = lock.withLock {
            calls += 1
            return results.count > 1 ? results.removeFirst() : results[0]
        }
        return try result.get()
    }
}

private final class SleepLog: @unchecked Sendable {
    private let lock = NSLock()
    private var delays: [Duration] = []
    var recorded: [Duration] { lock.withLock { delays } }
    func record(_ delay: Duration) { lock.withLock { delays.append(delay) } }
}

@MainActor
private func makeModel(
    store: ScriptedStore = ScriptedStore(),
    plan: ScriptedPlanStatus = ScriptedPlanStatus(.success(free)),
    sleeps: SleepLog = SleepLog()
) -> PremiumModel {
    PremiumModel(dependencies: PremiumDependencies(store: store, planStatus: plan) { sleeps.record($0) })
}

@MainActor
@Suite struct PremiumModelTests {
    @Test func loadsProductsInDisplayOrderWithThePlan() async {
        let model = makeModel()

        await model.load()

        #expect(model.phase == .ready)
        #expect(model.products.map(\.id) == [PremiumProducts.yearly, PremiumProducts.monthly])
        #expect(model.plan == free)
        #expect(!model.isPremium)
    }

    @Test func productsThatWontLoadAreAFailure() async {
        let store = ScriptedStore()
        store.catalog = .failure(.failed)
        let model = makeModel(store: store)

        await model.load()

        #expect(model.phase == .failed)
    }

    @Test func buysWithTheServersAppAccountTokenAndUnlocksPremium() async {
        let store = ScriptedStore()
        let plan = ScriptedPlanStatus(.success(free), .success(premium))
        let model = makeModel(store: store, plan: plan)
        await model.load()

        await model.buy(PremiumProducts.yearly)

        #expect(store.purchases.map(\.productID) == [PremiumProducts.yearly])
        #expect(store.purchases.map(\.token) == [token])
        #expect(model.notice == .purchased)
        #expect(model.isPremium)
        #expect(model.plan == premium)
        #expect(!model.isAwaitingServer)
        #expect(model.purchasingProductID == nil)
    }

    @Test func keepsAskingTheServerUntilTheNotificationHasLanded() async {
        let plan = ScriptedPlanStatus(.success(free), .success(free), .success(free), .success(premium))
        let sleeps = SleepLog()
        let model = makeModel(plan: plan, sleeps: sleeps)
        await model.load()

        await model.buy(PremiumProducts.yearly)

        #expect(plan.calls == 4)
        #expect(sleeps.recorded == Array(PremiumModel.serverRetryDelays.prefix(2)))
        #expect(model.plan == premium)
    }

    @Test func premiumStaysUnlockedLocallyWhenTheServerNeverCatchesUp() async {
        let sleeps = SleepLog()
        let model = makeModel(sleeps: sleeps)
        await model.load()

        await model.buy(PremiumProducts.monthly)

        #expect(model.isPremium)
        #expect(model.isAwaitingServer)
        #expect(sleeps.recorded == PremiumModel.serverRetryDelays)
    }

    @Test func fetchesTheTokenAtPurchaseTimeIfTheFirstLoadMissedIt() async {
        let store = ScriptedStore()
        let plan = ScriptedPlanStatus(.failure(.unavailable), .success(free))
        let model = makeModel(store: store, plan: plan)
        await model.load()
        #expect(model.plan == nil)

        await model.buy(PremiumProducts.yearly)

        #expect(store.purchases.map(\.token) == [token])
    }

    @Test func refusesToBuyWithoutAnAppAccountToken() async {
        let store = ScriptedStore()
        let tokenless = PlanStatusSnapshot(plan: "free", source: nil, appAccountToken: nil)
        let model = makeModel(store: store, plan: ScriptedPlanStatus(.success(tokenless)))
        await model.load()

        await model.buy(PremiumProducts.yearly)

        #expect(store.purchases.isEmpty)
        #expect(model.notice == .accountUnavailable)
        #expect(!model.isPremium)
    }

    @Test func aPendingPurchaseUnlocksWhenItsTransactionArrives() async {
        let store = ScriptedStore()
        store.purchaseResult = .success(.pending)
        let plan = ScriptedPlanStatus(.success(free), .success(premium))
        let model = makeModel(store: store, plan: plan)
        await model.load()

        await model.buy(PremiumProducts.yearly)
        #expect(model.notice == .pending)
        #expect(!model.isPremium)

        store.deliverUpdate(entitling: PremiumProducts.yearly)
        store.endUpdates()
        await model.observeTransactions()

        #expect(model.notice == .purchased)
        #expect(model.isPremium)
        #expect(model.plan == premium)
    }

    @Test func cancellingChangesNothing() async {
        let store = ScriptedStore()
        store.purchaseResult = .success(.cancelled)
        let plan = ScriptedPlanStatus(.success(free))
        let model = makeModel(store: store, plan: plan)
        await model.load()

        await model.buy(PremiumProducts.yearly)

        #expect(model.notice == nil)
        #expect(!model.isPremium)
        #expect(plan.calls == 1)
    }

    @Test func aFailedPurchaseSaysSo() async {
        let store = ScriptedStore()
        store.purchaseResult = .failure(.failed)
        let model = makeModel(store: store)
        await model.load()

        await model.buy(PremiumProducts.yearly)

        #expect(model.notice == .purchaseFailed)
        #expect(!model.isPremium)
    }

    @Test func restoreUnlocksAnExistingSubscription() async {
        let store = ScriptedStore()
        store.restorable = [PremiumProducts.monthly]
        let model = makeModel(store: store, plan: ScriptedPlanStatus(.success(free), .success(premium)))
        await model.load()

        await model.restore()

        #expect(model.notice == .restored)
        #expect(model.isPremium)
        #expect(model.plan == premium)
        #expect(!model.isRestoring)
    }

    @Test func restoreWithNothingToRestoreSaysSo() async {
        let model = makeModel()
        await model.load()

        await model.restore()

        #expect(model.notice == .nothingToRestore)
        #expect(!model.isPremium)
    }

    @Test func aCancelledRestoreIsQuietAndAFailedOneIsNot() async {
        let store = ScriptedStore()
        store.restoreResult = .failure(.cancelled)
        let model = makeModel(store: store)
        await model.load()

        await model.restore()
        #expect(model.notice == nil)

        store.restoreResult = .failure(.failed)
        await model.restore()
        #expect(model.notice == .restoreFailed)
    }

    @Test func premiumFromTheServerCountsWithoutAnyAppStorePurchase() async {
        let web = PlanStatusSnapshot(plan: "premium", source: "stripe", appAccountToken: token)
        let model = makeModel(plan: ScriptedPlanStatus(.success(web)))

        await model.load()

        #expect(model.isPremium)
        #expect(!model.isAwaitingServer)
    }

    @Test func classroomIsPremiumOrBetter() {
        #expect(PlanStatusSnapshot(plan: "classroom", source: "classroom", appAccountToken: nil).isPremium)
        #expect(!PlanStatusSnapshot(plan: "free", source: nil, appAccountToken: nil).isPremium)
    }
}
