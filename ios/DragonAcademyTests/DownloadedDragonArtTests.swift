import CryptoKit
import Foundation
import Store
import Sync
import Testing
import UIKit
@testable import DragonAcademy

/// Serves a PNG for every dragon; the first request for a dragon in
/// `failFirst` fails, as if the network dropped.
private final class ArtServer: DragonArtSource, @unchecked Sendable {
    let png: Data
    private let lock = NSLock()
    private var failFirst: Set<Int>
    private var _requests: [Int] = []

    init(png: Data, failFirst: Set<Int> = []) {
        self.png = png
        self.failFirst = failFirst
    }

    var requests: [Int] { lock.withLock { _requests } }

    func art(for dragonID: Int) async throws -> Data {
        try lock.withLock {
            _requests.append(dragonID)
            if failFirst.remove(dragonID) != nil { throw URLError(.networkConnectionLost) }
            return png
        }
    }
}

private func solidPNG(side: CGFloat = 750) -> Data {
    UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return format
    }()).pngData { context in
        UIColor.systemGreen.setFill()
        context.fill(CGRect(x: 0, y: 0, width: side, height: side))
    }
}

/// A synced catalog of bundled dragon 1 and new dragon 300 (which the server
/// has art for).
private func storeWithCatalog(png: Data) async throws -> SQLiteStore {
    let store = try SQLiteStore.inMemory()
    let hash = png.sha256Hex
    try await store.saveContent(
        ContentDocument.dragonCatalog.name, version: "c1",
        json: Data(#"{"dragons":[{"dragon_id":1,"name":null,"rarity":"common","art_sha256":null,"art_bytes":null},{"dragon_id":300,"name":"Ember","rarity":"mythic","art_sha256":"\#(hash)","art_bytes":\#(png.count)}],"total":2}"#.utf8))
    return store
}

private extension Data {
    var sha256Hex: String {
        SHA256.hash(data: self).map { String(format: "%02x", $0) }.joined()
    }
}

private func temporaryFiles() -> DragonArtFiles {
    DragonArtFiles(directory: FileManager.default.temporaryDirectory.appending(path: "DownloadedArt-\(UUID().uuidString)"))
}

@MainActor @Test func aNewCatalogDragonsArtShowsOnceItDownloads() async throws {
    let png = solidPNG()
    let store = try await storeWithCatalog(png: png)
    let server = ArtServer(png: png)
    let art = DownloadedDragonArt(files: temporaryFiles(), source: server)
    #expect(art.image(for: 300) == nil)

    await art.update(from: store)
    let image = try #require(art.image(for: 300))
    // Scaled down to the bundled art's size.
    #expect(max(image.size.width * image.scale, image.size.height * image.scale) <= DragonArt.maxPoints * 3)
    // Dragon 1 ships with the app, so it is never fetched.
    #expect(server.requests == [300])
}

@MainActor @Test func aFailedArtDownloadIsTriedAgainOnTheNextUpdate() async throws {
    let png = solidPNG(side: 90)
    let store = try await storeWithCatalog(png: png)
    let server = ArtServer(png: png, failFirst: [300])
    let art = DownloadedDragonArt(files: temporaryFiles(), source: server)

    await art.update(from: store)
    #expect(art.image(for: 300) == nil)
    await art.update(from: store)
    #expect(art.image(for: 300) != nil)
    await art.update(from: store)
    #expect(server.requests == [300, 300])
}
