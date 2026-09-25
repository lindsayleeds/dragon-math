import API
import Audio
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
    /// Whether the kid playing has Premium, cached for offline play (#149).
    private let premiumAccess: PremiumAccess
    /// Queues MetricKit's crash and performance reports and uploads them,
    /// best effort, with no session: they are not linked to anyone
    /// (docs/IOS_PRIVACY_LABEL.md).
    private let diagnostics: DiagnosticsUploader
    /// Hands MetricKit's reports to `diagnostics`; held for the app's lifetime.
    private let metricKit: MetricKitSubscriber
    /// Each child's stats on the server, for the parent view (#150).
    private let childStats: any ChildStatsService
    /// Who is playing: the guest, or the kid picked on the family picker (#124).
    private let player: CurrentPlayer
    /// A child's Memorize passages, from the server.
    private let memorizePassages: any MemorizePassageSource
    /// Sound effects and spoken clips, and the kid Settings effects switch.
    private let audio = AudioPlayer.live()
    /// Kid sign-in by login link, family link or QR code (#132).
    private let kidSignIn: KidSignInModel
    /// Each child's custom spelling lists and their clips, kept by Sync (#161).
    private let spellingLists: SpellingListLibrary?

    @Environment(\.scenePhase) private var scenePhase

    init() {
        let store = Self.openStore()
        let sessions = KeychainParentSessionStore()
        let storedToken = Self.storedSession(in: sessions)?.token
        let kidSessions: any KidSessionStore = AppConfiguration.usesParentAccessFakes
            ? InMemoryKidSessionStore() : KeychainKidSessionStore()
        // A parent's session wins; a kid's own is kept only with no parent.
        let storedKid = storedToken == nil ? KidSignInModel.storedSession(in: kidSessions) : nil
        let session = SessionTokens(token: storedToken ?? storedKid?.token)
        let client = DragonAPIClient(baseURL: AppConfiguration.apiBaseURL, tokenProvider: session.provider)
        // The session is the parent's on a family iPad, so every kid's queue
        // uploads with it; when it's a kid's own, only theirs does. Sync gets
        // its own client whose token always matches the session it checked
        // (SessionTokens.syncProvider), so a kid's code replacing another
        // kid's mid-upload can't send the first kid's events as the second.
        let syncClient = DragonAPIClient(baseURL: AppConfiguration.apiBaseURL, tokenProvider: session.syncProvider)
        let spellingLists = Self.openSpellingLists(api: syncClient.api)
        let sync = SyncEngine(
            store: store,
            client: syncClient,
            session: { await session.syncSession() },
            reachability: NWPathReachability(),
            spellingLists: spellingLists)
        self.spellingLists = spellingLists
        self.store = store
        self.session = session
        self.sync = sync
        let diagnostics = Self.makeDiagnostics()
        self.diagnostics = diagnostics
        metricKit = MetricKitSubscriber(uploader: diagnostics)
        metricKit.start()
        memorizePassages = LiveMemorizePassageSource(api: client.api)
        // Listening from launch, so unfinished and out-of-app transactions
        // are finished. With the fakes the store is still StoreKit (the
        // scheme's StoreKit configuration in the simulator); only the server is faked.
        let premiumStore = StoreKitPremiumStore()
        premiumStore.start()
        premium = AppConfiguration.usesParentAccessFakes
            ? PremiumDependencies(store: premiumStore, planStatus: FakePlanStatusService())
            : .live(api: client.api, store: premiumStore)
        let premiumAccess = PremiumAccess(
            premiumStore: premiumStore,
            planStatus: premium.planStatus,
            cache: AppConfiguration.usesParentAccessFakes ? InMemoryPlanStatusCache() : UserDefaultsPlanStatusCache.standard,
            // Not syncSession(): that one is Sync's own check (see syncProvider).
            session: { await session.session() },
            kidIDs: PremiumAccess.kidIDs(in: store),
            alwaysPremium: LaunchOptions.alwaysPremium)
        self.premiumAccess = premiumAccess
        if AppConfiguration.usesParentAccessFakes {
            // Fake tokens stay out of SessionTokens, so Sync never sends one.
            let family = FakeFamilyService()
            let player = CurrentPlayer(store: store, family: family, parentSignedIn: false)
            let kidSignIn = KidSignInModel(
                service: FakeKidSignInService(), sessions: kidSessions, store: store, player: player,
                sessionChanged: { _ in })
            parentAccess = .fake { [premiumAccess] parent in
                if parent != nil { await kidSignIn.parentSignedIn() }
                await player.parentSessionChanged(signedIn: parent != nil)
                if parent == nil { await premiumAccess.forgetCachedPlans() }
            }
            self.family = family
            self.player = player
            self.kidSignIn = kidSignIn
            childStats = FakeChildStatsService()
        } else {
            let family = APIFamilyService(api: client.api)
            let player = CurrentPlayer(
                store: store, family: family, parentSignedIn: storedToken != nil, signedInKidID: storedKid?.childID)
            let kidSignIn = KidSignInModel(
                service: APIKidSignInService(baseURL: AppConfiguration.apiBaseURL), sessions: kidSessions, store: store, player: player,
                sessionChanged: { token in
                    await session.set(token)
                    // A sync run is followed by a plan status refresh.
                    if token != nil { sync.requestSync(.signedIn) }
                })
            childStats = APIChildStatsService(api: client.api)
            parentAccess = .live(api: client.api, sessionStore: sessions) { [premiumAccess] parent in
                // The parent's session replaces a signed-in kid's.
                if parent != nil { await kidSignIn.parentSignedIn() }
                await session.set(parent?.token)
                await player.parentSessionChanged(signedIn: parent != nil)
                // A sync run is followed by a plan status refresh.
                if parent != nil { sync.requestSync(.signedIn) } else { await premiumAccess.forgetCachedPlans() }
            }
            self.family = family
            self.player = player
            self.kidSignIn = kidSignIn
        }
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
                .environment(\.premiumAccess, premiumAccess)
                .environment(\.childStats, childStats)
                .environment(\.player, player)
                .environment(\.memorizePassages, memorizePassages)
                .environment(\.spellingLists, spellingLists)
                .environment(\.audio, audio)
                .environment(\.kidSignIn, kidSignIn)
                .environment(\.makeCodeScanner, { CameraCodeScanner() })
                // Decodes the effects once the first frame is up, so the
                // first one a kid hears is as quick as the rest.
                .task { audio.prepare() }
                .task { await sync.start() }
                .task {
                    premiumAccess.watchTransactions()
                    await premiumAccess.refresh()
                    // After each sync the network and session are known good.
                    for await report in await sync.reports()
                    where report.outcome != .offline && report.outcome != .noSession {
                        await premiumAccess.refresh()
                    }
                }
                .onChange(of: scenePhase, initial: true) { _, phase in
                    if phase == .active {
                        sync.requestSync(.foreground)
                        diagnostics.requestFlush()
                        // The server's plan follows the sync this starts.
                        Task { await premiumAccess.refreshEntitlement() }
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

    /// Nil if Application Support can't be made: the built-in grades still play.
    private static func openSpellingLists(api: any APIProtocol) -> SpellingListLibrary? {
        do {
            return try SpellingListLibrary.applicationSupport(downloader: APISpellingClipDownloader(api: api))
        } catch {
            Logger(subsystem: "dev.placeholder.dragonacademy", category: "App")
                .error("Couldn't open the spelling list folder: \(error)")
            return nil
        }
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

    /// The app's `AudioPlayer`: `audio?.play(.correct)` for an effect, `try await
    /// audio?.speak(url)` for a spoken clip. Nil (silent) in previews and tests
    /// that don't set one.
    @Entry var audio: AudioPlayer? = nil

    /// Each child's custom spelling lists that are on the device, clips and
    /// all (`lists(for: childID)`). Nil in previews and tests that don't set one.
    @Entry var spellingLists: SpellingListLibrary? = nil

    /// Fakes by default, so previews never touch Face ID, Apple or the server.
    @Entry var parentAccess: ParentAccessDependencies = .fake()

    /// Where a new battle gets its randomness: the system generator for live
    /// play (the web's `Math.random`), a seeded one under the debug launch
    /// argument.
    @Entry var makeBattleRandomSource: @Sendable () -> AnyRandomSource = { AnyRandomSource(SystemRandomSource()) }

    /// Where Memorize gets a child's passages; no server in previews and tests.
    @Entry var memorizePassages: any MemorizePassageSource = NoServerPassageSource()
}

/// Launch arguments, for UI tests. Debug builds only; a release build ignores
/// them and always plays with the system generator and the saved store.
///
///   -DABattleSeed <UInt64>   every battle draws from SeededRandom(seed), so
///                            problems, grids and opponent pace repeat
///   -DAResetStore YES        delete the on-disk store before opening it
///   -DAPremium YES           every kid plays with Premium (premium games open)
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

    static var alwaysPremium: Bool {
        #if DEBUG
        return UserDefaults.standard.bool(forKey: "DAPremium")
        #else
        return false
        #endif
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
