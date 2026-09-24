import API
import Foundation
import OSLog
import Store
import SwiftUI
import Sync

@main
struct DragonAcademyApp: App {
    /// The local database, opened once at launch (ADR 0003).
    private let store: any Store
    /// The session token the API client and Sync share.
    private let session = SessionTokens()
    /// Uploads the event queue in the background; never awaited by the UI.
    private let sync: SyncEngine

    @Environment(\.scenePhase) private var scenePhase

    init() {
        let store = Self.openStore()
        let session = session
        self.store = store
        sync = SyncEngine(
            store: store,
            client: DragonAPIClient(baseURL: Self.serverURL, tokenProvider: session.provider),
            hasSession: { await session.current() != nil },
            reachability: NWPathReachability())
    }

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environment(\.store, store)
                .environment(\.sync, sync)
                .task { await sync.start() }
                .onChange(of: scenePhase, initial: true) { _, phase in
                    if phase == .active { sync.requestSync(.foreground) }
                }
        }
    }

    private static let serverURL = URL(string: "https://mydragonmath.com")!

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

    /// The app's `SyncEngine`; nil only in previews and tests that don't set
    /// one. Call `requestSync()` (it returns at once), e.g. when a battle ends.
    @Entry var sync: SyncEngine? = nil
}
