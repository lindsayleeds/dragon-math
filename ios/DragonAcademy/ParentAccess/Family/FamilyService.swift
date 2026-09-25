import API
import Foundation
import GameRules
import SwiftUI

/// A child account on the server.
struct RemoteChild: Equatable, Sendable {
    let id: Int
    /// The kid's own handle, which kids see (the family picker); nil until
    /// they pick one.
    let username: String?
    /// The name the parent entered. Adult-facing: shown only in the parent
    /// view and never saved on the device, where siblings would see it.
    let realName: String?
    /// Usually an emoji, or an image path starting with "/".
    let avatar: String?
    /// The parent turned this child's telemetry off (progress still syncs).
    var telemetryOptOut = false
    /// How fast battles and Munchers run for this child (the parent's setting).
    var gamePace: GamePace = .normal

    init(
        id: Int, username: String?, realName: String?, avatar: String? = nil, telemetryOptOut: Bool = false,
        gamePace: GamePace = .normal
    ) {
        self.id = id
        self.username = username
        self.realName = realName
        self.avatar = avatar
        self.telemetryOptOut = telemetryOptOut
        self.gamePace = gamePace
    }
}

enum FamilyError: Error, Equatable {
    /// 402: at the plan's child limit. `message` is the server's, written for
    /// parents ("You've reached the 1-child limit on the Free plan…").
    case limitReached(message: String, limit: Int?)
    /// 400, with the server's message (e.g. the name is too long).
    case invalid(message: String)
    /// 401: the parent session is no longer accepted.
    case sessionExpired
    /// 429.
    case rateLimited
    /// No connection, a 5xx, a 403, or anything the contract doesn't describe.
    case unavailable
}

/// The parent's children on the server (`/api/parent/children`).
protocol FamilyService: Sendable {
    func children() async throws(FamilyError) -> [RemoteChild]
    func createChild(name: String?) async throws(FamilyError) -> RemoteChild
    /// Turns the child's telemetry off (`true`) or on; returns the setting now
    /// in effect.
    func setTelemetryOptOut(_ optOut: Bool, childID: Int) async throws(FamilyError) -> Bool
    /// Sets the child's game pace; returns the pace now in effect.
    func setGamePace(_ pace: GamePace, childID: Int) async throws(FamilyError) -> GamePace
}

/// Through the generated client, with the parent session's token.
struct APIFamilyService: FamilyService {
    let api: any APIProtocol

    func children() async throws(FamilyError) -> [RemoteChild] {
        let output: Operations.ListChildren.Output
        do {
            output = try await api.listChildren()
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let body = try? ok.body.json else { throw .unavailable }
            return body.children.map { child in
                // While needs_handle is set, username is a placeholder (the
                // login token), never a name.
                RemoteChild(
                    id: child.id, username: child.needsHandle ? nil : child.username, realName: child.realName,
                    avatar: child.avatar, telemetryOptOut: child.telemetryOptOut,
                    gamePace: GamePace(normalizing: child.gamePace.rawValue))
            }
        case .unauthorized:
            throw .sessionExpired
        case .forbidden, .undocumented:
            throw .unavailable
        }
    }

    func createChild(name: String?) async throws(FamilyError) -> RemoteChild {
        let output: Operations.CreateChild.Output
        do {
            output = try await api.createChild(body: .json(.init(realName: name)))
        } catch {
            throw .unavailable
        }
        switch output {
        case .created(let created):
            guard let child = try? created.body.json.child else { throw .unavailable }
            return RemoteChild(
                id: child.id, username: child.needsHandle ? nil : child.username, realName: child.realName,
                avatar: child.avatar)
        case .code402(let limited):
            guard let body = try? limited.body.json else { throw .unavailable }
            throw .limitReached(message: body.error, limit: body.limit)
        case .badRequest(let bad):
            throw .invalid(message: (try? bad.body.json.error) ?? "")
        case .unauthorized:
            throw .sessionExpired
        case .tooManyRequests:
            throw .rateLimited
        case .forbidden, .undocumented:
            throw .unavailable
        }
    }
}

extension APIFamilyService {
    func setTelemetryOptOut(_ optOut: Bool, childID: Int) async throws(FamilyError) -> Bool {
        let output: Operations.SetChildTelemetry.Output
        do {
            output = try await api.setChildTelemetry(
                path: .init(childId: String(childID)), body: .json(.init(telemetryOptOut: optOut)))
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let body = try? ok.body.json else { throw .unavailable }
            return body.telemetryOptOut
        case .badRequest(let bad):
            throw .invalid(message: (try? bad.body.json.error) ?? "")
        case .unauthorized:
            throw .sessionExpired
        case .forbidden, .undocumented:
            throw .unavailable
        }
    }
}

extension APIFamilyService {
    func setGamePace(_ pace: GamePace, childID: Int) async throws(FamilyError) -> GamePace {
        guard let wire = Components.Schemas.ChildPaceRequest.GamePacePayload(rawValue: pace.rawValue) else {
            throw .unavailable
        }
        let output: Operations.SetChildPace.Output
        do {
            output = try await api.setChildPace(path: .init(childId: String(childID)), body: .json(.init(gamePace: wire)))
        } catch {
            throw .unavailable
        }
        switch output {
        case .ok(let ok):
            guard let body = try? ok.body.json else { throw .unavailable }
            return GamePace(normalizing: body.gamePace.rawValue)
        case .badRequest(let bad):
            throw .invalid(message: (try? bad.body.json.error) ?? "")
        case .unauthorized:
            throw .sessionExpired
        case .forbidden, .undocumented:
            throw .unavailable
        }
    }
}

/// A family kept in memory, free plan by default: one child, then the limit.
/// Previews use it, and so does the app with `-ParentAccessFakes YES`.
final class FakeFamilyService: FamilyService, @unchecked Sendable {
    private let lock = NSLock()
    private var family: [RemoteChild] = []
    private let limit: Int

    /// The one `\.family` falls back to, so a preview keeps what it added.
    static let shared = FakeFamilyService()

    init(limit: Int = 1) { self.limit = limit }

    func children() async throws(FamilyError) -> [RemoteChild] {
        lock.withLock { family }
    }

    func createChild(name: String?) async throws(FamilyError) -> RemoteChild {
        let child: RemoteChild? = lock.withLock {
            guard family.count < limit else { return nil }
            // Like the server: a new kid has no handle yet.
            let child = RemoteChild(id: 1000 + family.count, username: nil, realName: name, avatar: "⚔️")
            family.append(child)
            return child
        }
        guard let child else {
            throw .limitReached(
                message: "You've reached the 1-child limit on the Free plan. Upgrade to Premium to add more.",
                limit: limit)
        }
        return child
    }

    func setTelemetryOptOut(_ optOut: Bool, childID: Int) async throws(FamilyError) -> Bool {
        lock.withLock {
            if let index = family.firstIndex(where: { $0.id == childID }) { family[index].telemetryOptOut = optOut }
        }
        return optOut
    }

    func setGamePace(_ pace: GamePace, childID: Int) async throws(FamilyError) -> GamePace {
        lock.withLock {
            if let index = family.firstIndex(where: { $0.id == childID }) { family[index].gamePace = pace }
        }
        return pace
    }
}

extension EnvironmentValues {
    /// The parent's children on the server; a fake by default, so previews
    /// never reach the server. The app sets the live one.
    @Entry var family: any FamilyService = FakeFamilyService.shared
}
