// The art of dragons added to the catalog after this build (#143): the app
// bundles the art of every dragon it shipped with, and downloads the PNG of any
// other catalog dragon into Application Support after a content sync, so a
// newly uploaded dragon appears with no app update. The files are an asset
// cache, not a content document: the catalog lists each dragon's art_sha256
// and art_bytes, and the downloader fetches only a dragon whose file is missing
// or doesn't match.
import API
import CryptoKit
import Foundation
import OSLog
import OpenAPIRuntime

/// Where one dragon's art comes from. ``APIDragonArtSource`` in the app
/// (GET /api/dragons/art/{id}.png); tests pass a fake.
public protocol DragonArtSource: Sendable {
    /// The PNG's bytes; throws when it can't be had (offline, 404).
    func art(for dragonID: Int) async throws -> Data
}

/// The server's copy: GET /api/dragons/art/<id>.png, which needs no session.
public struct APIDragonArtSource: DragonArtSource {
    /// Refuse anything bigger: the web's PNGs are well under a megabyte.
    public static let maxBytes = 8 * 1024 * 1024

    private let api: any APIProtocol

    public init(client: DragonAPIClient) {
        api = client.api
    }

    public func art(for dragonID: Int) async throws -> Data {
        switch try await api.getDragonArt(path: .init(dragonId: "\(dragonID).png")) {
        case .ok(let ok):
            return try await Data(collecting: ok.body.png, upTo: Self.maxBytes)
        case .notFound:
            throw DragonArtError.notOnServer
        case .badRequest:
            throw DragonArtError.badRequest
        case .undocumented(let status, _):
            throw DragonArtError.http(status)
        }
    }
}

public enum DragonArtError: Error, Equatable {
    case notOnServer
    case badRequest
    case http(Int)
    /// The bytes don't match the catalog's size or hash (a truncated download,
    /// or art replaced between the catalog and the download).
    case mismatch
}

/// The downloaded art on disk: one `dragon-<id>.png` per dragon in a folder
/// under Application Support. Excluded from backups; a lost file downloads
/// again.
public struct DragonArtFiles: Sendable {
    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    /// The app's folder, Application Support/DragonArt.
    public static func applicationDefault() throws -> DragonArtFiles {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return DragonArtFiles(directory: support.appending(path: "DragonArt", directoryHint: .isDirectory))
    }

    /// Where a dragon's file goes, whether or not it's there yet.
    public func fileURL(for dragonID: Int) -> URL {
        directory.appending(path: "dragon-\(dragonID).png", directoryHint: .notDirectory)
    }

    /// The downloaded file for this dragon, or nil if there is none.
    public func cachedURL(for dragonID: Int) -> URL? {
        let url = fileURL(for: dragonID)
        return FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) ? url : nil
    }

    /// Whether the downloaded file is this exact art.
    func matches(_ dragonID: Int, sha256: String, bytes: Int?) -> Bool {
        guard let url = cachedURL(for: dragonID), let data = try? Data(contentsOf: url) else { return false }
        return Self.check(data, sha256: sha256, bytes: bytes)
    }

    static func check(_ data: Data, sha256: String, bytes: Int?) -> Bool {
        if let bytes, data.count != bytes { return false }
        return hex(SHA256.hash(data: data)) == sha256.lowercased()
    }

    /// Writes atomically, so a crash never leaves half a PNG to show.
    func save(_ data: Data, for dragonID: Int) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var folder = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? folder.setResourceValues(values)
        try data.write(to: fileURL(for: dragonID), options: .atomic)
    }

    private static func hex(_ digest: SHA256.Digest) -> String {
        digest.map { String(format: "%02x", $0) }.joined()
    }
}

/// What one ``DragonArtDownloader/update(from:)`` did.
public struct DragonArtReport: Sendable, Equatable {
    /// Downloaded and saved this time; the app redraws these.
    public var downloaded: [Int] = []
    /// Tried and failed; the next update tries again.
    public var failed: [Int] = []
    /// Skipped because the app bundles their art.
    public var bundled = 0

    public init() {}
}

/// Keeps ``DragonArtFiles`` in step with the synced catalog: downloads the art
/// of every catalog dragon the app doesn't bundle whose file is missing or no
/// longer matches the catalog's hash, and checks each download's size and hash
/// before saving it. A dragon with no art on the server yet (a null hash) is
/// left for a later catalog. Failures aren't retried here; the next update
/// (after the next content sync) tries them again, and files already right
/// aren't downloaded twice. One update runs at a time: a call while one runs
/// waits for it and returns its report.
public actor DragonArtDownloader {
    private let files: DragonArtFiles
    private let source: any DragonArtSource
    private let isBundled: @Sendable (Int) -> Bool
    private var running: Task<DragonArtReport, Never>?
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "DragonArt")

    /// - Parameter isBundled: whether the app ships a dragon's art (the
    ///   asset catalog has `dragon-<id>`); those are never downloaded.
    public init(files: DragonArtFiles, source: any DragonArtSource, isBundled: @escaping @Sendable (Int) -> Bool) {
        self.files = files
        self.source = source
        self.isBundled = isBundled
    }

    /// Brings the downloaded art up to date with `catalog`.
    @discardableResult
    public func update(from catalog: Components.Schemas.DragonCatalogResponse) async -> DragonArtReport {
        if let running { return await running.value }
        let task = Task { await self.download(catalog.dragons) }
        running = task
        let report = await task.value
        running = nil
        return report
    }

    private func download(_ dragons: [Components.Schemas.CatalogDragon]) async -> DragonArtReport {
        var report = DragonArtReport()
        for dragon in dragons {
            let id = dragon.dragonId
            if isBundled(id) {
                report.bundled += 1
                continue
            }
            guard let sha256 = dragon.artSha256 else { continue }
            if files.matches(id, sha256: sha256, bytes: dragon.artBytes) { continue }
            do {
                let data = try await source.art(for: id)
                guard DragonArtFiles.check(data, sha256: sha256, bytes: dragon.artBytes) else {
                    throw DragonArtError.mismatch
                }
                try files.save(data, for: id)
                report.downloaded.append(id)
            } catch {
                log.info("couldn't download dragon \(id)'s art: \(error)")
                report.failed.append(id)
            }
        }
        return report
    }
}
