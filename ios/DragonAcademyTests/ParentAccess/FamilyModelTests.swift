import API
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Store
import Testing
@testable import DragonAcademy

/// Answers each `METHOD /path` from a script (a queue per route, the last
/// entry repeating) and keeps what was sent.
private final class ScriptedTransport: ClientTransport, @unchecked Sendable {
    struct Reply: Sendable {
        var status: HTTPResponse.Status = .ok
        var json: String
    }

    private let lock = NSLock()
    private var replies: [String: [Reply]]
    private var sent: [(route: String, request: HTTPRequest, body: Data?)] = []

    init(_ replies: [String: [Reply]]) { self.replies = replies }

    var requests: [(route: String, request: HTTPRequest, body: Data?)] { lock.withLock { sent } }

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let data: Data? = if let body { try await Data(collecting: body, upTo: 1 << 20) } else { nil }
        let route = "\(request.method.rawValue) \(request.path ?? "")"
        let reply: Reply? = lock.withLock {
            sent.append((route, request, data))
            guard var queue = replies[route], !queue.isEmpty else { return nil }
            let next = queue.count > 1 ? queue.removeFirst() : queue[0]
            replies[route] = queue
            return next
        }
        guard let reply else { throw URLError(.cannotConnectToHost) }
        var response = HTTPResponse(status: reply.status)
        response.headerFields[.contentType] = "application/json; charset=utf-8"
        return (response, HTTPBody(reply.json))
    }
}

private let list = "GET /api/parent/children"
private let create = "POST /api/parent/children"

private func created(id: Int, name: String?) -> ScriptedTransport.Reply {
    let realName = name.map { "\"\($0)\"" } ?? "null"
    return .init(status: .created, json: """
        {"child": {"id": \(id), "username": null, "real_name": \(realName), "avatar": "⚔️",
          "current_node_id": 1, "needs_handle": true, "login_token": "0f8fad5b-d9cb-469f-a165-70867728950e"}}
        """)
}

