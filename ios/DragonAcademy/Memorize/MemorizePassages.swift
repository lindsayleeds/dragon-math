import API
import Foundation
import Store

/// A passage to learn: one a grown-up assigned on the server, or one of the
/// app's bundled samples (for the guest, and for a child whose passage book is
/// still empty).
struct MemorizePassage: Identifiable, Hashable, Sendable {
    enum Source: Hashable, Sendable {
        /// A server passage; `revision` is its `updated_at` exactly as served,
        /// which the progress upload sends back so the server can tell whether
        /// it was edited since.
        case server(id: Int, revision: String)
        /// A bundled sample; progress on it stays on the device.
        case sample(id: String)
    }

    var source: Source
    var title: String
    /// verse, poem, quote, speech, definition or other.
    var category: String
    var body: String
    /// The server's `mastery_level` (0 none, 1 easy, 2 medium, 3 hard); 0 for
    /// samples. What this device has recorded since is merged in by the model.
    var serverMastery: Int = 0

    var id: String {
        switch source {
        case .server(let id, _): "server:\(id)"
        case .sample(let id): "sample:\(id)"
        }
    }

    var isSample: Bool {
        if case .sample = source { true } else { false }
    }
}

extension MemorizePassage {
    init(server passage: Components.Schemas.MemoryPassage) {
        self.init(
            source: .server(id: passage.id, revision: passage.updatedAt), title: passage.title,
            category: passage.category, body: passage.body, serverMastery: passage.masteryLevel)
    }

    /// Bundled passages: short, public domain, and every word starting with
    /// A–Z or 0–9 so Hard mode can be played (a test checks).
    static let samples: [MemorizePassage] = [
        MemorizePassage(
            source: .sample(id: "twinkle"), title: "Twinkle, Twinkle, Little Star", category: "poem",
            body: "Twinkle, twinkle, little star, how I wonder what you are! "
                + "Up above the world so high, like a diamond in the sky."),
        MemorizePassage(
            source: .sample(id: "thirty-days"), title: "Thirty Days Hath September", category: "poem",
            body: "Thirty days hath September, April, June, and November. "
                + "All the rest have thirty-one, except February alone."),
        MemorizePassage(
            source: .sample(id: "well-done"), title: "Benjamin Franklin", category: "quote",
            body: "Well done is better than well said."),
        MemorizePassage(
            source: .sample(id: "noun"), title: "Noun", category: "definition",
            body: "A noun is a word that names a person, place, thing, or idea."),
    ]
}

/// Where a profile's passages come from.
protocol MemorizePassageSource: Sendable {
    /// The server passages assigned to `profile`, oldest first. Empty for the
    /// guest, who has none.
    func passages(for profile: Profile) async throws -> [MemorizePassage]
}

enum MemorizePassageError: LocalizedError {
    case server(Int)

    var errorDescription: String? {
        String(localized: "We couldn't open your passage book. Check your connection, then try again.")
    }
}

/// GET /api/memory-passages?child_id= for a child profile, with whichever
/// session the app holds (a kid's own, or a parent's for a linked child).
struct LiveMemorizePassageSource: MemorizePassageSource {
    let api: any APIProtocol

    func passages(for profile: Profile) async throws -> [MemorizePassage] {
        guard profile.kind == .child, let childID = profile.remoteID else { return [] }
        switch try await api.listMemoryPassages(query: .init(childId: childID)) {
        case .ok(let ok):
            return try ok.body.json.passages.map(MemorizePassage.init(server:))
        case .badRequest: throw MemorizePassageError.server(400)
        case .unauthorized: throw MemorizePassageError.server(401)
        case .forbidden: throw MemorizePassageError.server(403)
        case .undocumented(let status, _): throw MemorizePassageError.server(status)
        }
    }
}

/// No server: the guest's source, and the default for previews and tests.
struct NoServerPassageSource: MemorizePassageSource {
    func passages(for profile: Profile) async throws -> [MemorizePassage] { [] }
}
