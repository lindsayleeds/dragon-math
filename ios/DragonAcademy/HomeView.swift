import API
import Audio
import GameRules
import Store
import Sync
import SwiftUI

/// Placeholder home screen. Real features (family picker, map, battles) replace
/// it in later tickets; for now it proves the app launches and links every
/// local package.
struct HomeView: View {
    static let linkedModules = [
        GameRulesModule.name,
        StoreModule.name,
        APIModule.name,
        SyncModule.name,
        AudioModule.name,
    ]

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "flame.fill")
                .font(.system(size: 64))
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            Text("Dragon Academy")
                .font(.largeTitle.bold())
            Text("Your adventure is being prepared.")
                .font(.title3)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("home")
    }
}

#Preview {
    HomeView()
}
