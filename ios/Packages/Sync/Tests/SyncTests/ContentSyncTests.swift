import API
import Foundation
import Store
import Sync
import Testing

/// The repo's golden/rule-settings.json `document`: a whole rule-settings
/// document as the server builds it, kept current by the golden drift test.
func servedRuleSettings() throws -> [String: Any] {
    let url = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "golden/rule-settings.json")
    let golden = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return golden["document"] as! [String: Any]
}

func jsonString(_ object: Any) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
}

@Suite struct ContentSyncTests {
    let server = FakeSyncServer()
    let session = SessionFlag(signedIn: true)

    let nodeConfig = #"{"configs": [{"node_id": 1, "grid_size": 3, "ops": ["add"], "range_min": 1, "range_max": 3, "ai_seconds": 10, "shape_id": null}]}"#
    let catalog = #"{"dragons": [{"dragon_id": 1, "name": "Ember", "rarity": "common"}], "total": 1}"#

    func engine(store: any Store, reachability: (any NetworkReachability)? = nil) -> SyncEngine {
        let session = session
        return SyncEngine(
            store: store,
            client: DragonAPIClient(baseURL: baseURL, transport: server) { session.signedIn ? "kid-token" : nil },
            hasSession: { session.signedIn },
            reachability: reachability,
            sleep: { _ in },
            random: { 0.5 })
    }

    /// Publishes the rule settings with the opponent's minimum delay set to
    /// `minDelayMs`, at `version`.
    func publishRuleSettings(minDelayMs: Int, version: String) throws {
        var document = try servedRuleSettings()
        var battle = document["battle"] as! [String: Any]
        var opponent = battle["opponent"] as! [String: Any]
        opponent["min_delay_ms"] = minDelayMs
        battle["opponent"] = opponent
        document["battle"] = battle
        document["version"] = version
        server.content.publish("rule_settings", version: version, json: try jsonString(document))
    }

    func publishAll() throws {
        try publishRuleSettings(minDelayMs: 1500, version: "rules-1")
        server.content.publish("node_config", version: "nodes-1", json: nodeConfig)
        server.content.publish("dragon_catalog", version: "catalog-1", json: catalog)
    }

    @Test func theServedRuleSettingsDecodeAsTheGeneratedType() async throws {
        let json = try JSONSerialization.data(withJSONObject: try servedRuleSettings())
        let decoded = try JSONDecoder().decode(Components.Schemas.RuleSettings.self, from: json)
        #expect(decoded.nodes.map(\.nodeId) == [1, 2])
    }

    @Test func aSettingsChangeOnTheServerReachesTheDevice() async throws {
        let store = try SQLiteStore.inMemory()
        let sync = engine(store: store)
        #expect(try await store.cachedContent(.ruleSettings) == nil)
        try publishAll()

        let first = await sync.syncNow(.foreground)
        #expect(first.content == .checked)
        #expect(first.contentUpdated == ["rule_settings", "node_config", "dragon_catalog"])
        #expect(try await store.cachedContent(.ruleSettings)?.battle.opponent.minDelayMs == 1500)
        #expect(try await store.cachedContent(.nodeConfig)?.configs.map(\.nodeId) == [1])
        #expect(try await store.cachedContent(.dragonCatalog)?.dragons.first?.name == "Ember")

        // Tuned on the server: only that document downloads again.
        try publishRuleSettings(minDelayMs: 2500, version: "rules-2")
        let second = await sync.syncNow(.foreground)
        #expect(second.contentUpdated == ["rule_settings"])
        #expect(try await store.cachedContent(.ruleSettings)?.battle.opponent.minDelayMs == 2500)
        #expect(try await store.cachedContent("rule_settings")?.version == "rules-2")
    }

    @Test func unchangedVersionsDontDownloadAgain() async throws {
        let store = try SQLiteStore.inMemory()
        let sync = engine(store: store)
        try publishAll()
        await sync.syncNow(.foreground)
        #expect(server.content.downloads.count == 3)

        let again = await sync.syncNow(.reconnected)
        #expect(again.content == .checked)
        #expect(again.contentUpdated.isEmpty)
        #expect(server.content.versionChecks == 2)
        #expect(server.content.downloads.count == 3)
    }

