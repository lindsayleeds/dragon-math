import API
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing
@testable import DragonAcademy

/// Answers with one canned response and keeps what was sent.
private final class StubTransport: ClientTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [(request: HTTPRequest, body: Data?)] = []
    let status: HTTPResponse.Status
    let json: String

    init(status: HTTPResponse.Status = .ok, json: String) {
        self.status = status
        self.json = json
    }

    var requests: [(request: HTTPRequest, body: Data?)] { lock.withLock { sent } }

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let data: Data? = if let body { try await Data(collecting: body, upTo: 1 << 20) } else { nil }
        lock.withLock { sent.append((request, data)) }
        var response = HTTPResponse(status: status)
        response.headerFields[.contentType] = "application/json; charset=utf-8"
        return (response, HTTPBody(json))
    }
}

private let sessionJSON = """
{"token": "server.jwt.token", "user": {"id": 1, "username": "apple:0001", "account_type": "parent",
  "email": "x@privaterelay.appleid.com", "email_verified": false, "contact_email": null,
  "contact_email_verified": false, "adult_role": "parent", "plan": "free"}}
"""

private func service(_ transport: StubTransport) -> APIParentSignInService {
    APIParentSignInService(api: DragonAPIClient(baseURL: URL(string: "http://localhost:3001")!,
                                                transport: transport) { nil }.api)
}

@Test func postsTheIdentityTokenAndRawNonceAndReturnsTheSession() async throws {
    let transport = StubTransport(json: sessionJSON)

    let session = try await service(transport).signIn(identityToken: "apple.id.token", rawNonce: "raw-nonce")

    #expect(session == ParentSession(token: "server.jwt.token"))
    let sent = try #require(transport.requests.first)
    #expect(sent.request.method == .post)
    #expect(sent.request.path == "/api/auth/apple")
    let body = try JSONSerialization.jsonObject(with: try #require(sent.body)) as? [String: String]
    #expect(body == ["identity_token": "apple.id.token", "nonce": "raw-nonce"])
}

@Test(arguments: [
    (HTTPResponse.Status.unauthorized, ParentSignInError.rejected),
    (.badRequest, .rejected),
    (.conflict, .conflict),
    (.tooManyRequests, .rateLimited),
    (.badGateway, .unavailable),
    (.serviceUnavailable, .unavailable),
    (.internalServerError, .unavailable),
])
func mapsErrorResponses(status: HTTPResponse.Status, expected: ParentSignInError) async {
    let transport = StubTransport(status: status, json: #"{"error": "nope"}"#)
    await #expect(throws: expected) {
        try await service(transport).signIn(identityToken: "t", rawNonce: "n")
    }
}

private struct FailingTransport: ClientTransport {
    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
        throw URLError(.cannotConnectToHost)
    }
}

@Test func noConnectionIsUnavailable() async {
    let api = DragonAPIClient(baseURL: URL(string: "http://localhost:3001")!, transport: FailingTransport()) { nil }.api
    await #expect(throws: ParentSignInError.unavailable) {
        try await APIParentSignInService(api: api).signIn(identityToken: "t", rawNonce: "n")
    }
}
