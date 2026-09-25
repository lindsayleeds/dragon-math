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

private let loginToken = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a9b"
private let familyToken = "00000000-0000-4000-8000-000000000001"

private func childSession(needsHandle: Bool = false, familyMode: Bool = false) -> String {
    """
    {"token": "kid.jwt.token", "user": {"id": 42, "username": "\(needsHandle ? loginToken : "sparky")",
      "account_type": "child", "current_node_id": 3, "avatar": "🐉", "font": "handwritten",
      "dragon_trial_completed": true, "needs_handle": \(needsHandle), "effective_plan": "free",
      "entitlements": {"games_locked": []}\(familyMode ? #", "family_mode": true"# : "")}}
    """
}

private let parentSession = """
{"token": "parent.jwt.token", "user": {"id": 9, "username": "apple:0001", "account_type": "parent",
  "email": null, "email_verified": false, "contact_email": null, "contact_email_verified": false,
  "adult_role": "teacher", "plan": "classroom"}}
"""

private func service(_ transport: StubTransport) -> APIKidSignInService {
    // As the app builds it: a client that never has a session to send.
    APIKidSignInService(api: DragonAPIClient(baseURL: URL(string: "http://localhost:3001")!, transport: transport) { nil }.api)
}

private func jsonBody(_ data: Data?) throws -> [String: Any] {
    let data = try #require(data)
    return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
}

@Suite struct KidSignInServiceTests {
    @Test func childLoginPostsTheLinkTokenAndReturnsTheKid() async throws {
        let transport = StubTransport(json: childSession())

        let account = try await service(transport).signIn(loginToken: loginToken)

        #expect(account.session == KidSession(token: "kid.jwt.token", childID: 42, familyToken: nil))
        #expect(account.child == RemoteChild(id: 42, username: "sparky", realName: nil, avatar: "🐉"))
        let sent = try #require(transport.requests.first)
        #expect(sent.request.method == .post)
        #expect(sent.request.path == "/api/auth/child-login")
        #expect(try jsonBody(sent.body) as? [String: String] == ["token": loginToken])
        // Possessing the link is the credential: no session goes with it.
        #expect(sent.request.headerFields[.authorization] == nil)
    }

    @Test func aKidWithoutAHandleHasNoName() async throws {
        let account = try await service(StubTransport(json: childSession(needsHandle: true)))
            .signIn(loginToken: loginToken)
        // The placeholder username is the login token; it must never show.
        #expect(account.child.username == nil)
    }

    @Test func aGrownUpsLinkIsRefused() async {
        await #expect(throws: KidSignInError.notAKid) {
            try await service(StubTransport(json: parentSession)).signIn(loginToken: loginToken)
        }
    }

    @Test(arguments: [
        (HTTPResponse.Status.badRequest, KidSignInError.brokenLink),
        (.notFound, .notFound(message: "We couldn't find that link. Ask for a fresh one.")),
        (.forbidden, .notAKid),
        (.tooManyRequests, .rateLimited),
        (.internalServerError, .unavailable),
    ])
    func childLoginMapsErrors(status: HTTPResponse.Status, expected: KidSignInError) async {
        let transport = StubTransport(status: status, json: #"{"error": "We couldn't find that link. Ask for a fresh one."}"#)
        await #expect(throws: expected) {
            try await service(transport).signIn(loginToken: loginToken)
        }
    }

    @Test func familyListsTheKidsByHandle() async throws {
        let transport = StubTransport(json: """
            {"children": [
              {"id": 1, "username": "ember", "avatar": "🦊", "needs_handle": false},
              {"id": 2, "username": "\(loginToken)", "avatar": "⚔️", "needs_handle": true}
            ]}
            """)

        let kids = try await service(transport).family(familyToken: familyToken)

        #expect(kids == [
            RemoteChild(id: 1, username: "ember", realName: nil, avatar: "🦊"),
            RemoteChild(id: 2, username: nil, realName: nil, avatar: "⚔️"),
        ])
        let sent = try #require(transport.requests.first)
        #expect(sent.request.method == .get)
        #expect(sent.request.path == "/api/auth/family/\(familyToken)")
    }

    @Test func anUnknownFamilyLinkSaysSo() async {
        let transport = StubTransport(status: .notFound, json: #"{"error": "No such family."}"#)
        await #expect(throws: KidSignInError.notFound(message: "No such family.")) {
            try await service(transport).family(familyToken: familyToken)
        }
    }

    @Test func familyLoginPostsTheChildAndKeepsTheFamilyToken() async throws {
        let transport = StubTransport(json: childSession(familyMode: true))

        let account = try await service(transport).signIn(childID: 42, familyToken: familyToken)

        #expect(account.session == KidSession(token: "kid.jwt.token", childID: 42, familyToken: familyToken))
        let sent = try #require(transport.requests.first)
        #expect(sent.request.path == "/api/auth/family-login")
        let body = try jsonBody(sent.body)
        #expect(body["child_id"] as? Int == 42)
        #expect(body["token"] as? String == familyToken)
    }
}
