/// The App Store products that grant Premium (ADR 0008). These must be the
/// same ids as the server's `APPSTORE_PREMIUM_PRODUCT_IDS` (docs/APP_STORE.md),
/// or a purchase is recorded on the server but grants nothing.
///
/// They are placeholders, like the bundle id: a human creates both
/// auto-renewable subscriptions, in one subscription group, in App Store
/// Connect once the paid developer account exists, then updates these ids,
/// ios/StoreKit/DragonAcademy.storekit and the server env together.
enum PremiumProducts {
    static let monthly = "dev.placeholder.dragonacademy.premium.monthly"
    static let yearly = "dev.placeholder.dragonacademy.premium.yearly"

    /// Display order: annual first, as the default "best value" choice
    /// (docs/PRICING_STRATEGY.md).
    static let all = [yearly, monthly]
}
