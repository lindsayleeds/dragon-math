// A child's custom spelling lists (ADR 0003, IOS_PLAN "Assets"): grown-ups
// make them on the web, the server records each word's clip once, and the
// device keeps a copy of both so the lists play offline. A list appears to the
// kid only once every one of its clips is on the device, so a kid never meets
// a word nobody can say to them; a clip that didn't download is tried again on
// the next sync.
//
// SyncEngine keeps the copies current: it compares each child's
// `spelling_lists` version (GET /api/content/versions?child_id=) with the
// stored one, downloads GET /api/spelling/lists when it changed, and hands the
// lists to ``SpellingListLibrary``, which fetches the clips through a
// ``SpellingClipDownloading`` (GET /api/spelling/audio/<word>.mp3).
import API
import Foundation
import OpenAPIRuntime
import OSLog

/// Fetches one spelling word's recorded clip.
public protocol SpellingClipDownloading: Sendable {
    /// The MP3 for `word`. Throws if there is none (the server's
    /// `audio_missing`) or it couldn't be fetched.
    func clip(for word: String) async throws -> Data
}

/// Why a clip didn't download.
public enum SpellingClipError: Error, Equatable {
    /// The server has no clip for the word (404), or can't name it (400).
    case missing(String)
    case http(Int)
    /// The word isn't one a clip can be stored under (letters only).
    case invalidWord(String)
}

/// GET /api/spelling/audio/{word}.mp3. Public, so any client will do.
public struct APISpellingClipDownloader: SpellingClipDownloading {
    /// Far more than a spoken word; stops a runaway body filling the disk.
    static let maxBytes = 2 * 1024 * 1024

    let api: any APIProtocol

    public init(api: any APIProtocol) {
        self.api = api
    }

    public func clip(for word: String) async throws -> Data {
        switch try await api.getSpellingAudio(path: .init(word: "\(word).mp3")) {
        case .ok(let ok):
            return try await Data(collecting: try ok.body.audioMpeg, upTo: Self.maxBytes)
        case .badRequest, .notFound:
            throw SpellingClipError.missing(word)
        case .undocumented(let status, _):
            throw SpellingClipError.http(status)
        }
    }
}

/// A custom list whose every clip is on the device, ready to play offline.
public struct SyncedSpellingList: Sendable, Hashable, Identifiable {
    /// The server's list id.
    public let id: Int
    public let name: String
    /// Lower-case, in the order the list was typed.
    public let words: [String]
    /// Each word's clip on the device.
    public let clips: [String: URL]

    public init(id: Int, name: String, words: [String], clips: [String: URL]) {
        self.id = id
        self.name = name
        self.words = words
        self.clips = clips
    }

    /// `source.key` on the web ("list:12"): what a best score is kept under.
    public var sourceKey: String { "list:\(id)" }

    public func clipURL(for word: String) -> URL? { clips[word.lowercased()] }
}

/// What one child's list update did.
public struct SpellingListUpdate: Sendable, Equatable {
    /// Clips downloaded now.
    public var downloaded = 0
    /// Words whose clip didn't download; their lists stay hidden until a
    /// later sync gets them.
    public var failed: [String] = []

    public init(downloaded: Int = 0, failed: [String] = []) {
        self.downloaded = downloaded
        self.failed = failed
    }
}

