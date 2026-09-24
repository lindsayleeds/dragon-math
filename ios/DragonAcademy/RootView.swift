import SwiftUI

/// Where the app can navigate to from the map.
enum Route: Hashable {
    case battle(nodeID: Int)
}

/// The app's navigation: the map, with battles pushed on top. A new install
/// plays as the Store's guest profile.
struct RootView: View {
    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            MapScreen(onSelectNode: { path.append(.battle(nodeID: $0)) })
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .battle(let nodeID):
                        BattleScreen(nodeID: nodeID)
                    }
                }
        }
    }
}
