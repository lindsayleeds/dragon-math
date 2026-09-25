import API
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing
@testable import DragonAcademy

/// Answers each request from a script of (status, JSON) and keeps what was sent.
final class ContactEmailTransport: ClientTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var script: [(HTTPResponse.Status, String)]
    private var sent: [(request: HTTPRequest, body: Data?)] = []

    init(_ script: (HTTPResponse.Status, String)...) { self.script = script }

    var requests: [(request: HTTPRequest, body: Data?)] { lock.withLock { sent } }

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let data: Data? = if let body { try await Data(collecting: body, upTo: 1 << 20) } else { nil }
        let (status, json) = lock.withLock {
            sent.append((request, data))
            return script.count > 1 ? script.removeFirst() : script[0]
        }
        var response = HTTPResponse(status: status)
        response.headerFields[.contentType] = "application/json; charset=utf-8"
        return (response, HTTPBody(json))
    }
}

func contactAdultJSON(email: String? = "x@privaterelay.appleid.com", contact: String?, verified: Bool) -> String {
    func quoted(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
    return """
    {"id": 7, "username": "apple:0007", "account_type": "parent", "email": \(quoted(email)),
     "email_verified": false, "contact_email": \(quoted(contact)), "contact_email_verified": \(verified),
     "adult_role": "parent", "plan": "free"}
    """
}

private func service(_ transport: ContactEmailTransport) -> APIContactEmailService {
    APIContactEmailService(api: DragonAPIClient(baseURL: URL(string: "http://localhost:3001")!,
                                                transport: transport) { "parent.jwt" }.api)
}

@Test func statusReadsTheSignedInParent() async throws {
    let transport = ContactEmailTransport((.ok, #"{"user": \#(contactAdultJSON(contact: "mum@example.com", verified: true))}"#))

    let status = try await service(transport).status()

    #expect(status == ContactEmailStatus(loginEmail: "x@privaterelay.appleid.com",
                                         contactEmail: "mum@example.com", isVerified: true))
    let sent = try #require(transport.requests.first)
    #expect(sent.request.method == .get)
    #expect(sent.request.path == "/api/auth/me")
    #expect(sent.request.headerFields[.authorization] == "Bearer parent.jwt")
}

@Test func settingPutsTheAddressAndReportsTheLinkWasSent() async throws {
    let transport = ContactEmailTransport((.ok, """
    {"user": \(contactAdultJSON(contact: "mum@example.com", verified: false)), "verification_sent": true}
    """))

    let update = try await service(transport).setContactEmail("mum@example.com")

    #expect(update == ContactEmailUpdate(
        status: .init(loginEmail: "x@privaterelay.appleid.com", contactEmail: "mum@example.com", isVerified: false),
        verificationSent: true))
    let sent = try #require(transport.requests.first)
    #expect(sent.request.method == .put)
    #expect(sent.request.path == "/api/auth/contact-email")
    let body = try JSONSerialization.jsonObject(with: try #require(sent.body)) as? [String: String]
    #expect(body == ["email": "mum@example.com"])
}

@Test func resendPostsAndReadsTheResult() async throws {
    let transport = ContactEmailTransport((.ok, """
    {"user": \(contactAdultJSON(contact: "mum@example.com", verified: false)), "verification_sent": true}
    """))

    let update = try await service(transport).resendVerification()

    #expect(update.verificationSent)
    #expect(transport.requests.first?.request.method == .post)
    #expect(transport.requests.first?.request.path == "/api/auth/contact-email/resend")
}

@Test func aRefusedAddressCarriesTheServersMessage() async {
    let transport = ContactEmailTransport((.badRequest, #"{"error": "That's an Apple private relay address."}"#))
    await #expect(throws: ContactEmailError.rejected("That's an Apple private relay address.")) {
        try await service(transport).setContactEmail("x@privaterelay.appleid.com")
    }
}

@Test(arguments: [
    (HTTPResponse.Status.unauthorized, ContactEmailError.notSignedIn),
    (.forbidden, .notSignedIn),
    (.notFound, .notSignedIn),
    (.tooManyRequests, .rateLimited),
    (.badGateway, .sendFailed),
    (.internalServerError, .unavailable),
])
func mapsSetErrors(status: HTTPResponse.Status, expected: ContactEmailError) async {
    let transport = ContactEmailTransport((status, #"{"error": "nope"}"#))
    await #expect(throws: expected) { try await service(transport).setContactEmail("a@b.co") }
}

@Test func resendWithNothingOnFileIsNothingToVerify() async {
    let transport = ContactEmailTransport((.conflict, #"{"error": "Add an email first."}"#))
    await #expect(throws: ContactEmailError.nothingToVerify) { try await service(transport).resendVerification() }
}

@Test func aChildSessionIsNotSignedInAsAParent() async {
    let transport = ContactEmailTransport((.ok, """
    {"user": {"id": 11, "username": "sparky", "account_type": "child", "current_node_id": 1, "avatar": "x",
     "font": "clean", "dragon_trial_completed": false, "needs_handle": false, "effective_plan": "free",
     "entitlements": {"games_locked": []}}}
    """))
    await #expect(throws: ContactEmailError.notSignedIn) { try await service(transport).status() }
}
