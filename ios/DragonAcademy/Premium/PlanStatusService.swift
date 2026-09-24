import API
import Foundation

/// What the purchase screen needs from `GET /api/plan/status`.
struct PlanStatusSnapshot: Equatable, Sendable {
    /// free, premium or classroom (free text; the server may add plans).
    let plan: String
    /// stripe, app_store, comp, manual or classroom; nil on free.
    let source: String?
    /// The UUID to buy with. Only a parent session gets one.
    let appAccountToken: UUID?

    /// Premium or better. Classroom includes everything Premium does.
    var isPremium: Bool { plan == "premium" || plan == "classroom" }
}

enum PlanStatusError: Error, Equatable {
    /// 401: no session, or it expired.
    case signedOut
    /// No connection, a 5xx, or anything the contract doesn't describe.
    case unavailable
}

/// The server's one plan status for this family (docs/APP_STORE.md). It is
/// the source of truth for premium: the server hears of an App Store purchase
/// from Apple's notification, not from the app.
protocol PlanStatusService: Sendable {
    func status() async throws(PlanStatusError) -> PlanStatusSnapshot
}

/// `GET /api/plan/status` through the generated client, with the parent session.
struct APIPlanStatusService: PlanStatusService {
    let api: any APIProtocol

    func status() async throws(PlanStatusError) -> PlanStatusSnapshot {
        let output: Operations.GetPlanStatus.Output
        do {
            output = try await api.getPlanStatus()
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let status = try? ok.body.json else { throw .unavailable }
            return PlanStatusSnapshot(
                plan: status.plan,
                source: status.source,
                appAccountToken: status.appAccountToken.flatMap(UUID.init(uuidString:))
            )
        case .unauthorized:
            throw .signedOut
        case .undocumented:
            throw .unavailable
        }
    }
}

/// A free parent with a fixed token; for previews and `-ParentAccessFakes`.
struct FakePlanStatusService: PlanStatusService {
    var snapshot = PlanStatusSnapshot(
        plan: "free",
        source: nil,
        appAccountToken: UUID(uuidString: "0F8FAD5B-D9CB-469F-A165-70867728950E")
    )

    func status() async throws(PlanStatusError) -> PlanStatusSnapshot { snapshot }
}
