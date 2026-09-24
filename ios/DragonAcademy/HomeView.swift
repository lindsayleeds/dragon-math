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
    @Environment(\.parentAccess) private var parentAccess
    @State private var showingParentAccess = false

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
        .overlay(alignment: .topTrailing) {
            // Small and out of the way; what keeps kids out is the gate and
            // device check behind it, not the button being hard to find.
            Button {
                showingParentAccess = true
            } label: {
                Label("Grown-ups", systemImage: "lock.fill")
                    .font(.footnote.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .padding()
            .accessibilityIdentifier("home.grownUps")
        }
        .fullScreenCover(isPresented: $showingParentAccess) {
            ParentAccessView(dependencies: parentAccess)
        }
    }
}

#Preview {
    HomeView()
}
