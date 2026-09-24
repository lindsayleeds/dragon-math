import OSLog
import Store
import SwiftUI

@main
struct DragonAcademyApp: App {
    /// The local database, opened once at launch (ADR 0003).
    private let store: any Store = Self.openStore()

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environment(\.store, store)
        }
    }

    private static func openStore() -> any Store {
        do {
            return try SQLiteStore.applicationDefault()
        } catch {
            // Keep the app playable for this session rather than crash; what
            // is already on disk stays there for the next launch.
            Logger(subsystem: "dev.placeholder.dragonacademy", category: "Store")
                .fault("Couldn't open the on-disk store, using memory: \(error)")
            do {
                return try SQLiteStore.inMemory()
            } catch {
                fatalError("Couldn't open an in-memory store: \(error)")
            }
        }
    }
}

extension EnvironmentValues {
    /// The app's `Store`; nil only in previews and tests that don't set one.
    @Entry var store: (any Store)? = nil
}
