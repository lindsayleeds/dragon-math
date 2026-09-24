import Foundation
import StoreKit
import StoreKitTest
import Testing
@testable import DragonAcademy

private final class BundleToken {}

/// One session for the whole run. A session stops local StoreKit testing when
/// it is released, and Swift Testing may release the previous test's suite
/// value after the next one has made its session, which then sends purchases
/// to the real App Store.
@MainActor
private let sharedSession: SKTestSession = {
    let url = Bundle(for: BundleToken.self).url(forResource: "DragonAcademy", withExtension: "storekit")!
    return try! SKTestSession(contentsOf: url)
}()

/// The real `StoreKitPremiumStore` against ios/StoreKit/DragonAcademy.storekit
/// (the same file the scheme runs the app with), through `SKTestSession`.
/// Serialized: the session's state is shared by the whole process.
///
/// Opt-in: on the Xcode 27.1 beta simulator, an `SKTestSession` purchase in a
/// headless test run never completes, so the whole test run hangs. Run these
/// with `DA_RUN_STOREKIT_TESTS=1` in the scheme's test environment (or from
/// Xcode, where they can show the purchase sheet). `PremiumModelTests` covers
/// the purchase logic against a scripted store on every run. The time limit
/// turns any remaining hang into a failure instead of a stuck run.
@MainActor
@Suite(
    .serialized,
    .enabled(if: ProcessInfo.processInfo.environment["DA_RUN_STOREKIT_TESTS"] == "1"),
    .timeLimit(.minutes(1))
)
struct StoreKitPremiumStoreTests {
    let session = sharedSession

    init() {
        session.resetToDefaultState()
        session.disableDialogs = true
        session.askToBuyEnabled = false
        session.clearTransactions()
    }

    @Test func theConfigurationSellsExactlyThePremiumProducts() async throws {
        let products = try await StoreKitPremiumStore().products(ids: PremiumProducts.all)

        #expect(products.map(\.id) == PremiumProducts.all)
        #expect(products.map(\.period) == [.year, .month])
        #expect(products.allSatisfy { !$0.displayPrice.isEmpty && !$0.displayName.isEmpty })
    }

    @Test func aPurchaseUnlocksPremiumAndCarriesTheAppAccountToken() async throws {
        let store = StoreKitPremiumStore()
        let token = UUID()
        #expect(await store.entitledProductIDs().isEmpty)

        let outcome = try await store.purchase(productID: PremiumProducts.yearly, appAccountToken: token)

        #expect(outcome == .purchased(productID: PremiumProducts.yearly))
        #expect(await store.entitledProductIDs() == [PremiumProducts.yearly])
        let latest = try #require(await Transaction.latest(for: PremiumProducts.yearly))
        guard case .verified(let transaction) = latest else {
            Issue.record("Transaction didn't verify")
            return
        }
        #expect(transaction.appAccountToken == token)
    }

    @Test func thePurchaseScreenUnlocksPremiumThroughTheRealStore() async throws {
        let store = StoreKitPremiumStore()
        let model = PremiumModel(dependencies: PremiumDependencies(store: store, planStatus: FakePlanStatusService()) { _ in })
        await model.load()
        #expect(!model.isPremium)

        await model.buy(PremiumProducts.monthly)

        #expect(model.notice == .purchased)
        #expect(model.isPremium)
        #expect(model.entitledProductIDs == [PremiumProducts.monthly])
    }

    @Test func restoreFindsASubscriptionBoughtOutsideTheApp() async throws {
        // As if bought on another device with the same Apple Account.
        try await session.buyProduct(identifier: PremiumProducts.monthly)
        let store = StoreKitPremiumStore()

        try await store.restore()

        #expect(await store.entitledProductIDs() == [PremiumProducts.monthly])
    }

    @Test func restoreThroughThePurchaseScreenUnlocksPremium() async throws {
        try await session.buyProduct(identifier: PremiumProducts.yearly)
        let model = PremiumModel(dependencies: PremiumDependencies(
            store: StoreKitPremiumStore(), planStatus: FakePlanStatusService()) { _ in })

        await model.restore()

        #expect(model.notice == .restored)
        #expect(model.isPremium)
    }

    @Test func askToBuyIsPendingUntilApprovedThenArrivesAsAnUpdate() async throws {
        session.askToBuyEnabled = true
        let store = StoreKitPremiumStore()
        store.start()
        let updates = store.transactionUpdates()

        let outcome = try await store.purchase(productID: PremiumProducts.yearly, appAccountToken: UUID())
        #expect(outcome == .pending)
        #expect(await store.entitledProductIDs().isEmpty)

        let pending = try #require(session.allTransactions().first { $0.pendingAskToBuyConfirmation })
        try session.approveAskToBuyTransaction(identifier: pending.identifier)

        var iterator = updates.makeAsyncIterator()
        _ = await iterator.next()
        #expect(await store.entitledProductIDs() == [PremiumProducts.yearly])
    }

    @Test func anExpiredOrRefundedSubscriptionIsNotPremium() async throws {
        let store = StoreKitPremiumStore()
        _ = try await store.purchase(productID: PremiumProducts.monthly, appAccountToken: UUID())
        try session.expireSubscription(productIdentifier: PremiumProducts.monthly)
        #expect(await store.entitledProductIDs().isEmpty)

        _ = try await store.purchase(productID: PremiumProducts.yearly, appAccountToken: UUID())
        let bought = try #require(session.allTransactions().last { $0.productIdentifier == PremiumProducts.yearly })
        try session.refundTransaction(identifier: bought.identifier)
        #expect(await store.entitledProductIDs().isEmpty)
    }

    @Test func aStoreKitCancellationIsCancelledNotAFailure() async throws {
        try await session.setSimulatedError(.generic(.userCancelled), forAPI: .purchase)
        let store = StoreKitPremiumStore()

        let outcome = try await store.purchase(productID: PremiumProducts.yearly, appAccountToken: UUID())

        #expect(outcome == .cancelled)
        try await session.setSimulatedError(nil, forAPI: .purchase)
    }

    @Test func anUnknownProductIsNotFound() async {
        await #expect(throws: PremiumStoreError.productNotFound) {
            try await StoreKitPremiumStore().purchase(productID: "not.a.product", appAccountToken: UUID())
        }
    }
}
