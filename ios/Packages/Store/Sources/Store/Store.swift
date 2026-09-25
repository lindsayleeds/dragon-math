// Local persistence behind a `Store` interface (ADR 0003). Everything a kid
// does is recorded as an event with a device-generated UUID, queued locally
// and uploaded later by Sync; progress is derived from those events, merged
// with what the server has from the child's other devices. The rest of the
// app talks to `Store` and never imports GRDB or touches SQLite.
import Foundation

public enum StoreModule {
    /// The module's name.
    public static let name = "Store"
}

/// The app's local database: profiles, the event queue, progress derived
/// from events, and the last synced copy of each content document. `SQLiteStore` is the GRDB-backed implementation.
public protocol Store: Sendable {
    /// The on-device guest identity, created the first time the store opens.
    var guestProfile: Profile { get }

    /// Every profile on this device, guest first, then children by creation.
    func profiles() async throws -> [Profile]

    /// Adds a local profile for a server child account, or returns the
    /// existing one for that `remoteID`.
    func addChildProfile(remoteID: Int, displayName: String) async throws -> Profile

    /// Records the parent's telemetry setting for a profile (from the parent
    /// view or the server's progress). Unknown ids are ignored.
    func setTelemetryOptOut(_ optOut: Bool, for profileID: Profile.ID) async throws
    /// Removes the child profiles for these server child ids, with every
    /// event they recorded, uploaded or not: what's left on the device when
    /// their parent deletes the account. Unknown ids are ignored; the guest
    /// profile is never removed. Returns how many profiles went.
    @discardableResult
    func removeChildProfiles(remoteIDs: Set<Int>) async throws -> Int

    /// Adds a local profile for a server child account, or updates the
    /// existing one's name and avatar (a kid can change their handle on
    /// another device). The profile's id, and so its events and progress,
    /// never change.
    @discardableResult
    func saveChildProfile(remoteID: Int, displayName: String, avatar: String?) async throws -> Profile

    /// Hands the guest's play to a child at sign-up (ADR 0003): every guest
    /// event still waiting to upload becomes `childProfileID`'s, in one
    /// transaction, so its derived progress moves with it and Sync uploads it
    /// under that child. The guest starts fresh. Only call this once a parent
    /// has agreed; until then nothing about the guest leaves the device.
    /// Throws ``StoreError/notAChildProfile(_:)`` unless `childProfileID` is a
    /// `.child` profile. Returns how many events moved.
    @discardableResult
    func moveGuestEvents(to childProfileID: Profile.ID) async throws -> Int

    /// Appends an event to the queue for `profileID`, stamped with the
    /// device clock, in the `pending` upload state.
    @discardableResult
    func record<Payload: EventPayload>(_ payload: Payload, for profileID: Profile.ID) async throws -> StoredEvent

    /// A profile's events, oldest first.
    func events(for profileID: Profile.ID) async throws -> [StoredEvent]

    /// Events still waiting to upload, oldest first, at most `limit`.
    func pendingEvents(limit: Int) async throws -> [StoredEvent]

    /// One profile's events of the given kinds still waiting to upload,
    /// oldest first, at most `limit`. Sync asks for the kinds it knows how to
    /// send, so a kind it can't send yet never holds up the rest of the queue.
    func pendingEvents(for profileID: Profile.ID, kinds: Set<EventKind>, limit: Int) async throws
        -> [StoredEvent]

    /// Marks events as accepted by the server. Unknown ids are ignored.
    func markUploaded(_ eventIDs: [StoredEvent.ID]) async throws

    /// The profile's uploaded events that the saved server progress doesn't
    /// include yet. Sync reads this *before* fetching the server's progress:
    /// the server acknowledged each of these, so the progress it returns next
    /// includes them all, and they are what ``saveServerProgress(_:for:covering:)``
    /// is told it covers.
    func uploadedEventsNotInServerProgress(for profileID: Profile.ID) async throws -> [StoredEvent.ID]

    /// Replaces the profile's server progress (what the server has from all of
    /// the child's devices) and marks `eventIDs` as included in it, in one
    /// transaction. Derived progress then counts those events from the server
    /// alone and every other event on top.
    func saveServerProgress(_ progress: ServerProgress, for profileID: Profile.ID, covering eventIDs: [StoredEvent.ID])
        async throws

    /// Progress derived from a profile's events merged with its last saved
    /// server progress: wins and stars by union and best, the frontier by max,
    /// dragons as the server's counts plus local events it doesn't include.
    func progress(for profileID: Profile.ID) async throws -> ProfileProgress

    /// The profile's progress now and again after every change that affects
    /// it, for SwiftUI views (`for try await progress in ...`). The stream
    /// ends when the consuming task is cancelled.
    func observeProgress(for profileID: Profile.ID) -> AsyncThrowingStream<ProfileProgress, any Error>

    /// The last synced copy of a content document, or nil if none was ever
    /// synced. Sync decodes it into its API type (`store.cachedContent(.ruleSettings)`).
    func cachedContent(_ name: ContentName) async throws -> CachedContent?

    /// Stores a content document as downloaded, replacing any older copy.
    func saveContent(_ name: ContentName, version: String, json: Data) async throws
}

