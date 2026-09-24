// Which Store events upload, and as what. The Store names kinds with dots
// (`node.won`) and camel-case fields; the server's sync kinds are snake case
// with their own payload schemas (server/contracts/sync.js, generated as
// `Components.Schemas.Sync*Payload`). Each mapping turns one into the other.
import API
import Foundation
import Store

/// The Store event kinds Sync uploads. A kind missing here stays pending in
/// the queue, untouched, so a later app version that maps it still sends it.
public enum SyncKinds {
    /// One line per kind: the Store payload, the server kind, and how to build
    /// the server's payload from it.
    public static let all: [SyncKindMapping] = [
        .map(NodeWon.self, to: "node_won") { Components.Schemas.SyncNodeWonPayload(nodeId: $0.nodeID, stars: $0.stars ?? 0) },
        .map(DragonsCollected.self, to: "dragons_collected") { Components.Schemas.SyncDragonsCollectedPayload(dragonIds: $0.dragonIDs) },
        .map(ProvingMedalEarned.self, to: "proving_medal") {
            typealias Wire = Components.Schemas.SyncProvingMedalPayload
            guard let mode = Wire.ModePayload(rawValue: $0.mode) else { throw SyncMappingError.invalidValue("mode", $0.mode) }
            guard let medal = Wire.MedalPayload(rawValue: $0.medal) else { throw SyncMappingError.invalidValue("medal", $0.medal) }
            return Wire(mode: mode, digit: $0.digit, medal: medal, elapsedMs: $0.elapsedMs, wrongCount: $0.wrongCount)
        },
    ]
}

/// How one Store event kind becomes a server sync event.
public struct SyncKindMapping: Sendable {
    public let storeKind: EventKind
    public let serverKind: String
    private let payload: @Sendable (StoredEvent) throws -> Components.Schemas.SyncEvent.PayloadPayload

    /// Maps `Event` (a Store payload) to `serverKind`, whose payload is
    /// `Wire`, usually one of the generated `Components.Schemas.Sync*Payload`
    /// types so the compiler checks it against the contract. A transform that
    /// throws leaves that event pending in the queue.
    public static func map<Event: EventPayload, Wire: Encodable & Sendable>(
        _: Event.Type, to serverKind: String, _ transform: @escaping @Sendable (Event) throws -> Wire
    ) -> SyncKindMapping {
        SyncKindMapping(storeKind: Event.kind, serverKind: serverKind) { event in
            guard let decoded = try event.decode(Event.self) else { throw SyncMappingError.wrongKind(event.kind) }
            // The event's payload is an open JSON object on the wire, so the
            // typed payload goes through JSON to get there.
            let json = try JSONEncoder().encode(transform(decoded))
            return try JSONDecoder().decode(Components.Schemas.SyncEvent.PayloadPayload.self, from: json)
        }
    }

    private init(
        storeKind: EventKind, serverKind: String,
        payload: @escaping @Sendable (StoredEvent) throws -> Components.Schemas.SyncEvent.PayloadPayload
    ) {
        self.storeKind = storeKind
        self.serverKind = serverKind
        self.payload = payload
    }

    /// The server event for `event`, belonging to server child `childID`.
    func syncEvent(for event: StoredEvent, childID: Int) throws -> Components.Schemas.SyncEvent {
        Components.Schemas.SyncEvent(
            id: event.id.uuidString, childId: childID, kind: serverKind, occurredAt: event.occurredAt,
            payload: try payload(event))
    }
}

enum SyncMappingError: Error {
    case wrongKind(EventKind)
    /// A stored field the server's schema has no value for.
    case invalidValue(String, String)
}
