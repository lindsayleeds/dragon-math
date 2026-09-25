import Store
import SwiftUI

/// Where the app can navigate to from the map.
enum Route: Hashable {
    case battle(nodeID: Int)
    case lair(LairRoute)
    /// The Dragon's Trial placement test, from the map or the lair.
    case trial
    /// The Dragon Den, the kid's collection.
    case collection
}

/// The app's root. It first decides who is playing (`CurrentPlayer`). With
/// no parent signed in the guest goes straight to the map. On a family device
/// the kid screens start at the family picker, and the chosen kid gets the
/// map with battles and the Learning Lair pushed on top. Everything below reads who is playing from
/// `@Environment(\.currentProfile)`.
///
/// The parent area is presented from here, above that choice: signing in
/// swaps the map for the picker underneath it, and a cover presented from the
/// map would close with it. So is kid sign-in by link or QR code (#132): kid
/// and family links arrive here as universal links, and "I have a login code"
/// opens the same sheet.
struct RootView: View {
    @Environment(\.player) private var player
    @Environment(\.store) private var store
    @Environment(\.parentAccess) private var parentAccess
    @Environment(\.premiumAccess) private var premiumAccess
    @Environment(\.kidSignIn) private var kidSignIn
    @State private var showingParentAccess = false

    var body: some View {
        Group {
            if let player {
                if let profile = player.profile {
                    PlayerNavigation(switchKid: player.mode == .guest ? nil : { player.switchKid() })
                        .profileFontTheme()
                        .environment(\.currentProfile, profile)
                        // A new kid starts on their own map, not the last kid's battle.
                        .id(profile.id)
                } else if player.mode == .kid, let kidSignIn {
                    KidLandingView(player: player, kidSignIn: kidSignIn)
                } else {
                    FamilyPickerView(player: player)
                }
            } else {
                // Previews and tests that don't set a player.
                PlayerNavigation(switchKid: nil)
                    .profileFontTheme()
                    .environment(\.currentProfile, store?.guestProfile)
            }
        }
        .environment(\.openParentAccess, OpenParentAccess { showingParentAccess = true })
        .sheet(isPresented: Binding(
            get: { kidSignIn?.isPresented ?? false },
            set: { kidSignIn?.isPresented = $0 })
        ) {
            if let kidSignIn { KidSignInView(model: kidSignIn) }
        }
        // A kid or family link tapped in Mail, Messages or Safari (universal
        // links); SwiftUI delivers them to either handler, and the model
        // ignores a second delivery of the link it's already signing in with.
        .onOpenURL { url in kidSignIn?.open(url) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { kidSignIn?.open(url) }
        }
        // Closing the parent area refreshes the family (a child may have been
        // added, or the parent signed in or out) and then who has Premium (a
        // grown-up may have just bought it).
        .fullScreenCover(isPresented: $showingParentAccess, onDismiss: {
            Task {
                await player?.refresh()
                await premiumAccess?.refresh()
            }
        }) {
            ParentAccessView(dependencies: parentAccess)
        }
        .task { await player?.refresh() }
    }
}

extension RootView {
    /// The path unwound to the lair's front door (the map, if the lair isn't
    /// on it) — where finishing or leaving a lair game lands, as on the web.
    nonisolated static func backToLair(_ path: [Route]) -> [Route] {
        guard let front = path.lastIndex(of: .lair(.subjects)) else { return [] }
        return Array(path[...front])
    }
}

/// Opens the parent area (presented by `RootView`).
struct OpenParentAccess {
    let action: @MainActor () -> Void
    @MainActor func callAsFunction() { action() }
}

extension EnvironmentValues {
    @Entry var openParentAccess = OpenParentAccess {}
}

/// The map, with battles, the Learning Lair, the Dragon's Trial and the Den pushed on
/// top, for whoever is playing.
private struct PlayerNavigation: View {
    /// Back to the family picker; nil in guest mode.
    let switchKid: (() -> Void)?

    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            MapScreen(
                onSelectNode: { path.append(.battle(nodeID: $0)) },
                onOpenLair: { path.append(.lair(.subjects)) },
                onTakeTrial: { path.append(.trial) },
                onOpenCollection: { path.append(.collection) },
                switchKid: switchKid)
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .battle(let nodeID):
                        BattleScreen(nodeID: nodeID)
                    case .lair(let lairRoute):
                        LairScreen(
                            route: lairRoute,
                            navigate: { path.append(.lair($0)) },
                            backToLair: { path = RootView.backToLair(path) },
                            openTrial: { path.append(.trial) })
                    case .trial:
                        // Done or not, the trial leaves for the map, where the
                        // placement shows.
                        TrialScreen(onBackToMap: { path = [] })
                    case .collection:
                        DragonCollectionScreen()
                    }
                }
        }
    }
}

/// The way into the parent area. Small and out of the way; what keeps kids
/// out is the gate and device check behind it, not the button being hard to
/// find.
struct GrownUpsButton: View {
    @Environment(\.openParentAccess) private var openParentAccess

    var body: some View {
        Button {
            openParentAccess()
        } label: {
            Label("Grown-ups", systemImage: "lock.fill")
                .lineLimit(1)
                .fixedSize()
        }
        .buttonStyle(StampButtonStyle(kind: .secondary))
        .accessibilityIdentifier("home.grownUps")
    }
}
