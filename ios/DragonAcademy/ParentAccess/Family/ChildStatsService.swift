import API
import Foundation
import SwiftUI

/// One child's stats as the server has them, from every device
/// (`GET /api/parent/children/{childId}/summary`). Offline play is in them
/// once it has synced.
struct ChildStats: Equatable, Sendable {
    struct Operation: Equatable, Sendable {
        /// add, sub, mul or div.
        let code: String
        let answered: Int
        let solved: Int
        /// 0–1.
        let accuracy: Double
        /// Average time to a solve; nil with none.
        let averageSolveMs: Double?
    }

    var minutesToday = 0
    var minutesThisWeek = 0
    var minutesTotal = 0
    var lastPlayedAt: Date?
    /// The furthest node unlocked.
    var frontierNode = 1
    var nodesWon = 0
    var stars = 0
    var threeStarNodes = 0
    var dragonKinds = 0
    var dragonsTotal = 0
    /// The rolling window `operations` covers.
    var masteryWindowDays = 30
    var operations: [Operation] = []
    var strongest: String?
    var weakest: String?
}

enum ChildStatsError: Error, Equatable {
    /// 401: the parent session is no longer accepted.
    case sessionExpired
    /// 403/404: not (or no longer) this parent's child.
    case notFound
    /// No connection, a 5xx, or anything the contract doesn't describe.
    case unavailable
}

protocol ChildStatsService: Sendable {
    func stats(childID: Int) async throws(ChildStatsError) -> ChildStats
}

/// Through the generated client, with the parent session's token.
struct APIChildStatsService: ChildStatsService {
    let api: any APIProtocol

    func stats(childID: Int) async throws(ChildStatsError) -> ChildStats {
        let output: Operations.GetChildSummary.Output
        do {
            output = try await api.getChildSummary(path: .init(childId: childID))
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let body = try? ok.body.json else { throw .unavailable }
            return ChildStats(body)
        case .unauthorized:
            throw .sessionExpired
        case .forbidden, .notFound:
            throw .notFound
        case .badRequest, .undocumented:
            throw .unavailable
        }
    }
}

extension ChildStats {
    init(_ body: Components.Schemas.ChildSummaryResponse) {
        self.init(
            minutesToday: body.play.minutesToday,
            minutesThisWeek: body.play.minutes7d,
            minutesTotal: body.play.minutesTotal,
            lastPlayedAt: body.play.lastPlayedAt.flatMap(Self.parseDate),
            frontierNode: body.progress.currentNodeId,
            nodesWon: body.progress.nodesWon,
            stars: body.progress.stars,
            threeStarNodes: body.progress.threeStarNodes,
            dragonKinds: body.dragons.kinds,
            dragonsTotal: body.dragons.total,
            masteryWindowDays: body.mastery.windowDays,
            operations: body.mastery.operators.map {
                Operation(
                    code: $0._operator, answered: $0.total, solved: $0.childWins, accuracy: $0.accuracy,
                    averageSolveMs: $0.avgChildMs)
            },
            strongest: body.mastery.strongest,
            weakest: body.mastery.weakest)
    }

    /// The server's ISO timestamps carry milliseconds; accept either form.
    static func parseDate(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }
}

/// Made-up stats for previews and `-ParentAccessFakes YES`.
struct FakeChildStatsService: ChildStatsService {
    var stats = ChildStats(
        minutesToday: 12, minutesThisWeek: 48, minutesTotal: 310, lastPlayedAt: Date(timeIntervalSinceNow: -3600),
        frontierNode: 9, nodesWon: 8, stars: 19, threeStarNodes: 5, dragonKinds: 6, dragonsTotal: 11,
        operations: [
            .init(code: "add", answered: 60, solved: 55, accuracy: 55.0 / 60, averageSolveMs: 2400),
            .init(code: "sub", answered: 30, solved: 21, accuracy: 0.7, averageSolveMs: 3900),
        ],
        strongest: "add", weakest: "sub")

    func stats(childID: Int) async throws(ChildStatsError) -> ChildStats { stats }
}

extension EnvironmentValues {
    /// Per-child stats from the server; a fake by default, so previews never
    /// reach the server. The app sets the live one.
    @Entry var childStats: any ChildStatsService = FakeChildStatsService()
}