    @Test func anOfflineLaunchUsesTheLastSyncedContent() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "ContentSyncTests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "store.sqlite")
        try publishAll()
        do {
            let store = try SQLiteStore.onDisk(at: url)
            await engine(store: store).syncNow(.foreground)
        }

        // Next launch, no network: nothing is asked for, and play reads the copies.
        let store = try SQLiteStore.onDisk(at: url)
        let network = StubReachability(online: false)
        let sync = engine(store: store, reachability: network)
        await sync.start()
        #expect(await eventually { await !sync.isNetworkAvailable })
        let checksBefore = server.content.versionChecks

        let report = await sync.syncNow(.foreground)
        #expect(report.content == .offline)
        #expect(server.content.versionChecks == checksBefore)
        #expect(try await store.cachedContent(.ruleSettings)?.battle.opponent.minDelayMs == 1500)
        #expect(try await store.cachedContent(.dragonCatalog)?.total == 1)
        await sync.stop()
    }

    @Test func aFailedCheckOrDownloadKeepsTheLastCopy() async throws {
        let store = try SQLiteStore.inMemory()
        let sync = engine(store: store)
        try publishAll()
        await sync.syncNow(.foreground)

        server.content.publish("node_config", version: "nodes-2", json: #"{"configs": []}"#)
        server.content.script("getContentVersions", .networkDown)
        #expect(await sync.syncNow(.foreground).content == .unavailable)
        server.content.script("getContentVersions", nil)
        server.content.script("getNodeConfig", .status(500))
        let failed = await sync.syncNow(.foreground)
        #expect(failed.content == .checked)
        #expect(failed.contentFailed == ["node_config"])
        #expect(try await store.cachedContent(.nodeConfig)?.configs.count == 1)

        // The next check tries again.
        server.content.script("getNodeConfig", nil)
        #expect(await sync.syncNow(.foreground).contentUpdated == ["node_config"])
        #expect(try await store.cachedContent(.nodeConfig)?.configs.isEmpty == true)
    }

    @Test func signedOutStillGetsThePublicContent() async throws {
        let store = try SQLiteStore.inMemory()
        session.signedIn = false
        try publishAll()

        let report = await engine(store: store).syncNow(.foreground)
        #expect(report.outcome == .noSession)
        #expect(report.contentUpdated == ["rule_settings", "node_config"])
        #expect(report.contentFailed == ["dragon_catalog"])
        #expect(try await store.cachedContent(.dragonCatalog) == nil)
    }

    @Test func aCopyThatNoLongerDecodesIsDownloadedAgain() async throws {
        let store = try SQLiteStore.inMemory()
        try publishAll()
        // Same version, but stored by an app whose types had another shape.
        try await store.saveContent("node_config", version: "nodes-1", json: Data(#"{"nodes": []}"#.utf8))
        #expect(try await store.cachedContent(.nodeConfig) == nil)

        let report = await engine(store: store).syncNow(.foreground)
        #expect(report.contentUpdated.contains("node_config"))
        #expect(try await store.cachedContent(.nodeConfig)?.configs.count == 1)
    }

    @Test func onlyForegroundAndReconnectCheckContent() async throws {
        let store = try SQLiteStore.inMemory()
        try publishAll()
        let network = StubReachability(online: false)
        let sync = engine(store: store, reachability: network)
        await sync.start()
        #expect(await eventually { await !sync.isNetworkAvailable })

        // The end of a battle only uploads.
        let explicit = await sync.syncNow()
        #expect(explicit.content == nil)
        #expect(server.content.versionChecks == 0)

        network.set(online: true)
        #expect(try await eventually { try await store.cachedContent(.ruleSettings) != nil })
        #expect(server.content.versionChecks == 1)
        await sync.stop()
    }
}
