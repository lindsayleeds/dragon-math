import API
import CryptoKit
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Store
import Sync
import Testing

/// A server's dragon PNGs, by id; each request can be scripted to fail.
final class FakeArtSource: DragonArtSource, @unchecked Sendable {
    private let lock = NSLock()
    private var _art: [Int: Data]
    private var _failNext: Set<Int> = []
    private var _requests: [Int] = []

    init(_ art: [Int: Data]) { _art = art }

    var art: [Int: Data] {
        get { lock.withLock { _art } }
        set { lock.withLock { _art = newValue } }
    }
    /// Dragons whose next request fails, as if the network dropped.
    func failNext(_ ids: Int...) { lock.withLock { _failNext.formUnion(ids) } }
    var requests: [Int] { lock.withLock { _requests } }

    func art(for dragonID: Int) async throws -> Data {
        try lock.withLock {
            _requests.append(dragonID)
            if _failNext.remove(dragonID) != nil { throw URLError(.networkConnectionLost) }
            guard let data = _art[dragonID] else { throw DragonArtError.notOnServer }
            return data
        }
    }
}

func png(_ text: String) -> Data { Data("PNG \(text)".utf8) }

func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

/// A served catalog: each dragon with the hash and size of `art[id]`, or null
/// fields when the server has none.
func catalogJSON(_ ids: [Int], art: [Int: Data]) -> String {
    let dragons = ids.map { id -> String in
        guard let data = art[id] else {
            return #"{"dragon_id": \#(id), "name": null, "rarity": "common", "art_sha256": null, "art_bytes": null}"#
        }
        return #"{"dragon_id": \#(id), "name": "D\#(id)", "rarity": "rare", "art_sha256": "\#(sha256Hex(data))", "art_bytes": \#(data.count)}"#
    }
    return #"{"dragons": [\#(dragons.joined(separator: ", "))], "total": \#(ids.count)}"#
}

func catalog(_ ids: [Int], art: [Int: Data]) throws -> Components.Schemas.DragonCatalogResponse {
    try JSONDecoder().decode(Components.Schemas.DragonCatalogResponse.self, from: Data(catalogJSON(ids, art: art).utf8))
}

func temporaryArtFiles() -> DragonArtFiles {
    DragonArtFiles(directory: FileManager.default.temporaryDirectory.appending(path: "DragonArtTests-\(UUID().uuidString)"))
}

@Suite struct DragonArtDownloadTests {
    /// 1 and 2 ship with the app; 300 and 301 were added after release.
    let bundled: Set<Int> = [1, 2]
    let art: [Int: Data] = [1: png("one"), 2: png("two"), 300: png("three hundred"), 301: png("three oh one")]

    func downloader(_ files: DragonArtFiles, _ source: FakeArtSource) -> DragonArtDownloader {
        let bundled = bundled
        return DragonArtDownloader(files: files, source: source, isBundled: { bundled.contains($0) })
    }

    @Test func aNewDragonDownloadsAndItsFileIsFound() async throws {
        let files = temporaryArtFiles()
        let source = FakeArtSource(art)
        #expect(files.cachedURL(for: 300) == nil)

        let report = await downloader(files, source).update(from: try catalog([1, 2, 300, 301], art: art))
        #expect(report.downloaded == [300, 301])
        #expect(report.failed == [])
        #expect(report.bundled == 2)

        let url = try #require(files.cachedURL(for: 300))
        #expect(url == files.fileURL(for: 300))
        #expect(url.lastPathComponent == "dragon-300.png")
        #expect(url.path().hasPrefix(files.directory.path()))
        #expect(try Data(contentsOf: url) == art[300])
    }

    @Test func bundledDragonsAreNeverDownloaded() async throws {
        let files = temporaryArtFiles()
        let source = FakeArtSource(art)
        let report = await downloader(files, source).update(from: try catalog([1, 2], art: art))
        #expect(report == { var r = DragonArtReport(); r.bundled = 2; return r }())
        #expect(source.requests == [])
        #expect(files.cachedURL(for: 1) == nil)
    }

    @Test func aFailedDownloadIsTriedAgainNextTime() async throws {
        let files = temporaryArtFiles()
        let source = FakeArtSource(art)
        let art = downloader(files, source)
        let served = try catalog([300, 301], art: self.art)
        source.failNext(300)

        let first = await art.update(from: served)
        #expect(first.downloaded == [301])
        #expect(first.failed == [300])
        #expect(files.cachedURL(for: 300) == nil)

        let second = await art.update(from: served)
        #expect(second.downloaded == [300])
        #expect(second.failed == [])
        #expect(files.cachedURL(for: 300) != nil)
        // 301 was already right, so it isn't fetched again.
        #expect(source.requests == [300, 301, 300])

        let third = await art.update(from: served)
        #expect(third.downloaded == [])
        #expect(source.requests.count == 3)
    }

