// Event payloads. Each is a `Codable` struct with a stable `kind`; renaming a
// kind or a field changes what's stored and uploaded, so add new ones instead.

/// A kid beat a map node's battle.
public struct NodeWon: EventPayload, Hashable {
    public static let kind: EventKind = "node.won"

    public let nodeID: Int

    enum CodingKeys: String, CodingKey {
        case nodeID = "nodeId"
    }

    public init(nodeID: Int) {
        self.nodeID = nodeID
    }
}
