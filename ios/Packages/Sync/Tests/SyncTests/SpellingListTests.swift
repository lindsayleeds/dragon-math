import API
import Foundation
import Store
import Sync
import Testing

/// Hands out clips from a dictionary; a word not in it fails, as a 404 or a
/// dropped connection would.
final class StubClipDownloader: SpellingClipDownloading, @unchecked Sendable {
    private let lock = NSLock()
    private var _clips: [String: Data]
    private var _requests: [String] = []

    init(_ clips: [String: Data] = [:]) { _clips = clips }

    var requests: [String] { lock.withLock { _requests } }

    func set(_ word: String, _ data: Data?) { lock.withLock { _clips[word] = data } }

    func clip(for word: String) async throws -> Data {
        try lock.withLock {
            _requests.append(word)
            guard let data = _clips[word] else { throw SpellingClipError.missing(word) }
            return data
        }
    }
}

func clipData(_ word: String) -> Data { Data("mp3:\(word)".utf8) }

func spellingList(
    id: Int, name: String, words: [String], sentences: [String: String] = [:]
) -> Components.Schemas.SpellingList {
    Components.Schemas.SpellingList(
        id: id, name: name, childId: 7, createdAt: nil, updatedAt: nil, createdBySelf: false,
        words: words, audioMissing: [], exampleSentences: .init(additionalProperties: sentences))
}

/// A throwaway folder, removed when the test ends.
final class TemporaryFolder {
    let url = FileManager.default.temporaryDirectory.appending(path: "SpellingListTests-\(UUID().uuidString)")
    deinit { try? FileManager.default.removeItem(at: url) }
}

@Suite struct SpellingListLibraryTests {
    let folder = TemporaryFolder()

    @Test func aListIsHiddenWhileAClipIsMissing() async throws {
        let clips = StubClipDownloader(["cat": clipData("cat"), "dog": clipData("dog")])
        let library = SpellingListLibrary(directory: folder.url, downloader: clips)
        let update = try await library.replace(
            lists: [
                spellingList(id: 1, name: "Week 1", words: ["cat", "dog"]),
                spellingList(id: 2, name: "Week 2", words: ["cat", "bird"]),
            ],
            version: "v1", for: 7)

        #expect(update == SpellingListUpdate(downloaded: 2, failed: ["bird"]))
        let lists = await library.lists(for: 7)
        #expect(lists.map(\.name) == ["Week 1"])
        #expect(await library.hasMissingClips(for: 7))
        let url = try #require(lists.first?.clipURL(for: "dog"))
        #expect(try Data(contentsOf: url) == clipData("dog"))
    }

    @Test func aListShowsOnceEveryClipIsThere() async throws {
        let clips = StubClipDownloader(["cat": clipData("cat"), "dog": clipData("dog")])
        let library = SpellingListLibrary(directory: folder.url, downloader: clips)
        try await library.replace(lists: [spellingList(id: 1, name: "Week 1", words: ["cat", "dog"])], version: "v1", for: 7)

        let list = try #require(await library.lists(for: 7).first)
        #expect(list.words == ["cat", "dog"])
        #expect(list.sourceKey == "list:1")
        #expect(Set(list.clips.keys) == ["cat", "dog"])
        #expect(await !library.hasMissingClips(for: 7))
        #expect(await library.version(for: 7) == "v1")
        // Another child's lists are their own.
        #expect(await library.lists(for: 8).isEmpty)
    }

    @Test func aFailedClipIsTriedAgainAndOnlyIt() async throws {
        let clips = StubClipDownloader(["cat": clipData("cat")])
        let library = SpellingListLibrary(directory: folder.url, downloader: clips)
        try await library.replace(lists: [spellingList(id: 1, name: "Week 1", words: ["cat", "dog"])], version: "v1", for: 7)
        #expect(await library.lists(for: 7).isEmpty)

        // Still failing: still hidden.
        #expect(await library.downloadMissingClips(for: 7) == SpellingListUpdate(downloaded: 0, failed: ["dog"]))
        #expect(await library.lists(for: 7).isEmpty)

        clips.set("dog", clipData("dog"))
        #expect(await library.downloadMissingClips(for: 7) == SpellingListUpdate(downloaded: 1))
        #expect(await library.lists(for: 7).map(\.name) == ["Week 1"])
        #expect(clips.requests == ["cat", "dog", "dog", "dog"])
    }

