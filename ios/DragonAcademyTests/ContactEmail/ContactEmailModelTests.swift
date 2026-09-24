import API
import Foundation
import HTTPTypes
import Testing
@testable import DragonAcademy

// The view model against the real APIContactEmailService over a scripted
// transport, so each test also pins which requests the flow makes.

private let relay = "x@privaterelay.appleid.com"

private func sentJSON(_ contact: String, verified: Bool, sent: Bool, email: String? = relay) -> String {
    #"{"user": \#(contactAdultJSON(email: email, contact: contact, verified: verified)), "verification_sent": \#(sent)}"#
}

private func meJSON(email: String? = relay, contact: String?, verified: Bool) -> String {
    #"{"user": \#(contactAdultJSON(email: email, contact: contact, verified: verified))}"#
}

@MainActor
private func model(_ transport: ContactEmailTransport, _ context: ContactEmailModel.Context = .firstSignIn) -> ContactEmailModel {
    let api = DragonAPIClient(baseURL: URL(string: "http://localhost:3001")!, transport: transport) { "jwt" }.api
    return ContactEmailModel(service: APIContactEmailService(api: api), context: context)
}

@MainActor @Test func aRelaySignInStartsWithAnEmptyField() async {
    let m = model(ContactEmailTransport((.ok, meJSON(contact: nil, verified: false))))
    await m.load()
    #expect(m.phase == .editing)
    #expect(m.email == "")
    #expect(!m.canSubmit)
}

@MainActor @Test func aRealAppleEmailIsPrefilled() async {
    let m = model(ContactEmailTransport((.ok, meJSON(email: "dad@icloud.com", contact: "dad@icloud.com", verified: true))))
    await m.load()
    // After first sign-in the question is asked even when Apple's address is on file.
    #expect(m.phase == .editing)
    #expect(m.email == "dad@icloud.com")
}

@MainActor @Test func confirmingTheAlreadyVerifiedAppleEmailFinishesAtOnce() async throws {
    let transport = ContactEmailTransport(
        (.ok, meJSON(email: "dad@icloud.com", contact: "dad@icloud.com", verified: true)),
        (.ok, sentJSON("dad@icloud.com", verified: true, sent: false, email: "dad@icloud.com")))
    let m = model(transport)
    await m.load()
    await m.submit()
    #expect(m.phase == .verified("dad@icloud.com"))
    #expect(transport.requests.map(\.request.path) == ["/api/auth/me", "/api/auth/contact-email"])
}

@MainActor @Test func aNewAddressWaitsForTheLinkThenVerifies() async throws {
    let transport = ContactEmailTransport(
        (.ok, meJSON(contact: nil, verified: false)),
        (.ok, sentJSON("mum@example.com", verified: false, sent: true)),
        (.ok, meJSON(contact: "mum@example.com", verified: false)),   // not tapped yet
        (.ok, meJSON(contact: "mum@example.com", verified: true)))
    let m = model(transport)
    await m.load()
    m.email = "  Mum@Example.com "
    await m.submit()
    #expect(m.phase == .awaitingVerification("mum@example.com"))
    let put = try #require(transport.requests.last?.body)
    #expect(try JSONSerialization.jsonObject(with: put) as? [String: String] == ["email": "mum@example.com"])

    await m.checkVerification()
    #expect(m.phase == .awaitingVerification("mum@example.com"))
    #expect(m.notice == .notYetVerified)

    await m.checkVerification()
    #expect(m.phase == .verified("mum@example.com"))
    #expect(m.notice == nil)
}

@MainActor @Test func relayAndMalformedAddressesNeverReachTheServer() async {
    let transport = ContactEmailTransport((.ok, meJSON(contact: nil, verified: false)))
    let m = model(transport)
    await m.load()
    m.email = relay.uppercased()
    await m.submit()
    #expect(m.notice == .relayAddress)
    m.email = "not an email"
    await m.submit()
    #expect(m.notice == .invalidEmail)
    #expect(m.phase == .editing)
    #expect(transport.requests.count == 1)
}

