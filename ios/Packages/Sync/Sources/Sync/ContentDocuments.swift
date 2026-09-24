// The server content the device keeps a copy of (ADR 0003): documents the app
// plays from that can change on the server without an app release. SyncEngine
// compares each copy's version with GET /api/content/versions and downloads only
// the ones that changed; the app reads the last synced copy, online or off, with
// `store.cachedContent(.ruleSettings)`. Assets (images, audio) are not here.
import API
import Foundation
import Store

/// One content document: its name in the Store and in GET
/// /api/content/versions, and how to download it as its generated API type.
public struct ContentDocument<Value: Codable & Sendable>: Sendable {
    public let name: ContentName
    let serverVersion: @Sendable (Components.Schemas.ContentVersions) -> String
    let download: @Sendable (any APIProtocol) async throws -> Value

    public init(
        name: ContentName,
        serverVersion: @escaping @Sendable (Components.Schemas.ContentVersions) -> String,
        download: @escaping @Sendable (any APIProtocol) async throws -> Value
    ) {
        self.name = name
        self.serverVersion = serverVersion
        self.download = download
    }

    /// The stored JSON as `Value`, or nil if it doesn't decode — a copy from
    /// an older app version whose shape no longer fits, which Sync downloads
    /// again.
    func decode(_ json: Data) -> Value? {
        try? ContentCoding.decoder.decode(Value.self, from: json)
    }
}

extension ContentDocument where Value == Components.Schemas.RuleSettings {
    /// GET /api/rule-settings: every tunable the game rules read.
    public static var ruleSettings: Self {
        Self(name: "rule_settings", serverVersion: \.ruleSettings) { try await $0.getRuleSettings().ok.body.json }
    }
}

extension ContentDocument where Value == Components.Schemas.NodeConfigResponse {
    /// GET /api/node-config: per-node battle config.
    public static var nodeConfig: Self {
        Self(name: "node_config", serverVersion: \.nodeConfig) { try await $0.getNodeConfig().ok.body.json }
    }
}

extension ContentDocument where Value == Components.Schemas.DragonCatalogResponse {
    /// GET /api/dragons/catalog: the dragons prizes draw from. Needs a
    /// session; signed out, the last synced copy stays.
    public static var dragonCatalog: Self {
        Self(name: "dragon_catalog", serverVersion: \.dragonCatalog) { try await $0.getDragonCatalog().ok.body.json }
    }
}

/// A content document of any type, for the list Sync walks.
public struct AnyContentDocument: Sendable {
    public let name: ContentName
    let serverVersion: @Sendable (Components.Schemas.ContentVersions) -> String
    /// Downloads the document and returns it as the JSON to store.
    let download: @Sendable (any APIProtocol) async throws -> Data
    /// Whether a stored copy still decodes as the document's type.
    let decodes: @Sendable (Data) -> Bool

    public init<Value>(_ document: ContentDocument<Value>) {
        name = document.name
        serverVersion = document.serverVersion
        download = { api in try ContentCoding.encoder.encode(try await document.download(api)) }
        decodes = { document.decode($0) != nil }
    }
}

/// The content documents Sync keeps up to date.
public enum ContentDocuments {
    public static let all: [AnyContentDocument] = [
        AnyContentDocument(.ruleSettings),
        AnyContentDocument(.nodeConfig),
        AnyContentDocument(.dragonCatalog),
    ]
}

extension Store {
    /// The last synced copy of `document`, decoded; nil until one has synced
    /// (or if the stored copy no longer decodes). Callers fall back to their
    /// built-in defaults, e.g. `BattleConfig.defaults`.
    public func cachedContent<Value>(_ document: ContentDocument<Value>) async throws -> Value? {
        guard let cached = try await cachedContent(document.name) else { return nil }
        return document.decode(cached.json)
    }
}

/// The JSON a document is stored as: the generated types' own Codable keys,
/// so it's the server's wire format.
enum ContentCoding {
    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }()

    static let decoder = JSONDecoder()
}
