// Local persistence behind a `Store` interface (ADR 0003). Everything a kid
// does is recorded as an event with a device-generated UUID, queued locally
// and uploaded later by Sync; progress is derived from those events. The rest
// of the app talks to `Store` and never imports GRDB or touches SQLite.
import Foundation

public enum StoreModule {
    /// The module's name.
    public static let name = "Store"
}

/// The app's local database: profiles, the event queue, and progress derived
/// from events. `SQLiteStore` is the GRDB-backed implementation.
public protocol Store: Sendable {
    /// The on-device guest identity, created the first time the store opens.
    var guestProfile: Profile { get }

    /// Every profile on this device, guest first, then children by creation.
    func profiles() async throws -> [Profile]

    /// Adds a local profile for a server child account, or returns the
    /// existing one for that `remoteID`.
    func addChildProfile(remoteID: Int, displayName: String) async throws -> Profile

    /// Appends an event to the queue for `profileID`, stamped with the
    /// device clock, in the `pending` upload state.
    @discardableResult
    func record<Payload: EventPayload>(_ payload: Payload, for profileID: Profile.ID) async throws -> StoredEvent

    /// A profile's events, oldest first.
    func events(for profileID: Profile.ID) async throws -> [StoredEvent]

    /// Events still waiting to upload, oldest first, at most `limit`.
    func pendingEvents(limit: Int) async throws -> [StoredEvent]

    /// Marks events as accepted by the server. Unknown ids are ignored.
    func markUploaded(_ eventIDs: [StoredEvent.ID]) async throws

    /// Progress derived from a profile's events.
    func progress(for profileID: Profile.ID) async throws -> ProfileProgress

    /// The profile's progress now and again after every change that affects
    /// it, for SwiftUI views (`for try await progress in ...`). The stream
    /// ends when the consuming task is cancelled.
    func observeProgress(for profileID: Profile.ID) -> AsyncThrowingStream<ProfileProgress, any Error>
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
    public let displayName: String
    public let createdAt: Date

    public init(id: UUID, kind: Kind, remoteID: Int?, displayName: String, createdAt: Date) {
        self.id = id
        self.kind = kind
        self.remoteID = remoteID
        self.displayName = displayName
        self.createdAt = createdAt
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

/// What a profile has achieved, derived from its events. Grows as more event
/// kinds land.
public struct ProfileProgress: Hashable, Sendable {
    /// Map nodes won at least once.
    public var nodesWon: Set<Int>

    public init(nodesWon: Set<Int> = []) {
        self.nodesWon = nodesWon
    }
}