    @Test func anUpdatedListReplacesTheOldOne() async throws {
        let clips = StubClipDownloader(["cat": clipData("cat"), "dog": clipData("dog"), "fish": clipData("fish")])
        let library = SpellingListLibrary(directory: folder.url, downloader: clips)
        try await library.replace(lists: [spellingList(id: 1, name: "Week 1", words: ["cat", "dog"])], version: "v1", for: 7)
        let old = try #require(await library.lists(for: 7).first?.clipURL(for: "dog"))

        let update = try await library.replace(
            lists: [spellingList(id: 1, name: "Week 1 (fixed)", words: ["cat", "fish"])], version: "v2", for: 7)

        // Only the new word downloads; the one no list uses is gone.
        #expect(update == SpellingListUpdate(downloaded: 1))
        let lists = await library.lists(for: 7)
        #expect(lists.map(\.name) == ["Week 1 (fixed)"])
        #expect(lists.first?.words == ["cat", "fish"])
        #expect(await library.version(for: 7) == "v2")
        #expect(!FileManager.default.fileExists(atPath: old.path(percentEncoded: false)))

        // A list deleted on the server goes too.
        try await library.replace(lists: [], version: "v3", for: 7)
        #expect(await library.lists(for: 7).isEmpty)
    }

    @Test func anUpdatedListWithANewWordHidesUntilItsClipArrives() async throws {
        let clips = StubClipDownloader(["cat": clipData("cat"), "dog": clipData("dog")])
        let library = SpellingListLibrary(directory: folder.url, downloader: clips)
        try await library.replace(lists: [spellingList(id: 1, name: "Week 1", words: ["cat", "dog"])], version: "v1", for: 7)
        #expect(await library.lists(for: 7).count == 1)

        try await library.replace(lists: [spellingList(id: 1, name: "Week 1", words: ["cat", "dog", "owl"])], version: "v2", for: 7)
        #expect(await library.lists(for: 7).isEmpty)
    }

    @Test func aWordWithASentenceKeepsItsPromptClipApart() async throws {
        let clips = StubClipDownloader(["bear": clipData("bear")])
        let library = SpellingListLibrary(directory: folder.url, downloader: clips)
        try await library.replace(lists: [spellingList(id: 1, name: "L", words: ["bear"])], version: "v1", for: 7)
        let plain = try #require(await library.lists(for: 7).first?.clipURL(for: "bear"))

        // A sentence added later means a new recording: it downloads afresh.
        clips.set("bear", clipData("bear, the bear ate honey, bear"))
        let update = try await library.replace(
            lists: [spellingList(id: 1, name: "L", words: ["bear"], sentences: ["bear": "The bear ate honey."])],
            version: "v2", for: 7)
        #expect(update.downloaded == 1)
        let prompt = try #require(await library.lists(for: 7).first?.clipURL(for: "bear"))
        #expect(prompt != plain)
        #expect(try Data(contentsOf: prompt) == clipData("bear, the bear ate honey, bear"))
    }

    @Test func aWordNoClipCanBeStoredForHidesItsList() async throws {
        let clips = StubClipDownloader(["../x": clipData("x"), "cat": clipData("cat")])
        let library = SpellingListLibrary(directory: folder.url, downloader: clips)
        let update = try await library.replace(
            lists: [spellingList(id: 1, name: "L", words: ["cat", "../x"])], version: "v1", for: 7)
        #expect(update.failed == ["../x"])
        #expect(clips.requests == ["cat"])
        #expect(await library.lists(for: 7).isEmpty)
    }
}

/// Custom lists through a sync, against the fake server's routes.
@Suite struct SpellingListSyncTests {
    let server = FakeSyncServer()
    let folder = TemporaryFolder()

    func engine(store: any Store, session: SyncSession = .parent) -> (SyncEngine, SpellingListLibrary) {
        let client = DragonAPIClient(baseURL: baseURL, transport: server) { "parent-token" }
        let library = SpellingListLibrary(directory: folder.url, downloader: APISpellingClipDownloader(api: client.api))
        let sync = SyncEngine(
            store: store, client: client, session: { session }, spellingLists: library, sleep: { _ in },
            random: { 0.5 })
        return (sync, library)
    }

