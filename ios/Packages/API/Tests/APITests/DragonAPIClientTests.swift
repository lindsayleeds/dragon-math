import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing
import API

/// Answers every request with one canned response and remembers what was sent.
private final class StubTransport: ClientTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [(request: HTTPRequest, baseURL: URL)] = []
    let status: HTTPResponse.Status
    let json: String

    init(status: HTTPResponse.Status = .ok, json: String) {
        self.status = status
        self.json = json
    }

    var requests: [(request: HTTPRequest, baseURL: URL)] {
        lock.withLock { _requests }
    }

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        lock.withLock { _requests.append((request, baseURL)) }
        var response = HTTPResponse(status: status)
        response.headerFields[.contentType] = "application/json; charset=utf-8"
        return (response, HTTPBody(json))
    }
}

private let childJSON = """
{"user": {"id": 7, "username": "ember", "account_type": "child", "current_node_id": 3,
  "avatar": "dragon-red", "font": "default", "dragon_trial_completed": false,
  "needs_handle": true, "effective_plan": "free", "entitlements": {"games_locked": []}}}
"""

private let baseURL = URL(string: "https://dragon.example")!

@Test func sendsTheBearerTokenAndDecodesTheResponse() async throws {
    let transport = StubTransport(json: childJSON)
    let client = DragonAPIClient(baseURL: baseURL, transport: transport) { "jwt-123" }

    let output = try await client.api.getCurrentUser()

    guard case .child(let child) = try output.ok.body.json.user else {
        Issue.record("expected a child user")
        return
    }
    #expect(child.needsHandle)
    let sent = try #require(transport.requests.first)
    #expect(sent.request.method == .get)
    #expect(sent.request.path == "/api/auth/me")
    #expect(sent.baseURL == baseURL)
    #expect(sent.request.headerFields[.authorization] == "Bearer jwt-123")
}

@Test func sendsNoAuthorizationWhenSignedOut() async throws {
    let transport = StubTransport(json: childJSON)
    let client = DragonAPIClient(baseURL: baseURL, transport: transport) { nil }

    _ = try await client.api.getCurrentUser()

    #expect(transport.requests.first?.request.headerFields[.authorization] == nil)
}

@Test func asksForTheTokenOnEveryRequest() async throws {
    let transport = StubTransport(json: childJSON)
    let tokens = TokenSequence(["first", "second"])
    let client = DragonAPIClient(baseURL: baseURL, transport: transport) { tokens.next() }

    _ = try await client.api.getCurrentUser()
    _ = try await client.api.getCurrentUser()

    #expect(transport.requests.map { $0.request.headerFields[.authorization] }
        == ["Bearer first", "Bearer second"])
}

@Test func surfacesAnErrorResponseAsItsDocumentedCase() async throws {
    let transport = StubTransport(status: .unauthorized, json: #"{"error": "Token expired"}"#)
    let client = DragonAPIClient(baseURL: baseURL, transport: transport) { "old" }

    let output = try await client.api.getCurrentUser()

    guard case .unauthorized(let unauthorized) = output else {
        Issue.record("expected 401, got \(output)")
        return
    }
    #expect(try unauthorized.body.json.error == "Token expired")
}

private final class TokenSequence: @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [String]
    init(_ tokens: [String]) { self.tokens = tokens }
    func next() -> String? { lock.withLock { tokens.isEmpty ? nil : tokens.removeFirst() } }
}