private func linked(
    _ children: [(id: Int, username: String, realName: String?, needsHandle: Bool)], optedOut: Set<Int> = []
) -> ScriptedTransport.Reply {
    let rows = children.map { c in
        """
        {"id": \(c.id), "username": "\(c.username)", "real_name": \(c.realName.map { "\"\($0)\"" } ?? "null"),
         "avatar": "🐉", "current_node_id": 3, "created_at": "2026-09-01T10:00:00.123Z",
         "needs_handle": \(c.needsHandle), "login_token": null, "last_attempt_at": null,
         "minutes_today": 0, "minutes_7d": 12, "telemetry_opt_out": \(optedOut.contains(c.id))}
        """
    }
    return .init(json: #"{"children": [\#(rows.joined(separator: ","))]}"#)
}

private let freeLimit = ScriptedTransport.Reply(status: .init(code: 402), json: """
    {"error": "You've reached the 1-child limit on the Free plan. Upgrade to Premium to add more.",
     "code": "child_limit", "plan": "free", "limit": 1}
    """)

/// A clock that ticks a millisecond per read, so profiles sort by creation.
private final class Ticker: @unchecked Sendable {
    private let lock = NSLock()
    private var ms: Double = 1_800_000_000_000
    func now() -> Date { lock.withLock { ms += 1; return Date(timeIntervalSince1970: ms / 1000) } }
}

@MainActor
private struct Harness {
    let transport: ScriptedTransport
    let store: SQLiteStore
    let model: FamilyModel

    init(_ replies: [String: [ScriptedTransport.Reply]]) throws {
        transport = ScriptedTransport(replies)
        let ticker = Ticker()
        store = try SQLiteStore.inMemory(now: { ticker.now() })
        let api = DragonAPIClient(baseURL: URL(string: "http://localhost:3001")!, transport: transport) { "parent.jwt" }.api
        model = FamilyModel(store: store, service: APIFamilyService(api: api))
    }

    var storedChildren: [Profile] {
        get async throws { try await store.profiles().filter { $0.kind == .child } }
    }
}

@MainActor @Test func addingAChildCreatesItOnTheServerAndAsAStoreProfile() async throws {
    let h = try Harness([list: [linked([])], create: [created(id: 101, name: "Ada")]])
    await h.model.load()
    #expect(h.model.children.isEmpty)

    #expect(await h.model.addChild(name: "  Ada \n"))

    let sent = try #require(h.transport.requests.last)
    #expect(sent.route == create)
    #expect(sent.request.headerFields[.authorization] == "Bearer parent.jwt")
    let body = try JSONSerialization.jsonObject(with: try #require(sent.body)) as? [String: String]
    #expect(body == ["real_name": "Ada"])

    let child = try #require(try await h.storedChildren.first)
    #expect(child.remoteID == 101)
    #expect(child.avatar == "⚔️")
    // The parent's name for the child stays out of the shared device's Store.
    #expect(child.displayName == "New adventurer")
    #expect(h.model.children == [FamilyMember(profile: child, realName: "Ada")])
    #expect(h.model.children.map(\.parentFacingName) == ["Ada"])
    #expect(h.model.addNotice == nil)
}

@MainActor @Test func aBlankNameSendsNoneAndShowsAPlaceholder() async throws {
    let h = try Harness([create: [created(id: 102, name: nil)]])

    #expect(await h.model.addChild(name: "   "))

    let body = try JSONSerialization.jsonObject(with: try #require(h.transport.requests.last?.body)) as? [String: Any]
    #expect(body?.isEmpty == true)
    #expect(h.model.children.map(\.parentFacingName) == ["New adventurer"])
}

@MainActor @Test func thePlanLimitIsShownWithTheServersMessageAndNothingIsStored() async throws {
    let h = try Harness([create: [created(id: 101, name: "Ada"), freeLimit]])
    #expect(await h.model.addChild(name: "Ada"))

    #expect(await h.model.addChild(name: "Bea") == false)

    #expect(h.model.addNotice == .limitReached(
        message: "You've reached the 1-child limit on the Free plan. Upgrade to Premium to add more."))
    #expect(h.model.children.map(\.parentFacingName) == ["Ada"])
    #expect(try await h.storedChildren.map(\.remoteID) == [101])

    h.model.clearAddNotice()
    #expect(h.model.addNotice == nil)
}

@MainActor @Test(arguments: [
    (ScriptedTransport.Reply(status: .badRequest, json: #"{"error": "Name must be at most 80 characters."}"#),
     FamilyModel.Notice.invalid(message: "Name must be at most 80 characters.")),
    (.init(status: .unauthorized, json: #"{"error": "Invalid or expired token"}"#), .sessionExpired),
    (.init(status: .forbidden, json: #"{"error": "Parent account required"}"#), .unavailable),
    (.init(status: .tooManyRequests, json: #"{"error": "Too many new adventurers. Try again later."}"#), .rateLimited),
    (.init(status: .internalServerError, json: #"{"error": "boom"}"#), .unavailable),
])
private func createFailuresBecomeNotices(reply: ScriptedTransport.Reply, expected: FamilyModel.Notice) async throws {
    let h = try Harness([create: [reply]])
    #expect(await h.model.addChild(name: "Ada") == false)
    #expect(h.model.addNotice == expected)
    #expect(try await h.storedChildren.isEmpty)
}

@MainActor @Test func addingWithNoConnectionIsUnavailable() async throws {
    let h = try Harness([:])
    #expect(await h.model.addChild(name: "Ada") == false)
    #expect(h.model.addNotice == .unavailable)
}

@MainActor @Test func loadBringsInChildrenTheServerHasOnceEach() async throws {
    let h = try Harness([list: [linked([
        (id: 101, username: "sparky", realName: "Ada", needsHandle: false),
        (id: 102, username: "ember", realName: nil, needsHandle: false),
        (id: 103, username: "7c9e6679-7425-40de-944b-e07fc1f90ae7", realName: nil, needsHandle: true),
    ])]])

    await h.model.load()
    await h.model.load()

    #expect(h.model.children.map(\.profile.remoteID) == [101, 102, 103])
    // Handle placeholders (the login token) are never shown.
    #expect(h.model.children.map(\.parentFacingName) == ["Ada", "ember", "New adventurer"])
    // The Store (what siblings see on the picker) has handles only.
    #expect(try await h.storedChildren.map(\.displayName) == ["sparky", "ember", "New adventurer"])
    #expect(try await h.storedChildren.map(\.avatar) == ["🐉", "🐉", "🐉"])
    #expect(h.model.loadNotice == nil)
}

@MainActor @Test func loadUpdatesAHandleOrAvatarChangedElsewhereKeepingTheProfile() async throws {
    let h = try Harness([list: [
        linked([(id: 101, username: "7c9e6679-7425-40de-944b-e07fc1f90ae7", realName: "Ada", needsHandle: true)]),
        linked([(id: 101, username: "sparky", realName: "Ada", needsHandle: false)]),
    ]])
    await h.model.load()
    let before = try #require(try await h.storedChildren.first)
    #expect(before.displayName == "New adventurer")

    await h.model.load()

    let after = try #require(try await h.storedChildren.first)
    #expect(after.id == before.id)
    #expect(after.displayName == "sparky")
    #expect(h.model.children.map(\.parentFacingName) == ["Ada"])
}

@MainActor @Test func loadStillShowsTheDevicesChildrenWhenOffline() async throws {
    let h = try Harness([create: [created(id: 101, name: "Ada")]])
    #expect(await h.model.addChild(name: "Ada"))

    await h.model.load()

    #expect(h.model.children.map(\.parentFacingName) == ["Ada"])
    #expect(h.model.loadNotice == .unavailable)
}

private let telemetry101 = "PUT /api/parent/children/101/telemetry"

@MainActor @Test func loadTakesEachChildsTelemetrySettingFromTheServer() async throws {
    let children = [
        (id: 101, username: "sparky", realName: "Ada", needsHandle: false),
        (id: 102, username: "ember", realName: nil, needsHandle: false),
    ]
    let h = try Harness([list: [linked(children, optedOut: [101]), linked(children)]])

    await h.model.load()
    #expect(h.model.children.map(\.profile.telemetryOptOut) == [true, false])
    #expect(try await h.storedChildren.map(\.telemetryOptOut) == [true, false])

    // Turned back on elsewhere.
    await h.model.load()
    #expect(h.model.children.map(\.profile.telemetryOptOut) == [false, false])
}

@MainActor @Test func turningTelemetryOffSavesItOnTheServerThenOnTheDevice() async throws {
    let h = try Harness([
        list: [linked([(id: 101, username: "sparky", realName: "Ada", needsHandle: false)])],
        telemetry101: [.init(json: #"{"id": 101, "telemetry_opt_out": true}"#)],
    ])
    await h.model.load()
    let ada = try #require(h.model.children.first).profile

    #expect(await h.model.setTelemetryOptOut(true, for: ada))

    let sent = try #require(h.transport.requests.last)
    #expect(sent.route == telemetry101)
    #expect(sent.request.headerFields[.authorization] == "Bearer parent.jwt")
    let body = try JSONSerialization.jsonObject(with: try #require(sent.body)) as? [String: Bool]
    #expect(body == ["telemetry_opt_out": true])
    #expect(h.model.children.first?.profile.telemetryOptOut == true)
    #expect(try await h.storedChildren.first?.telemetryOptOut == true)
    #expect(h.model.telemetryNotice == nil)
    #expect(h.model.savingTelemetry.isEmpty)
}

@MainActor @Test func aFailedTelemetryChangeLeavesTheDeviceAsItWas() async throws {
    let h = try Harness([
        list: [linked([(id: 101, username: "sparky", realName: "Ada", needsHandle: false)])],
        telemetry101: [.init(status: .unauthorized, json: #"{"error": "Invalid or expired token"}"#)],
    ])
    await h.model.load()
    let ada = try #require(h.model.children.first).profile

    #expect(await h.model.setTelemetryOptOut(true, for: ada) == false)

    #expect(h.model.telemetryNotice?.childID == 101)
    #expect(h.model.telemetryNotice?.notice == .sessionExpired)
    #expect(try await h.storedChildren.first?.telemetryOptOut == false)
}

@Test func theFakeFamilyStopsAtItsLimit() async throws {
    let fake = FakeFamilyService(limit: 1)
    _ = try await fake.createChild(name: "Ada")
    await #expect(throws: FamilyError.self) { try await fake.createChild(name: "Bea") }
    #expect(try await fake.children().map(\.realName) == ["Ada"])
}
