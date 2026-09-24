import API
import Foundation
import SwiftUI

/// A child account on the server, as the parent view needs it.
struct RemoteChild: Equatable, Sendable {
    let id: Int
    /// What to call the child on this device: the name the parent gave, else
    /// their handle, else nil while they have neither.
    let name: String?
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
                RemoteChild(id: child.id, name: child.realName ?? (child.needsHandle ? nil : child.username))
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
            return RemoteChild(id: child.id, name: child.realName ?? child.username)
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
            let child = RemoteChild(id: 1000 + family.count, name: name)
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
}

extension EnvironmentValues {
    /// The parent's children on the server; a fake by default, so previews
    /// never reach the server. The app sets the live one.
    @Entry var family: any FamilyService = FakeFamilyService.shared
}
