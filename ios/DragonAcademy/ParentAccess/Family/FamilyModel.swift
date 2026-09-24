import Foundation
import OSLog
import Store

/// The parent view's list of children and its "Add a child" action. The
/// server is the source of truth for who is in the family and enforces the
/// plan's child limit; each child it knows about is also a `.child` profile in
/// the local `Store` (keyed by the server id), which is what the family picker
/// shows.
@MainActor
@Observable
final class FamilyModel {
    enum Notice: Equatable {
        /// At the plan's child limit; `message` is the server's, for parents.
        case limitReached(message: String)
        case invalid(message: String)
        case sessionExpired
        case rateLimited
        /// Couldn't reach the server (or it failed).
        case unavailable
        /// The server has the child but this device couldn't save it; the next
        /// `load()` tries again.
        case notSavedOnDevice
    }

    /// The `.child` profiles on this device, oldest first.
    private(set) var children: [Profile] = []
    private(set) var isLoading = false
    private(set) var isAdding = false
    /// From the last `load()`.
    private(set) var loadNotice: Notice?
    /// From the last `addChild(name:)`; cleared by `clearAddNotice()`.
    private(set) var addNotice: Notice?
    /// Server ids of children whose telemetry setting is being saved.
    private(set) var savingTelemetry: Set<Int> = []
    /// From the last `setTelemetryOptOut(_:for:)` that failed, by server id.
    private(set) var telemetryNotice: (childID: Int, notice: Notice)?

    private let store: any Store
    private let service: any FamilyService
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Family")

    init(store: any Store, service: any FamilyService) {
        self.store = store
        self.service = service
    }

    /// Shows the device's children, then brings in any the server has that
    /// this device doesn't (e.g. added on the web or another device).
    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        await refreshFromStore()
        do {
            let remote = try await service.children()
            for child in remote {
                guard let profile = try? await store.addChildProfile(remoteID: child.id, displayName: displayName(child.name))
                else { continue }
                // The server's setting wins: it may have changed on the web or another device.
                if profile.telemetryOptOut != child.telemetryOptOut {
                    try? await store.setTelemetryOptOut(child.telemetryOptOut, for: profile.id)
                }
            }
            loadNotice = nil
        } catch {
            loadNotice = Self.notice(for: error)
        }
        await refreshFromStore()
    }

    /// Creates the child on the server, then adds them to this device.
    /// Returns true once the server has created them.
    @discardableResult
    func addChild(name: String) async -> Bool {
        guard !isAdding else { return false }
        isAdding = true
        defer { isAdding = false }
        addNotice = nil
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let child: RemoteChild
        do {
            child = try await service.createChild(name: trimmed.isEmpty ? nil : trimmed)
        } catch {
            addNotice = Self.notice(for: error)
            return false
        }
        do {
            _ = try await store.addChildProfile(remoteID: child.id, displayName: displayName(child.name))
        } catch {
            log.error("Couldn't save the new child profile: \(error)")
            addNotice = .notSavedOnDevice
        }
        await refreshFromStore()
        return true
    }

    /// Turns a child's telemetry off or on: on the server first, then on this
    /// device, which is what Sync reads. Returns true once the server has it.
    @discardableResult
    func setTelemetryOptOut(_ optOut: Bool, for child: Profile) async -> Bool {
        guard let childID = child.remoteID, !savingTelemetry.contains(childID) else { return false }
        savingTelemetry.insert(childID)
        defer { savingTelemetry.remove(childID) }
        telemetryNotice = nil
        let saved: Bool
        do {
            saved = try await service.setTelemetryOptOut(optOut, childID: childID)
        } catch {
            telemetryNotice = (childID, Self.notice(for: error))
            return false
        }
        do {
            try await store.setTelemetryOptOut(saved, for: child.id)
        } catch {
            log.error("Couldn't save the telemetry setting: \(error)")
            telemetryNotice = (childID, .notSavedOnDevice)
        }
        await refreshFromStore()
        return true
    }

    func clearAddNotice() {
        addNotice = nil
    }

    private func refreshFromStore() async {
        do {
            children = try await store.profiles().filter { $0.kind == .child }
        } catch {
            log.error("Couldn't read profiles: \(error)")
        }
    }

    private func displayName(_ name: String?) -> String {
        if let name, !name.isEmpty { return name }
        return String(localized: "New adventurer", comment: "Name shown for a child who has no name yet")
    }

    private static func notice(for error: FamilyError) -> Notice {
        switch error {
        case .limitReached(let message, _): .limitReached(message: message)
        case .invalid(let message): .invalid(message: message)
        case .sessionExpired: .sessionExpired
        case .rateLimited: .rateLimited
        case .unavailable: .unavailable
        }
    }
}