    @Test func artReplacedOnTheServerDownloadsAgain() async throws {
        let files = temporaryArtFiles()
        let source = FakeArtSource(art)
        let art = downloader(files, source)
        await art.update(from: try catalog([300], art: self.art))

        let repainted = [300: png("repainted")]
        source.art = repainted
        let report = await art.update(from: try catalog([300], art: repainted))
        #expect(report.downloaded == [300])
        #expect(try Data(contentsOf: try #require(files.cachedURL(for: 300))) == repainted[300])
    }

    @Test func aDownloadThatDoesNotMatchTheCatalogIsNotSaved() async throws {
        let files = temporaryArtFiles()
        // The catalog describes one PNG; the server hands back another.
        let source = FakeArtSource([300: png("truncat")])
        let report = await downloader(files, source).update(from: try catalog([300], art: art))
        #expect(report.failed == [300])
        #expect(files.cachedURL(for: 300) == nil)
    }

    @Test func aDragonWithNoArtYetIsLeftForALaterCatalog() async throws {
        let files = temporaryArtFiles()
        let source = FakeArtSource([:])
        let report = await downloader(files, source).update(from: try catalog([400], art: [:]))
        #expect(report == DragonArtReport())
        #expect(source.requests == [])
    }

    /// The acceptance criterion end to end: a dragon uploaded on the server
    /// reaches the device's catalog with a content sync, and its art after.
    @Test func aDragonUploadedAfterReleaseArrivesWithTheNextSync() async throws {
        let server = FakeSyncServer()
        let store = try SQLiteStore.inMemory()
        let sync = SyncEngine(
            store: store,
            client: DragonAPIClient(baseURL: baseURL, transport: server) { "parent-token" },
            hasSession: { true },
            sleep: { _ in },
            random: { 0.5 })
        server.content.publish("dragon_catalog", version: "c1", json: catalogJSON([1, 2], art: art))
        _ = await sync.syncNow(.foreground)

        let files = temporaryArtFiles()
        let source = FakeArtSource(art)
        let downloads = downloader(files, source)
        #expect(await downloads.update(from: try #require(try await store.cachedContent(.dragonCatalog))).downloaded == [])

        server.content.publish("dragon_catalog", version: "c2", json: catalogJSON([1, 2, 300], art: art))
        let report = await sync.syncNow(.foreground)
        #expect(report.contentUpdated == ["dragon_catalog"])
        let synced = try #require(try await store.cachedContent(.dragonCatalog))
        #expect(await downloads.update(from: synced).downloaded == [300])
        #expect(files.cachedURL(for: 300) != nil)
    }
}

/// GET /api/dragons/art/{id}.png through the generated client.
@Suite struct APIDragonArtSourceTests {
    final class ArtTransport: ClientTransport, @unchecked Sendable {
        var paths: [String] = []
        let status: Int
        let body: Data
        init(status: Int, body: Data) {
            self.status = status
            self.body = body
        }
        func send(_ request: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID: String) async throws
            -> (HTTPResponse, HTTPBody?)
        {
            #expect(operationID == "getDragonArt")
            paths.append(request.path ?? "")
            var fields = HTTPFields()
            fields[.contentType] = status == 200 ? "image/png" : "application/json"
            return (HTTPResponse(status: .init(code: status), headerFields: fields), HTTPBody(body))
        }
    }

    @Test func fetchesTheDragonsPNG() async throws {
        let transport = ArtTransport(status: 200, body: png("seven"))
        let source = APIDragonArtSource(client: DragonAPIClient(baseURL: baseURL, transport: transport) { nil })
        #expect(try await source.art(for: 7) == png("seven"))
        #expect(transport.paths == ["/api/dragons/art/7.png"])
    }

    @Test func aDragonWithNoArtOnTheServerThrows() async throws {
        let transport = ArtTransport(status: 404, body: Data(#"{"error": "No art for that dragon"}"#.utf8))
        let source = APIDragonArtSource(client: DragonAPIClient(baseURL: baseURL, transport: transport) { nil })
        await #expect(throws: DragonArtError.notOnServer) { try await source.art(for: 7) }
    }
}