/// Each child's custom lists and their clips, in a folder of their own under
/// `directory` (Application Support in the app):
///
///     <directory>/<child id>/lists.json      the lists as last synced
///     <directory>/<child id>/clips/<file>    one MP3 per word
///
/// ``lists(for:)`` returns only the lists whose clips are all there. A clip is
/// written in one go (atomically), so a download cut off halfway never counts.
public actor SpellingListLibrary {
    /// One list as stored.
    struct StoredList: Codable, Hashable {
        var id: Int
        var name: String
        var words: [String]
        /// Words the server has an example sentence for: their clip is the
        /// whole prompt (word, sentence, word), so it's kept under its own
        /// file name and a sentence added later downloads afresh.
        var promptWords: Set<String>

        func clipFile(for word: String) -> String? {
            guard SpellingListLibrary.isStorable(word) else { return nil }
            return promptWords.contains(word) ? "\(word).prompt.mp3" : "\(word).mp3"
        }
    }

    struct Manifest: Codable {
        /// The server's `spelling_lists` version these lists came with.
        var version: String
        var lists: [StoredList]
    }

    private let directory: URL
    private let downloader: any SpellingClipDownloading
    private let files = FileManager.default
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "SpellingLists")

    public init(directory: URL, downloader: any SpellingClipDownloading) {
        self.directory = directory
        self.downloader = downloader
    }

    /// `Application Support/SpellingLists`, kept out of backups: it all
    /// downloads again.
    public static func applicationSupport(downloader: any SpellingClipDownloading) throws -> SpellingListLibrary {
        var url = try FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appending(path: "SpellingLists", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
        return SpellingListLibrary(directory: url, downloader: downloader)
    }

    /// The route only serves letters-only words, and a clip's file is named
    /// after its word.
    nonisolated static func isStorable(_ word: String) -> Bool {
        (1...24).contains(word.count) && word.allSatisfy { ("a"..."z").contains($0) }
    }

    // MARK: - Reading

    /// The child's lists that can be played: every clip on the device. Oldest
    /// first, as the server sends them. Empty before the first sync.
    public func lists(for childID: Int) -> [SyncedSpellingList] {
        guard let manifest = manifest(for: childID) else { return [] }
        let clips = clipsFolder(for: childID)
        return manifest.lists.compactMap { list in
            var urls: [String: URL] = [:]
            for word in list.words {
                guard let file = list.clipFile(for: word) else { return nil }
                let url = clips.appending(path: file)
                guard files.fileExists(atPath: url.path(percentEncoded: false)) else { return nil }
                urls[word] = url
            }
            guard !list.words.isEmpty else { return nil }
            return SyncedSpellingList(id: list.id, name: list.name, words: list.words, clips: urls)
        }
    }

    /// The `spelling_lists` version of the child's stored lists; nil before
    /// the first sync.
    public func version(for childID: Int) -> String? {
        manifest(for: childID)?.version
    }

    /// Whether any stored list is still missing a clip.
    public func hasMissingClips(for childID: Int) -> Bool {
        guard let manifest = manifest(for: childID) else { return false }
        return !missingClips(in: manifest, childID: childID).isEmpty
    }

    // MARK: - Updating

    /// Replaces the child's lists with `lists` (the server's, at `version`),
    /// downloads every clip not already on the device, and deletes the clips
    /// no list uses any more. A list whose clips didn't all download stays
    /// hidden; ``downloadMissingClips(for:)`` tries again.
    @discardableResult
    public func replace(
        lists: [Components.Schemas.SpellingList], version: String, for childID: Int
    ) async throws -> SpellingListUpdate {
        let stored = lists.map { list in
            let words = list.words.map { $0.lowercased() }
            return StoredList(
                id: list.id, name: list.name, words: words,
                promptWords: Set(list.exampleSentences.additionalProperties.keys.map { $0.lowercased() })
                    .intersection(words))
        }
        let manifest = Manifest(version: version, lists: stored)
        try files.createDirectory(at: clipsFolder(for: childID), withIntermediateDirectories: true)
        try ContentCoding.encoder.encode(manifest).write(to: manifestURL(for: childID), options: .atomic)
        removeUnusedClips(keeping: manifest, childID: childID)
        return await download(missingClips(in: manifest, childID: childID), childID: childID)
    }

    /// Downloads the clips the stored lists are still missing.
    @discardableResult
    public func downloadMissingClips(for childID: Int) async -> SpellingListUpdate {
        guard let manifest = manifest(for: childID) else { return SpellingListUpdate() }
        return await download(missingClips(in: manifest, childID: childID), childID: childID)
    }

    /// Forgets a child's lists and clips.
    public func remove(childID: Int) {
        try? files.removeItem(at: childFolder(for: childID))
    }

    private func download(_ missing: [(word: String, file: String?)], childID: Int) async -> SpellingListUpdate {
        var update = SpellingListUpdate()
        let clips = clipsFolder(for: childID)
        for (word, file) in missing {
            guard let file else {
                update.failed.append(word)
                continue
            }
            do {
                let data = try await downloader.clip(for: word)
                guard !data.isEmpty else { throw SpellingClipError.missing(word) }
                try data.write(to: clips.appending(path: file), options: .atomic)
                update.downloaded += 1
            } catch {
                log.info("spelling lists: no clip for \(word, privacy: .public): \(error)")
                update.failed.append(word)
            }
        }
        return update
    }

    /// Each word (once) whose clip file isn't there; a nil file is a word no
    /// clip can be stored for.
    private func missingClips(in manifest: Manifest, childID: Int) -> [(word: String, file: String?)] {
        let clips = clipsFolder(for: childID)
        var seen: Set<String> = []
        var missing: [(word: String, file: String?)] = []
        for list in manifest.lists {
            for word in list.words {
                let file = list.clipFile(for: word)
                guard seen.insert(file ?? word).inserted else { continue }
                if let file, files.fileExists(atPath: clips.appending(path: file).path(percentEncoded: false)) {
                    continue
                }
                missing.append((word, file))
            }
        }
        return missing
    }

    private func removeUnusedClips(keeping manifest: Manifest, childID: Int) {
        let used = Set(manifest.lists.flatMap { list in list.words.compactMap(list.clipFile(for:)) })
        let clips = clipsFolder(for: childID)
        guard let present = try? files.contentsOfDirectory(atPath: clips.path(percentEncoded: false)) else { return }
        for file in present where !used.contains(file) {
            try? files.removeItem(at: clips.appending(path: file))
        }
    }

    // MARK: - Files

    private func manifest(for childID: Int) -> Manifest? {
        guard let data = try? Data(contentsOf: manifestURL(for: childID)) else { return nil }
        return try? ContentCoding.decoder.decode(Manifest.self, from: data)
    }

    private func childFolder(for childID: Int) -> URL {
        directory.appending(path: String(childID), directoryHint: .isDirectory)
    }

    private func manifestURL(for childID: Int) -> URL {
        childFolder(for: childID).appending(path: "lists.json")
    }

    private func clipsFolder(for childID: Int) -> URL {
        childFolder(for: childID).appending(path: "clips", directoryHint: .isDirectory)
    }
}
