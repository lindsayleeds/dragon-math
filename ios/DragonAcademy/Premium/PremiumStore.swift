import Foundation
import OSLog
import StoreKit

/// A Premium subscription as the purchase screen shows it. Plain data, so the
/// model and its tests never touch StoreKit types.
struct PremiumProduct: Identifiable, Equatable, Sendable {
    enum Period: Equatable, Sendable {
        case month
        case year
    }

    let id: String
    let displayName: String
    let description: String
    /// Localized by the App Store, e.g. "$59.99".
    let displayPrice: String
    let period: Period?
}

enum PurchaseOutcome: Equatable, Sendable {
    /// Verified and finished.
    case purchased(productID: String)
    /// Waiting on someone else, e.g. Ask to Buy or a bank check. The result
    /// arrives later through `transactionUpdates()`.
    case pending
    case cancelled
}

enum PremiumStoreError: Error, Equatable {
    case productNotFound
    /// The person backed out (e.g. of the App Store sign-in during a restore).
    case cancelled
    /// StoreKit returned a transaction whose signature didn't verify; nothing
    /// is granted for it.
    case unverified
    /// No connection, purchases not allowed on this device, or anything else.
    case failed
}

/// StoreKit 2, behind a protocol so `PremiumModel` can be tested without it.
/// `StoreKitPremiumStore` is the real one; its tests run it against
/// ios/StoreKit/DragonAcademy.storekit with `SKTestSession`.
protocol PremiumStore: Sendable {
    /// In the order of `ids`; ids the App Store doesn't know are left out.
    func products(ids: [String]) async throws(PremiumStoreError) -> [PremiumProduct]

    /// Buys with `appAccountToken`, which Apple repeats on every transaction
    /// of the subscription so the server can credit this family
    /// (docs/APP_STORE.md). A verified transaction is finished before this
    /// returns.
    func purchase(productID: String, appAccountToken: UUID) async throws(PremiumStoreError) -> PurchaseOutcome

    /// Restore Purchases: `AppStore.sync()`. May ask the person to sign in.
    func restore() async throws(PremiumStoreError)

    /// The Premium products this Apple Account is entitled to right now
    /// (verified, not revoked, not expired).
    func entitledProductIDs() async -> Set<String>

    /// Ticks after each transaction that arrives outside `purchase` (a
    /// renewal, an approved Ask to Buy, a refund, a purchase on another
    /// device), once it has been finished. Ends when the caller stops iterating.
    func transactionUpdates() -> AsyncStream<Void>
}

/// The real store. Create one at launch and call `start()` at once: StoreKit
/// delivers unfinished transactions and anything that happened while the app
/// was closed to `Transaction.updates`, and only a running listener finishes
/// them.
final class StoreKitPremiumStore: PremiumStore, @unchecked Sendable {
    /// The products this store deals in; anything else is ignored.
    let productIDs: Set<String>

    private let lock = NSLock()
    private var listener: Task<Void, Never>?
    private var observers: [UUID: AsyncStream<Void>.Continuation] = [:]
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Premium")

    init(productIDs: some Sequence<String> = PremiumProducts.all) {
        self.productIDs = Set(productIDs)
    }

    deinit {
        listener?.cancel()
    }

    /// Starts listening to `Transaction.updates`. Safe to call more than once.
    func start() {
        lock.withLock {
            guard listener == nil else { return }
            listener = Task.detached(priority: .background) { [weak self] in
                for await update in Transaction.updates {
                    await self?.handle(update)
                }
            }
        }
    }

    func products(ids: [String]) async throws(PremiumStoreError) -> [PremiumProduct] {
        let found: [Product]
        do {
            found = try await Product.products(for: ids)
        } catch {
            log.error("Couldn't load products: \(error)")
            throw .failed
        }
        let byID = Dictionary(found.map { ($0.id, $0) }) { first, _ in first }
        return ids.compactMap { byID[$0].map(Self.premiumProduct) }
    }