@MainActor @Test func settingsShowsWhatIsOnFileAndChangingNeedsReverifying() async throws {
    let transport = ContactEmailTransport(
        (.ok, meJSON(contact: "old@example.com", verified: true)),
        (.ok, sentJSON("new@example.com", verified: false, sent: true)),
        (.ok, sentJSON("new@example.com", verified: false, sent: true)),
        (.ok, meJSON(contact: "new@example.com", verified: true)))
    let m = model(transport, .settings)
    await m.load()
    #expect(m.phase == .verified("old@example.com"))

    m.changeAddress()
    #expect(m.phase == .editing)
    #expect(m.email == "old@example.com")
    m.email = "new@example.com"
    await m.submit()
    #expect(m.phase == .awaitingVerification("new@example.com"))

    await m.resend()
    #expect(m.notice == .resent)
    #expect(transport.requests[2].request.path == "/api/auth/contact-email/resend")

    await m.checkVerification()
    #expect(m.phase == .verified("new@example.com"))
}

@MainActor @Test func settingsWithAnUnconfirmedAddressOffersTheLinkAgain() async {
    let m = model(ContactEmailTransport((.ok, meJSON(contact: "mum@example.com", verified: false))), .settings)
    await m.load()
    #expect(m.phase == .awaitingVerification("mum@example.com"))
}

@MainActor @Test func aFailedSendKeepsTheAddressAndOffersResend() async {
    let transport = ContactEmailTransport(
        (.ok, meJSON(contact: nil, verified: false)),
        (.badGateway, #"{"error": "down"}"#))
    let m = model(transport)
    await m.load()
    m.email = "mum@example.com"
    await m.submit()
    #expect(m.phase == .awaitingVerification("mum@example.com"))
    #expect(m.notice == .sendFailed)
}

@MainActor @Test func serverRefusalsAndOutagesAreShownInPlace() async {
    let transport = ContactEmailTransport(
        (.ok, meJSON(contact: nil, verified: false)),
        (.badRequest, #"{"error": "Please enter a valid email address."}"#),
        (.tooManyRequests, #"{"error": "slow down"}"#))
    let m = model(transport)
    await m.load()
    m.email = "mum@example.com"
    await m.submit()
    #expect(m.notice == .rejected("Please enter a valid email address."))
    await m.submit()
    #expect(m.notice == .rateLimited)
    #expect(m.phase == .editing)
}

@MainActor @Test func anUnreachableServerStillShowsTheField() async {
    let m = model(ContactEmailTransport((.internalServerError, #"{"error": "boom"}"#)))
    await m.load()
    #expect(m.phase == .editing)
    #expect(m.notice == .unavailable)
}

@Test func suggestionSkipsRelayAddresses() {
    #expect(ContactEmailRules.suggestion(for: .init(loginEmail: relay, contactEmail: nil, isVerified: false)) == "")
    #expect(ContactEmailRules.suggestion(for: .init(loginEmail: "a@b.co", contactEmail: nil, isVerified: false)) == "a@b.co")
    #expect(ContactEmailRules.suggestion(for: .init(loginEmail: "a@b.co", contactEmail: "c@d.co", isVerified: false)) == "c@d.co")
    #expect(ContactEmailRules.suggestion(for: .init(loginEmail: nil, contactEmail: nil, isVerified: false)) == "")
}

@Test(arguments: ["a@b.co", "first.last@example.co.uk"])
func plausibleEmails(_ email: String) { #expect(ContactEmailRules.isPlausible(email)) }

@Test(arguments: ["", "a", "a@b", "@b.co", "a b@c.co", "a@b..co", "a@@b.co"])
func implausibleEmails(_ email: String) { #expect(!ContactEmailRules.isPlausible(email)) }
