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
    /// The session token the API client and Sync share. Seeded from the
    /// Keychain at launch, so a parent stays signed in across launches.
    private let session: SessionTokens
    /// Uploads the event queue in the background; never awaited by the UI.
    private let sync: SyncEngine
    /// Parent sign-in and its session (ADR 0007).
    private let parentAccess: ParentAccessDependencies

    @Environment(\.scenePhase) private var scenePhase

    init() {
        let store = Self.openStore()
        let sessions = KeychainParentSessionStore()
        let session = SessionTokens(token: Self.storedSession(in: sessions)?.token)
        let client = DragonAPIClient(baseURL: AppConfiguration.apiBaseURL, tokenProvider: session.provider)
        let sync = SyncEngine(
            store: store,
            client: client,
            hasSession: { await session.current() != nil },
            reachability: NWPathReachability())
        self.store = store
        self.session = session
        self.sync = sync
        if AppConfiguration.usesParentAccessFakes {
            // Fake tokens stay out of SessionTokens, so Sync never sends one.
            parentAccess = .fake()
        } else {
            parentAccess = .live(api: client.api, sessionStore: sessions) { parent in
                await session.set(parent?.token)
                if parent != nil { sync.requestSync(.signedIn) }
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environment(\.store, store)
                .environment(\.sync, sync)
                .environment(\.parentAccess, parentAccess)
                .task { await sync.start() }
                .onChange(of: scenePhase, initial: true) { _, phase in
                    if phase == .active { sync.requestSync(.foreground) }
                }
        }
    }

    /// The Keychain session if it hasn't expired; an expired one is removed.
    private static func storedSession(in sessions: some ParentSessionStore) -> ParentSession? {
        do {
            guard let stored = try sessions.load() else { return nil }
            if stored.isExpired() {
                try sessions.clear()
                return nil
            }
            return stored
        } catch {
            Logger(subsystem: "dev.placeholder.dragonacademy", category: "ParentAccess")
                .error("Couldn't read the parent session: \(error)")
            return nil
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

    /// The app's `SyncEngine`; nil only in previews and tests that don't set
    /// one. Call `requestSync()` (it returns at once), e.g. when a battle ends.
    @Entry var sync: SyncEngine? = nil

    /// Fakes by default, so previews never touch Face ID, Apple or the server.
    @Entry var parentAccess: ParentAccessDependencies = .fake()
}
