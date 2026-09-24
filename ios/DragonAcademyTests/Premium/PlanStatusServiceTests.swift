import API
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing
@testable import DragonAcademy

/// Answers every request with one canned response.
private struct CannedTransport: ClientTransport {
    let status: HTTPResponse.Status
    let json: String

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var response = HTTPResponse(status: status)
        response.headerFields[.contentType] = "application/json; charset=utf-8"
        return (response, HTTPBody(json))
    }
}

private func service(status: HTTPResponse.Status = .ok, json: String) -> APIPlanStatusService {
    APIPlanStatusService(api: DragonAPIClient(baseURL: URL(string: "http://localhost:3001")!,
                                              transport: CannedTransport(status: status, json: json)) { "jwt" }.api)
}

/// What server/routes/plan.js sends for an App Store subscriber: timestamps
/// from toISOString(), with milliseconds.
private let appStorePremiumJSON = """
{"plan": "premium", "source": "app_store", "expires_at": "2026-10-23T12:00:00.000Z", "will_renew": true,
 "grants": [{"source": "app_store", "plan": "premium", "expires_at": "2026-10-23T12:00:00.000Z", "will_renew": true}],
 "entitlements": {"games_locked": [], "child_limit": 6, "can_use_digest": true},
 "app_account_token": "0f8fad5b-d9cb-469f-a165-70867728950e"}
"""

@Test func readsThePlanAndAppAccountTokenIncludingMillisecondTimestamps() async throws {
    let status = try await service(json: appStorePremiumJSON).status()

    #expect(status == PlanStatusSnapshot(
        plan: "premium", source: "app_store",
        appAccountToken: UUID(uuidString: "0F8FAD5B-D9CB-469F-A165-70867728950E")))
    #expect(status.isPremium)
}

@Test func aKidSessionHasNoToken() async throws {
    let json = """
    {"plan": "free", "source": null, "expires_at": null, "will_renew": null, "grants": [],
     "entitlements": {"games_locked": ["munchers"], "child_limit": 1, "can_use_digest": false},
     "app_account_token": null}
    """
    let status = try await service(json: json).status()

    #expect(status.appAccountToken == nil)
    #expect(!status.isPremium)
}

@Test func unauthorizedIsSignedOut() async {
    await #expect(throws: PlanStatusError.signedOut) {
        try await service(status: .unauthorized, json: #"{"error": "Unauthorized"}"#).status()
    }
}

@Test func aServerErrorIsUnavailable() async {
    await #expect(throws: PlanStatusError.unavailable) {
        try await service(status: .internalServerError, json: #"{"error": "x"}"#).status()
    }
}