// MARK: - Errors

public enum StoreError: Error, Equatable, Sendable {
    /// The profile doesn't exist, or it isn't a `.child` profile.
    case notAChildProfile(Profile.ID)
}

// MARK: - Profiles

public struct Profile: Identifiable, Hashable, Sendable {
    public enum Kind: String, Sendable, Codable {
        /// Offline play with no account. Nothing about it leaves the device
        /// until a parent signs up (ADR 0003).
        case guest
        /// A child account on the server.
        case child
    }

    /// Generated on device; events reference it.
    public let id: UUID
    public let kind: Kind
    /// The server's child id, for `.child` profiles.
    public let remoteID: Int?
    /// The name kids see, e.g. on the family picker: the child's own handle,
    /// never the name a parent entered (that stays in the parent view).
    public let displayName: String
    /// The child's avatar as the server has it: usually an emoji, or an image
    /// path starting with "/". Nil for the guest and before the first sync.
    public let avatar: String?
    public let createdAt: Date
    /// A parent turned this child's telemetry off: Sync uploads their progress
    /// but not how they played (Sync's `SyncKinds.telemetry`).
    public let telemetryOptOut: Bool

    public init(
        id: UUID, kind: Kind, remoteID: Int?, displayName: String, avatar: String? = nil, createdAt: Date,
        telemetryOptOut: Bool = false
    ) {
        self.id = id
        self.kind = kind
        self.remoteID = remoteID
        self.displayName = displayName
        self.avatar = avatar
        self.createdAt = createdAt
        self.telemetryOptOut = telemetryOptOut
    }
}

// MARK: - Events

/// An event's type, stored as a string so new kinds need no schema change.
/// Namespaced by dots, e.g. `node.won`.
public struct EventKind: RawRepresentable, Hashable, Sendable, Codable, ExpressibleByStringLiteral,
    CustomStringConvertible
{
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public init(stringLiteral value: String) { self.rawValue = value }
    public var description: String { rawValue }
}

/// The body of one kind of event. Declare a `Codable` struct with a static
/// `kind` to add a new event; it's stored as JSON.
public protocol EventPayload: Codable, Sendable {
    static var kind: EventKind { get }
}

/// Whether the server has accepted an event yet.
public enum UploadState: String, Sendable, Codable {
    case pending
    case uploaded
}

/// An event as recorded in the queue.
public struct StoredEvent: Identifiable, Hashable, Sendable {
    /// Generated on device; the server removes duplicates by it.
    public let id: UUID
    public let profileID: Profile.ID
    public let kind: EventKind
    /// The payload as JSON (UTF-8), exactly as it will be uploaded.
    public let payload: Data
    /// When it happened, by the device clock.
    public let occurredAt: Date
    public let uploadState: UploadState

    public init(
        id: UUID, profileID: Profile.ID, kind: EventKind, payload: Data, occurredAt: Date,
        uploadState: UploadState
    ) {
        self.id = id
        self.profileID = profileID
        self.kind = kind
        self.payload = payload
        self.occurredAt = occurredAt
        self.uploadState = uploadState
    }

    /// The payload decoded as `Payload`, or nil when the event is another kind.
    public func decode<Payload: EventPayload>(_: Payload.Type) throws -> Payload? {
        guard kind == Payload.kind else { return nil }
        return try EventCoding.decoder.decode(Payload.self, from: payload)
    }
}

/// One JSON format for every payload, so what's stored is what's uploaded.
enum EventCoding {
    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

// MARK: - Progress

/// What a profile has achieved: its own events merged with what the server
/// has from the child's other devices (``ServerProgress``). Grows as more
/// event kinds land.
public struct ProfileProgress: Hashable, Sendable {
    /// Map nodes won at least once.
    public var nodesWon: Set<Int>
    /// Best stars per won node, where known (wins recorded before stars
    /// existed have none until the server's 0 arrives).
    public var stars: [Int: Int]
    /// The furthest node unlocked: one past the highest node won, or a
    /// Dragon's Trial placement if that is further; at least 1.
    public var frontier: Int
    /// Dragons caught, by id, with how many of each.
    public var dragons: [Int: Int]
    /// Active minutes played, as the server counts them.
    public var playMinutes: Int
    /// Proving Grounds bests per level, keyed like `ProvingMedalEarned.level`
    /// ("mul-7"), from this device's events only. Only levels with a medal appear.
    public var provingBests: [String: ProvingBest]
    /// The companion the kid last chose on this device (the latest
    /// ``CompanionChosen``), or nil if they never chose one — play with Pip.
    public var companionID: String?
    /// The font theme the kid last chose on this device (the latest
    /// ``FontChosen``), or nil if they never chose one — use the default.
    public var fontThemeID: String?
    /// The hardest Memorize level completed on this device per server passage
    /// revision: 1 easy, 2 medium, 3 hard (the server's `mastery_level`). A
    /// passage edited since has a new revision and starts again, as on the
    /// server.
    public var memorizedPassages: [MemorizedPassage: Int]
    /// The hardest Memorize level completed per bundled sample id.
    public var memorizedSamples: [String: Int]
    /// The kid took the Dragon's Trial on this device (a `TrialCompleted`
    /// event). The trial is once per child, so the map stops offering it.
    public var trialTaken: Bool

