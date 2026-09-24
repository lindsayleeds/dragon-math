import StoreKit
import SwiftUI

/// The parent view's row that opens the purchase screen.
struct PremiumLink: View {
    @Environment(\.premium) private var premium

    var body: some View {
        NavigationLink {
            PremiumView(dependencies: premium)
        } label: {
            Label("Premium", systemImage: "star.circle.fill")
        }
        .accessibilityIdentifier("parentHome.premium")
    }
}

/// Buy, restore or manage Premium. Reached only from the parent view, which
/// is behind the parental gate and the device check (ADR 0008).
struct PremiumView: View {
    @State private var model: PremiumModel
    @State private var managingSubscription = false

    /// The subscription terms App Review asks every purchase screen to link.
    static let termsURL = URL(string: "https://mydragonmath.com/terms")!
    static let privacyURL = URL(string: "https://mydragonmath.com/privacy")!

    init(dependencies: PremiumDependencies) {
        _model = State(initialValue: PremiumModel(dependencies: dependencies))
    }

    init(model: PremiumModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                header
                if model.isPremium {
                    subscribedStatus
                } else {
                    productList
                }
                if let message {
                    Text(message)
                        .foregroundStyle(noticeIsError ? .red : .secondary)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("premium.notice")
                }
                Button("Restore Purchases") {
                    Task { await model.restore() }
                }
                .disabled(model.isBusy)
                .accessibilityIdentifier("premium.restore")
                legal
            }
            .frame(maxWidth: 480)
            .padding()
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Premium")
        .navigationBarTitleDisplayMode(.inline)
        .manageSubscriptionsSheet(isPresented: $managingSubscription)
        .task { await model.load() }
        .task { await model.observeTransactions() }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Image(systemName: "star.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.yellow)
                .accessibilityHidden(true)
            Text("Dragon Academy Premium")
                .font(.title.bold())
                .multilineTextAlignment(.center)
            VStack(alignment: .leading, spacing: 8) {
                Label("Every world and every game", systemImage: "map.fill")
                Label("Up to six children, one price", systemImage: "person.3.fill")
                Label("A weekly progress report for grown-ups", systemImage: "envelope.fill")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var subscribedStatus: some View {
        VStack(spacing: 12) {
            Label("You have Premium", systemImage: "checkmark.seal.fill")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.green)
                .accessibilityIdentifier("premium.active")
            if let source = sourceMessage {
                Text(source)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            if model.isAwaitingServer {
                Text("It may take a minute to appear on your other devices.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("premium.awaitingServer")
            }
            if !model.entitledProductIDs.isEmpty {
                Button("Manage Subscription") { managingSubscription = true }
                    .accessibilityIdentifier("premium.manage")
            }
        }
    }

    @ViewBuilder private var productList: some View {
        switch model.phase {
        case .loading:
            ProgressView()
        case .failed:
            VStack(spacing: 12) {
                Text("Couldn't reach the App Store. Check your connection and try again.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Try again") { Task { await model.load() } }
                    .accessibilityIdentifier("premium.retry")
            }
        case .ready:
            VStack(spacing: 12) {
                ForEach(model.products) { product in
                    ProductButton(product: product,
                                  isPurchasing: model.purchasingProductID == product.id,
                                  isBestValue: product.period == .year) {
                        Task { await model.buy(product.id) }
                    }
                    .disabled(model.isBusy)
                }
            }
        }
    }

    private var legal: some View {
        VStack(spacing: 8) {
            Text("Payment is charged to your Apple Account. The subscription renews automatically unless cancelled at least 24 hours before the end of the period. Manage or cancel it in Settings.")
            HStack(spacing: 16) {
                Link("Terms of Use", destination: Self.termsURL)
                Link("Privacy Policy", destination: Self.privacyURL)
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }

    private var sourceMessage: LocalizedStringKey? {
        guard model.plan?.isPremium == true else { return nil }
        switch model.plan?.source {
        case "stripe":
            return "Your subscription is managed on mydragonmath.com."
        case "classroom":
            return "Included with your classroom plan."
        case "comp":
            return "Premium is on us."
        default:
            return nil
        }
    }

    private var noticeIsError: Bool {
        switch model.notice {
        case .purchaseFailed, .restoreFailed, .accountUnavailable: true
        default: false
        }
    }

    private var message: LocalizedStringKey? {
        switch model.notice {
        case .purchased:
            "Thank you! Premium is unlocked."
        case .pending:
            "Your purchase is waiting for approval. Premium unlocks as soon as it's approved."
        case .restored:
            "Your purchases have been restored."
        case .nothingToRestore:
            "No Premium subscription was found for this Apple Account."
        case .purchaseFailed:
            "The purchase didn't go through. You haven't been charged. Please try again."
        case .restoreFailed:
            "Couldn't restore purchases. Check your connection and try again."
        case .accountUnavailable:
            "Couldn't reach Dragon Academy to link the purchase to your family. Check your connection and try again."
        case nil:
            nil
        }
    }
}

private struct ProductButton: View {
    let product: PremiumProduct
    let isPurchasing: Bool
    let isBestValue: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(product.displayName).font(.headline)
                        if isBestValue {
                            Text("Best value")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                                .background(.yellow.opacity(0.3), in: Capsule())
                        }
                    }
                    Text(product.description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if isPurchasing {
                    ProgressView()
                } else {
                    Text(priceText).font(.headline.monospacedDigit())
                }
            }
            .padding()
            .frame(maxWidth: .infinity)
            .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("premium.buy.\(product.id)")
    }

    private var priceText: String {
        switch product.period {
        case .year: String(localized: "\(product.displayPrice)/year", comment: "Subscription price per year")
        case .month: String(localized: "\(product.displayPrice)/month", comment: "Subscription price per month")
        case nil: product.displayPrice
        }
    }
}

#Preview("Free") {
    NavigationStack { PremiumView(dependencies: .fake()) }
}

#Preview("Premium") {
    NavigationStack {
        PremiumView(dependencies: PremiumDependencies(
            store: FakePremiumStore(entitled: [PremiumProducts.yearly]),
            planStatus: FakePlanStatusService()))
    }
}