    func publish(child: Int, version: String, lists: [[String: Any]]) throws {
        let full = lists.map { list -> [String: Any] in
            let base: [String: Any] = [
                "child_id": child, "created_at": NSNull(), "updated_at": NSNull(), "created_by_self": false,
                "audio_missing": [String](), "example_sentences": [String: String](),
            ]
            return base.merging(list) { $1 }
        }
        server.content.publishSpellingLists(for: child, version: version, json: try jsonString(["lists": full]))
    }

    @Test func aListAppearsOnlyOnceItsAudioHasDownloaded() async throws {
        let store = try SQLiteStore.inMemory()
        _ = try await store.addChildProfile(remoteID: 7, displayName: "Ada")
        let (sync, library) = engine(store: store)
        try publish(child: 7, version: "v1", lists: [["id": 1, "name": "Week 1", "words": ["cat", "dog"]]])
        server.content.publishClip("cat", clipData("cat"))

        let first = await sync.syncNow(.foreground)
        #expect(first.spellingListsUpdated == [7])
        #expect(first.spellingClipsDownloaded == 1)
        #expect(first.spellingClipsFailed == ["dog"])
        #expect(await library.lists(for: 7).isEmpty)

        // Next sync: the lists haven't changed, so only the missing clip is
        // asked for again.
        server.content.publishClip("dog", clipData("dog"))
        let downloadsBefore = server.content.downloads.count
        let second = await sync.syncNow(.foreground)
        #expect(second.spellingListsUpdated.isEmpty)
        #expect(second.spellingClipsDownloaded == 1)
        #expect(server.content.downloads.count == downloadsBefore)
        #expect(server.content.clipRequests == ["cat", "dog", "dog"])
        let list = try #require(await library.lists(for: 7).first)
        #expect(list.name == "Week 1")
        #expect(try Data(contentsOf: try #require(list.clipURL(for: "dog"))) == clipData("dog"))

        // Nothing changed and nothing missing: nothing downloads.
        let third = await sync.syncNow(.foreground)
        #expect(third.spellingListsUpdated.isEmpty && third.spellingClipsDownloaded == 0)
        #expect(server.content.clipRequests.count == 3)
    }

    @Test func anEditOnTheServerReplacesTheList() async throws {
        let store = try SQLiteStore.inMemory()
        _ = try await store.addChildProfile(remoteID: 7, displayName: "Ada")
        let (sync, library) = engine(store: store)
        for word in ["cat", "dog", "fish"] { server.content.publishClip(word, clipData(word)) }
        try publish(child: 7, version: "v1", lists: [["id": 1, "name": "Week 1", "words": ["cat", "dog"]]])
        await sync.syncNow(.foreground)
        #expect(await library.lists(for: 7).first?.words == ["cat", "dog"])

        try publish(child: 7, version: "v2", lists: [["id": 1, "name": "Week 1", "words": ["fish"]]])
        let report = await sync.syncNow(.foreground)
        #expect(report.spellingListsUpdated == [7])
        #expect(await library.lists(for: 7).first?.words == ["fish"])
    }

    @Test func aKidsSessionSyncsOnlyTheirOwnLists() async throws {
        let store = try SQLiteStore.inMemory()
        _ = try await store.addChildProfile(remoteID: 7, displayName: "Ada")
        _ = try await store.addChildProfile(remoteID: 8, displayName: "Bo")
        let (sync, library) = engine(store: store, session: .child(8))
        server.content.publishClip("cat", clipData("cat"))
        try publish(child: 7, version: "v1", lists: [["id": 1, "name": "Ada's", "words": ["cat"]]])
        try publish(child: 8, version: "v1", lists: [["id": 2, "name": "Bo's", "words": ["cat"]]])

        let report = await sync.syncNow(.foreground)
        #expect(report.spellingListsUpdated == [8])
        #expect(await library.lists(for: 8).map(\.name) == ["Bo's"])
        #expect(await library.lists(for: 7).isEmpty)
    }

    @Test func signedOutNothingIsAsked() async throws {
        let store = try SQLiteStore.inMemory()
        _ = try await store.addChildProfile(remoteID: 7, displayName: "Ada")
        let (sync, _) = engine(store: store, session: .none)
        try publish(child: 7, version: "v1", lists: [["id": 1, "name": "Week 1", "words": ["cat"]]])

        let report = await sync.syncNow(.foreground)
        #expect(report.spellingListsUpdated.isEmpty)
        #expect(server.content.clipRequests.isEmpty)
    }
}