    /// `frontier` defaults to one past the highest of `nodesWon`.
    public init(
        nodesWon: Set<Int> = [], stars: [Int: Int] = [:], frontier: Int? = nil, dragons: [Int: Int] = [:],
        playMinutes: Int = 0, provingBests: [String: ProvingBest] = [:], companionID: String? = nil,
        fontThemeID: String? = nil,
        memorizedPassages: [MemorizedPassage: Int] = [:], memorizedSamples: [String: Int] = [:],
        trialTaken: Bool = false
    ) {
        self.nodesWon = nodesWon
        self.stars = stars
        self.frontier = frontier ?? ((nodesWon.max() ?? 0) + 1)
        self.dragons = dragons
        self.playMinutes = playMinutes
        self.provingBests = provingBests
        self.companionID = companionID
        self.fontThemeID = fontThemeID
        self.memorizedPassages = memorizedPassages
        self.memorizedSamples = memorizedSamples
        self.trialTaken = trialTaken
    }

    /// The hardest level completed of this revision of a server passage, 0 if
    /// none.
    public func memorizeLevel(passageID: Int, revision: String) -> Int {
        memorizedPassages[MemorizedPassage(passageID: passageID, revision: revision)] ?? 0
    }
}

/// One revision of a server Memorize passage: its id and `updated_at`.
public struct MemorizedPassage: Hashable, Sendable {
    public var passageID: Int
    public var revision: String

    public init(passageID: Int, revision: String) {
        self.passageID = passageID
        self.revision = revision
    }
}

/// The `mastery_level` completing a passage at `difficulty` earns, 0 for an
/// unknown difficulty.
func memorizeMasteryLevel(_ difficulty: String) -> Int {
    switch difficulty {
    case "easy": 1
    case "medium": 2
    case "hard": 3
    default: 0
    }
}

/// A child's progress as the server has it, from every device
/// (`GET /api/sync/progress`). Sync saves it after each upload.
public struct ServerProgress: Hashable, Sendable {
    /// The server's map frontier.
    public var currentNodeID: Int
    /// Best stars for every node won.
    public var stars: [Int: Int]
    /// Dragon id → how many caught.
    public var dragons: [Int: Int]
    public var playMinutes: Int

    public init(currentNodeID: Int = 1, stars: [Int: Int] = [:], dragons: [Int: Int] = [:], playMinutes: Int = 0) {
        self.currentNodeID = currentNodeID
        self.stars = stars
        self.dragons = dragons
        self.playMinutes = playMinutes
    }
}

/// The best a profile has done on one Proving Grounds level.
public struct ProvingBest: Hashable, Sendable {
    /// The best medal earned ("bronze" < "silver" < "gold").
    public var medal: String
    /// The fastest medal run, in milliseconds — not necessarily the run that
    /// earned `medal` (a quick bronze with a slip can beat a slower gold).
    public var bestMs: Int

    public init(medal: String, bestMs: Int) {
        self.medal = medal
        self.bestMs = bestMs
    }

    /// Worst → best, as MEDAL_RANK in src/rules/provingGrounds.js and
    /// `Medal.rank` in GameRules. An unknown medal ranks below bronze.
    static func rank(_ medal: String) -> Int {
        switch medal {
        case "gold": 3
        case "silver": 2
        case "bronze": 1
        default: 0
        }
    }

    /// Folds every medal run into one best per level.
    static func bests(from runs: [ProvingMedalEarned]) -> [String: ProvingBest] {
        var bests: [String: ProvingBest] = [:]
        for run in runs {
            guard var best = bests[run.level] else {
                bests[run.level] = ProvingBest(medal: run.medal, bestMs: run.elapsedMs)
                continue
            }
            if rank(run.medal) > rank(best.medal) { best.medal = run.medal }
            best.bestMs = min(best.bestMs, run.elapsedMs)
            bests[run.level] = best
        }
        return bests
    }
}

// MARK: - Content

/// A server content document the device keeps a copy of, e.g. `rule_settings`
/// (named as in GET /api/content/versions). Stored as a string, so a new
/// document needs no schema change.
public struct ContentName: RawRepresentable, Hashable, Sendable, Codable, ExpressibleByStringLiteral,
    CustomStringConvertible
{
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public init(stringLiteral value: String) { self.rawValue = value }
    public var description: String { rawValue }
}

/// The last synced copy of a content document (ADR 0003): what the app plays
/// from, online or off, until a newer version downloads.
public struct CachedContent: Hashable, Sendable {
    public let name: ContentName
    /// The server's version of this copy, compared with GET /api/content/versions.
    public let version: String
    /// The document as JSON (UTF-8).
    public let json: Data
    /// When it was downloaded, by the device clock.
    public let syncedAt: Date

    public init(name: ContentName, version: String, json: Data, syncedAt: Date) {
        self.name = name
        self.version = version
        self.json = json
        self.syncedAt = syncedAt
    }
}