    func purchase(productID: String, appAccountToken: UUID) async throws(PremiumStoreError) -> PurchaseOutcome {
        let product: Product
        do {
            guard let found = try await Product.products(for: [productID]).first else { throw PremiumStoreError.productNotFound }
            product = found
        } catch let error as PremiumStoreError {
            throw error
        } catch {
            log.error("Couldn't load \(productID): \(error)")
            throw .failed
        }

        let result: Product.PurchaseResult
        do {
            result = try await product.purchase(options: [.appAccountToken(appAccountToken)])
        } catch StoreKitError.userCancelled {
            return .cancelled
        } catch {
            log.error("Purchase of \(productID) failed: \(error)")
            throw .failed
        }

        switch result {
        case .success(.verified(let transaction)):
            await transaction.finish()
            return .purchased(productID: transaction.productID)
        case .success(.unverified(let transaction, let error)):
            // Left unfinished: StoreKit offers it again, and nothing is granted.
            log.error("Unverified transaction \(transaction.id) for \(productID): \(error)")
            throw .unverified
        case .pending:
            return .pending
        case .userCancelled:
            return .cancelled
        @unknown default:
            throw .failed
        }
    }

    func restore() async throws(PremiumStoreError) {
        do {
            try await AppStore.sync()
        } catch StoreKitError.userCancelled {
            throw .cancelled
        } catch {
            log.error("Restore failed: \(error)")
            throw .failed
        }
    }

    func entitledProductIDs() async -> Set<String> {
        var ids: Set<String> = []
        for await entitlement in Transaction.currentEntitlements {
            guard case .verified(let transaction) = entitlement, grantsPremium(transaction) else { continue }
            ids.insert(transaction.productID)
        }
        return ids
    }

    func transactionUpdates() -> AsyncStream<Void> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        continuation.onTermination = { [weak self] _ in
            self?.lock.withLock { _ = self?.observers.removeValue(forKey: id) }
        }
        lock.withLock { observers[id] = continuation }
        return stream
    }

    private func handle(_ update: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = update else {
            log.error("Ignoring an unverified transaction update")
            return
        }
        // Finish even products this build doesn't sell, or StoreKit would
        // keep delivering them on every launch.
        await transaction.finish()
        guard productIDs.contains(transaction.productID) else { return }
        let observers = lock.withLock { Array(self.observers.values) }
        for observer in observers { observer.yield() }
    }

    private func grantsPremium(_ transaction: Transaction, now: Date = .now) -> Bool {
        guard productIDs.contains(transaction.productID), transaction.revocationDate == nil else { return false }
        if let expires = transaction.expirationDate, expires <= now { return false }
        return true
    }

    private static func premiumProduct(_ product: Product) -> PremiumProduct {
        let period: PremiumProduct.Period? = switch product.subscription?.subscriptionPeriod {
        case let p? where p.unit == .year && p.value == 1: .year
        case let p? where p.unit == .month && p.value == 1: .month
        default: nil
        }
        return PremiumProduct(
            id: product.id,
            displayName: product.displayName,
            description: product.description,
            displayPrice: product.displayPrice,
            period: period
        )
    }
}

/// Sells both products instantly, for previews.
final class FakePremiumStore: PremiumStore, @unchecked Sendable {
    private let lock = NSLock()
    private var entitled: Set<String>

    init(entitled: Set<String> = []) {
        self.entitled = entitled
    }

    func products(ids: [String]) async throws(PremiumStoreError) -> [PremiumProduct] {
        let catalog = [
            PremiumProduct(id: PremiumProducts.yearly, displayName: "Premium (yearly)",
                           description: "Everything, for the whole family", displayPrice: "$59.99", period: .year),
            PremiumProduct(id: PremiumProducts.monthly, displayName: "Premium (monthly)",
                           description: "Everything, for the whole family", displayPrice: "$7.99", period: .month),
        ]
        return ids.compactMap { id in catalog.first { $0.id == id } }
    }

    func purchase(productID: String, appAccountToken: UUID) async throws(PremiumStoreError) -> PurchaseOutcome {
        lock.withLock { _ = entitled.insert(productID) }
        return .purchased(productID: productID)
    }

    func restore() async throws(PremiumStoreError) {}

    func entitledProductIDs() async -> Set<String> { lock.withLock { entitled } }

    func transactionUpdates() -> AsyncStream<Void> { AsyncStream { _ in } }
}
