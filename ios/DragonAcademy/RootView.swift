import SwiftUI

/// Where the app can navigate to from the map.
enum Route: Hashable {
    case battle(nodeID: Int)
    case lair(LairRoute)
}

/// The app's navigation: the map, with battles and the Learning Lair pushed on
/// top. A new install plays as the Store's guest profile.
struct RootView: View {
    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            MapScreen(
                onSelectNode: { path.append(.battle(nodeID: $0)) },
                onOpenLair: { path.append(.lair(.subjects)) })
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .battle(let nodeID):
                        BattleScreen(nodeID: nodeID)
                    case .lair(let lairRoute):
                        LairScreen(
                            route: lairRoute,
                            navigate: { path.append(.lair($0)) },
                            backToLair: { path = Self.backToLair(path) })
                    }
                }
        }
    }

    /// The path unwound to the lair's front door (the map, if the lair isn't
    /// on it) — where finishing or leaving a lair game lands, as on the web.
    nonisolated static func backToLair(_ path: [Route]) -> [Route] {
        guard let front = path.lastIndex(of: .lair(.subjects)) else { return [] }
        return Array(path[...front])
    }
}
