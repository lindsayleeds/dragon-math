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
        .map(ProblemAttempted.self, to: "attempt") {
            typealias Wire = Components.Schemas.SyncAttemptPayload
            guard let op = Wire.OperatorPayload(rawValue: $0.op) else { throw SyncMappingError.invalidValue("operator", $0.op) }
            guard let outcome = Wire.OutcomePayload(rawValue: $0.outcome) else {
                throw SyncMappingError.invalidValue("outcome", $0.outcome)
            }
            return Wire(
                nodeId: $0.nodeID, operandA: $0.operandA, operandB: $0.operandB, _operator: op, answer: $0.answer,
                outcome: outcome, timeMs: $0.timeMs.map(Double.init))
        },
        .map(ProvingMedalEarned.self, to: "proving_medal") {
            typealias Wire = Components.Schemas.SyncProvingMedalPayload
            guard let mode = Wire.ModePayload(rawValue: $0.mode) else { throw SyncMappingError.invalidValue("mode", $0.mode) }
            guard let medal = Wire.MedalPayload(rawValue: $0.medal) else { throw SyncMappingError.invalidValue("medal", $0.medal) }
            return Wire(mode: mode, digit: $0.digit, medal: medal, elapsedMs: $0.elapsedMs, wrongCount: $0.wrongCount)
        },
        .map(CompanionChosen.self, to: "companion_chosen") {
            // An id this app's contract doesn't list stays pending, for a
            // later version that does.
            guard let id = Components.Schemas.SyncCompanionChosenPayload.CompanionIdPayload(rawValue: $0.companionID)
            else { throw SyncMappingError.invalidValue("companion_id", $0.companionID) }
            return Components.Schemas.SyncCompanionChosenPayload(companionId: id)
        },
        .map(FontChosen.self, to: "font_chosen") {
            // As companions: a theme this app's contract doesn't list stays
            // pending, for a later version that does.
            guard let font = Components.Schemas.SyncFontChosenPayload.FontPayload(rawValue: $0.fontThemeID)
            else { throw SyncMappingError.invalidValue("font", $0.fontThemeID) }
            return Components.Schemas.SyncFontChosenPayload(font: font)
        },
        .map(MemorizePassageCompleted.self, to: "memorize_progress") {
            typealias Wire = Components.Schemas.SyncMemorizeProgressPayload
            guard let difficulty = Wire.DifficultyPayload(rawValue: $0.difficulty) else {
                throw SyncMappingError.invalidValue("difficulty", $0.difficulty)
            }
            return Wire(passageId: $0.passageID, difficulty: difficulty, body: $0.body, updatedAt: $0.revision)
        },
        // MemorizeSampleCompleted is deliberately absent: bundled samples
        // exist only on the device.
        .map(TrialCompleted.self, to: "trial_completed") { trial in
            typealias Result = Components.Schemas.SyncTrialOpResult
            func result(_ op: String) throws -> Result {
                guard let r = trial.perOp[op] else { throw SyncMappingError.invalidValue("perOp", op) }
                guard let band = Result.BandPayload(rawValue: r.band) else { throw SyncMappingError.invalidValue("band", r.band) }
                return Result(score: r.score, band: band, problemsAsked: r.problemsAsked)
            }
            return Components.Schemas.SyncTrialCompletedPayload(
                targetNodeId: trial.targetNodeID,
                perOp: .init(add: try result("add"), sub: try result("sub"), mul: try result("mul"), div: try result("div")))
        },
        .map(WrongAnswerTapped.self, to: "wrong_tap") {
            typealias Wire = Components.Schemas.SyncWrongTapPayload
            guard let op = Wire.OperatorPayload(rawValue: $0.op) else { throw SyncMappingError.invalidValue("operator", $0.op) }
            return Wire(
                nodeId: $0.nodeID, operandA: $0.operandA, operandB: $0.operandB, _operator: op,
                correctAnswer: $0.correctAnswer, tappedValue: $0.tappedValue, timeMs: $0.timeMs.map(Double.init))
        },
        // SteppingStonesCrossed is absent too: the best-times board is the
        // device's own, as on the web.
    ]

    /// The server kinds that are telemetry — how the kid played (attempts,
    /// wrong taps, matches, playtime) rather than what they earned. For a child
    /// whose parent turned telemetry off (``Store/Profile/telemetryOptOut``)
    /// Sync never sends them: it drops them from the queue instead. Everything
    /// else is progress and always uploads (node wins, dragons, medals,
    /// memorize progress).
    ///
    /// The one list on this side, built from the server's own
    /// (`TELEMETRY_KINDS` in server/contracts/sync.js, published as
    /// `SyncTelemetryKind`), so the app holds back exactly what the server
    /// would drop.
    public static let telemetry: Set<String> = Set(Components.Schemas.SyncTelemetryKind.allCases.map(\.rawValue))

    /// Diagnostics tied to a child are named with this prefix, and are
    /// telemetry too (the server's rule as well).
    public static let telemetryPrefix = "telemetry."

    /// Whether events of server kind `serverKind` are telemetry.
    public static func isTelemetry(_ serverKind: String) -> Bool {
        telemetry.contains(serverKind) || serverKind.hasPrefix(telemetryPrefix)
    }
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
