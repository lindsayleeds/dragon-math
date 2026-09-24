import API
import Foundation
import OSLog
import SwiftUI

/// What the purchase screen talks to, swappable for fakes.
struct PremiumDependencies: Sendable {
    var store: any PremiumStore
    var planStatus: any PlanStatusService
    /// Between checks with the server after a purchase; tests skip it.
    var sleep: @Sendable (Duration) async -> Void = { try? await Task.sleep(for: $0) }

    static func live(api: any APIProtocol, store: any PremiumStore) -> Self {
        Self(store: store, planStatus: APIPlanStatusService(api: api))
    }

    /// No StoreKit and no server; for previews.
    static func fake() -> Self {
        Self(store: FakePremiumStore(), planStatus: FakePlanStatusService())
    }
}

extension EnvironmentValues {
    /// Fakes by default, so previews never touch StoreKit or the server.
    @Entry var premium: PremiumDependencies = .fake()
}

/// The Premium purchase screen's state (ADR 0008). The screen lives inside the
/// parent view, so the parental gate and device check have already run.
///
/// Premium is shown as unlocked when either the server's plan status says so
/// or StoreKit holds a current entitlement on this device. The server is the
/// source of truth for everything it gates, but it learns of an App Store
/// purchase from Apple's notification, usually a few seconds later, so the
/// local entitlement covers the gap and the model asks the server again a few
/// times after each purchase or restore.
@MainActor
@Observable
final class PremiumModel {
    enum Phase: Equatable {
        case loading
        case ready
        /// The App Store products couldn't be loaded.
        case failed
    }

    enum Notice: Equatable {
        case purchased
        /// Ask to Buy or another check; it finishes on its own later.
        case pending
        case restored
        case nothingToRestore
        case purchaseFailed
        case restoreFailed
        /// No `appAccountToken` from the server, so buying would credit nobody.
        case accountUnavailable
    }

    /// After a purchase, how long to wait before each re-check of the server.
    static let serverRetryDelays: [Duration] = [.seconds(2), .seconds(5), .seconds(10)]

    private(set) var phase: Phase = .loading
    private(set) var products: [PremiumProduct] = []
    private(set) var plan: PlanStatusSnapshot?
    private(set) var entitledProductIDs: Set<String> = []
    private(set) var purchasingProductID: String?
    private(set) var isRestoring = false
    private(set) var notice: Notice?

    private let dependencies: PremiumDependencies
    private let productIDs: [String]
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Premium")

    init(dependencies: PremiumDependencies, productIDs: [String] = PremiumProducts.all) {
        self.dependencies = dependencies
        self.productIDs = productIDs
    }

    var isPremium: Bool { plan?.isPremium == true || !entitledProductIDs.isEmpty }

    /// Bought through the App Store here, and the server hasn't caught up yet.
    var isAwaitingServer: Bool { !entitledProductIDs.isEmpty && plan?.isPremium != true }

    var isBusy: Bool { purchasingProductID != nil || isRestoring }

    func load() async {
        phase = .loading
        async let products = loadProducts()
        async let entitled = dependencies.store.entitledProductIDs()
        _ = await refreshPlan()
        entitledProductIDs = await entitled
        if let products = await products {
            self.products = products
            phase = .ready
        } else {
            phase = .failed
        }
    }

    func buy(_ productID: String) async {
        guard !isBusy else { return }
        purchasingProductID = productID
        notice = nil
        let outcome = await purchase(productID)
        purchasingProductID = nil
        if case .purchased = outcome { await confirmWithServer() }
    }

    /// The purchase itself; sets `notice`. Nil when it never got going or failed.
    private func purchase(_ productID: String) async -> PurchaseOutcome? {
        var token = plan?.appAccountToken
        if token == nil { token = await refreshPlan()?.appAccountToken }
        guard let token else {
            notice = .accountUnavailable
            return nil
        }
        let outcome: PurchaseOutcome
        do {
            outcome = try await dependencies.store.purchase(productID: productID, appAccountToken: token)
        } catch {
            notice = .purchaseFailed
            return nil
        }
        switch outcome {
        case .purchased(let owned):
            entitledProductIDs = await dependencies.store.entitledProductIDs().union([owned])
            notice = .purchased
        case .pending:
            notice = .pending
        case .cancelled:
            break
        }
        return outcome
    }

    func restore() async {
        guard !isBusy else { return }
        isRestoring = true
        notice = nil
        do {
            try await dependencies.store.restore()
        } catch .cancelled {
            isRestoring = false
            return
        } catch {
            isRestoring = false
            notice = .restoreFailed
            return
        }
        entitledProductIDs = await dependencies.store.entitledProductIDs()
        isRestoring = false
        notice = entitledProductIDs.isEmpty && plan?.isPremium != true ? .nothingToRestore : .restored
        if !entitledProductIDs.isEmpty { await confirmWithServer() }
    }

    /// Follows transactions finished outside `buy` (an approved Ask to Buy, a
    /// renewal, a refund) while the screen is open. Run from the view's `.task`.
    func observeTransactions() async {
        for await _ in dependencies.store.transactionUpdates() {
            entitledProductIDs = await dependencies.store.entitledProductIDs()
            if notice == .pending, !entitledProductIDs.isEmpty { notice = .purchased }
            _ = await refreshPlan()
        }
    }

    /// Asks the server again until it reports premium, or gives up; the local
    /// entitlement keeps premium unlocked either way.
    private func confirmWithServer() async {
        if await refreshPlan()?.isPremium == true { return }
        for delay in Self.serverRetryDelays {
            await dependencies.sleep(delay)
            if await refreshPlan()?.isPremium == true { return }
        }
        log.info("Server hasn't reported premium yet; the App Store notification may be delayed")
    }

    /// The latest plan status, or nil if it couldn't be read (the last one
    /// read is kept).
    private func refreshPlan() async -> PlanStatusSnapshot? {
        do {
            let status = try await dependencies.planStatus.status()
            plan = status
            return status
        } catch {
            log.error("Couldn't load the plan status: \(String(describing: error))")
            return nil
        }
    }

    private func loadProducts() async -> [PremiumProduct]? {
        do {
            return try await dependencies.store.products(ids: productIDs)
        } catch {
            return nil
        }
    }
}
