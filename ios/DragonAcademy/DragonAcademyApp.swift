import API
import Diagnostics
import Foundation
import GameRules
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
    /// The parent's children on the server, for the parent view (#123).
    private let family: any FamilyService
    /// StoreKit and the plan status for the Premium screen (ADR 0008).
    private let premium: PremiumDependencies
    /// Queues MetricKit's crash and performance reports and uploads them,
    /// best effort, with no session: they are not linked to anyone
    /// (docs/IOS_PRIVACY_LABEL.md).
    private let diagnostics: DiagnosticsUploader
    /// Hands MetricKit's reports to `diagnostics`; held for the app's lifetime.
    private let metricKit: MetricKitSubscriber
    /// Each child's stats on the server, for the parent view (#150).
    private let childStats: any ChildStatsService

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
        let diagnostics = Self.makeDiagnostics()
        self.diagnostics = diagnostics
        metricKit = MetricKitSubscriber(uploader: diagnostics)
        metricKit.start()
        if AppConfiguration.usesParentAccessFakes {
            // Fake tokens stay out of SessionTokens, so Sync never sends one.
            parentAccess = .fake()
            family = FakeFamilyService()
            childStats = FakeChildStatsService()
        } else {
            family = APIFamilyService(api: client.api)
            childStats = APIChildStatsService(api: client.api)
            parentAccess = .live(api: client.api, sessionStore: sessions) { parent in
                await session.set(parent?.token)
                if parent != nil { sync.requestSync(.signedIn) }
            }
        }
        // Listening from launch, so unfinished and out-of-app transactions
        // are finished. With the fakes the store is still StoreKit (the
        // scheme's StoreKit configuration in the simulator); only the server is faked.
        let premiumStore = StoreKitPremiumStore()
        premiumStore.start()
        premium = AppConfiguration.usesParentAccessFakes
            ? PremiumDependencies(store: premiumStore, planStatus: FakePlanStatusService())
            : .live(api: client.api, store: premiumStore)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.store, store)
                .environment(\.sync, sync)
                .environment(\.parentAccess, parentAccess)
                .environment(\.family, family)
                .environment(\.makeBattleRandomSource, LaunchOptions.battleRandomSource)
                .environment(\.premium, premium)
                .environment(\.childStats, childStats)
                .task { await sync.start() }
                .onChange(of: scenePhase, initial: true) { _, phase in
                    if phase == .active {
                        sync.requestSync(.foreground)
                        diagnostics.requestFlush()
                    }
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

    private static func makeDiagnostics() -> DiagnosticsUploader {
        let queue: DiagnosticsQueue
        do {
            queue = try DiagnosticsQueue.applicationDefault()
        } catch {
            // Best effort: reports queued here are lost at the next cleanup.
            queue = DiagnosticsQueue(directory: FileManager.default.temporaryDirectory.appending(path: "MetricKit"))
        }
        return DiagnosticsUploader(
            queue: queue,
            // No token provider: a report must never carry a session.
            client: DragonAPIClient(baseURL: AppConfiguration.apiBaseURL, tokenProvider: { nil }),
            appVersion: DiagnosticsUploader.appVersion(of: .main),
            osVersion: ProcessInfo.processInfo.operatingSystemVersionString)
    }

    private static func openStore() -> any Store {
        #if DEBUG
        if LaunchOptions.resetStore { LaunchOptions.deleteDefaultStore() }
        #endif
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

    /// Where a new battle gets its randomness: the system generator for live
    /// play (the web's `Math.random`), a seeded one under the debug launch
    /// argument.
    @Entry var makeBattleRandomSource: @Sendable () -> AnyRandomSource = { AnyRandomSource(SystemRandomSource()) }
}

/// Launch arguments, for UI tests. Debug builds only; a release build ignores
/// them and always plays with the system generator and the saved store.
///
///   -DABattleSeed <UInt64>   every battle draws from SeededRandom(seed), so
///                            problems, grids and opponent pace repeat
///   -DAResetStore YES        delete the on-disk store before opening it
///
/// (`-name value` arguments land in UserDefaults' argument domain.)
enum LaunchOptions {
    static var battleRandomSource: @Sendable () -> AnyRandomSource {
        #if DEBUG
        if let seed = UserDefaults.standard.string(forKey: "DABattleSeed").flatMap(UInt64.init) {
            return { AnyRandomSource(SeededRandom(seed: seed)) }
        }
        #endif
        return { AnyRandomSource(SystemRandomSource()) }
    }

    #if DEBUG
    static var resetStore: Bool { UserDefaults.standard.bool(forKey: "DAResetStore") }

    /// Removes the folder `SQLiteStore.applicationDefault()` opens (the
    /// database and its -wal/-shm files).
    static func deleteDefaultStore() {
        guard let support = try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
        else { return }
        try? FileManager.default.removeItem(at: support.appending(path: "Store"))
    }
    #endif
}
