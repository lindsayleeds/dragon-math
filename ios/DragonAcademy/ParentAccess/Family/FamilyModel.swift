import Foundation
import OSLog
import Store

/// A child as the parent view lists them.
struct FamilyMember: Identifiable, Equatable {
    /// The device's profile: the kid-facing name and avatar.
    let profile: Profile
    /// The name the parent entered, from the server; only in memory, for the
    /// parent view. Nil offline or when the parent gave none.
    let realName: String?

    var id: Profile.ID { profile.id }
    /// What the parent sees first: their own name for the child if they gave
    /// one, else the kid's handle.
    var parentFacingName: String { realName ?? profile.displayName }
}

/// The parent view's list of children and its "Add a child" action. The
/// server is the source of truth for who is in the family and enforces the
/// plan's child limit; each child it knows about is also a `.child` profile in
/// the local `Store` (keyed by the server id), which is what the family picker
/// shows. The Store gets only kid-facing fields (handle, avatar): siblings
/// share the device, so the parent-entered real name stays in this model.
///
/// When the parent adds the device's first child and a guest has been
/// playing, the parent is offered the guest's play for that child
/// (``guestProgressOffer``, issue #127). Only if they agree does it move to the
/// child and upload (ADR 0003); otherwise it stays on the device as the guest's.
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
        /// The parent agreed to move the guest's play to the new child, but
        /// the device couldn't; it's still the guest's.
        case guestProgressNotMoved
    }

    /// The `.child` profiles on this device, oldest first.
    private(set) var children: [FamilyMember] = []
    private(set) var isLoading = false
    private(set) var isAdding = false
    /// From the last `load()`.
    private(set) var loadNotice: Notice?
    /// From the last `addChild(name:)`; cleared by `clearAddNotice()`.
    private(set) var addNotice: Notice?
    /// The child just added, when they are the device's first and the guest
    /// has play still on the device: the parent is asked whether it moves to
    /// them. Answered with `answerGuestProgressOffer(move:)`.
    private(set) var guestProgressOffer: FamilyMember?
    /// Server ids of children whose telemetry setting is being saved.
    private(set) var savingTelemetry: Set<Int> = []
    /// From the last `setTelemetryOptOut(_:for:)` that failed, by server id.
    private(set) var telemetryNotice: (childID: Int, notice: Notice)?

    private let store: any Store
    private let service: any FamilyService
    /// Asks Sync to upload, without waiting (`SyncEngine.requestSync()`).
    private let requestSync: @MainActor () -> Void
    private var realNames: [Int: String] = [:]
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Family")

    init(store: any Store, service: any FamilyService, requestSync: @escaping @MainActor () -> Void = {}) {
        self.store = store
        self.service = service
        self.requestSync = requestSync
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
                remember(child)
                guard let profile = try? await Self.save(child, in: store) else { continue }
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
        guestProgressOffer = nil
        // Whether this device had no children yet; an unreadable store never offers.
        let isFirstChild = (try? await store.profiles().allSatisfy { $0.kind != .child }) ?? false
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let child: RemoteChild
        do {
            child = try await service.createChild(name: trimmed.isEmpty ? nil : trimmed)
        } catch {
            addNotice = Self.notice(for: error)
            return false
        }
        remember(child)
        do {
            let profile = try await Self.save(child, in: store)
            if isFirstChild, await guestHasPlay() {
                guestProgressOffer = FamilyMember(profile: profile, realName: realNames[child.id])
            }
        } catch {
            log.error("Couldn't save the new child profile: \(error)")
            addNotice = .notSavedOnDevice
        }
        await refreshFromStore()
        return true
    }

    /// The parent's answer to ``guestProgressOffer``. Yes moves every guest
    /// event still on the device to the new child, in one transaction, and
    /// asks Sync to upload them with the parent's session; the guest starts
    /// fresh. No leaves them with the guest, never uploaded. Returns false if
    /// the move failed (``Notice/guestProgressNotMoved``).
    @discardableResult
    func answerGuestProgressOffer(move: Bool) async -> Bool {
        guard let offer = guestProgressOffer else { return true }
        guestProgressOffer = nil
        guard move else { return true }
        do {
            let moved = try await store.moveGuestEvents(to: offer.profile.id)
            log.info("Moved \(moved) guest events to the new child")
        } catch {
            log.error("Couldn't move the guest's events: \(error)")
            addNotice = .guestProgressNotMoved
            return false
        }
        requestSync()
        return true
    }

    /// Whether the guest has play on the device that hasn't gone anywhere.
    private func guestHasPlay() async -> Bool {
        let events = (try? await store.events(for: store.guestProfile.id)) ?? []
        return events.contains { $0.uploadState == .pending }
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

    /// Saves the kid-facing half of a server child as its device profile.
    @discardableResult
    static func save(_ child: RemoteChild, in store: any Store) async throws -> Profile {
        try await store.saveChildProfile(
            remoteID: child.id, displayName: kidFacingName(child.username), avatar: child.avatar)
    }

    /// The kid's handle, or a placeholder until they pick one. Never the
    /// parent-entered name.
    static func kidFacingName(_ username: String?) -> String {
        if let username, !username.isEmpty { return username }
        return String(localized: "New adventurer", comment: "Name shown for a child who has not picked a handle yet")
    }

    private func remember(_ child: RemoteChild) {
        realNames[child.id] = child.realName.flatMap { $0.isEmpty ? nil : $0 }
    }

    private func refreshFromStore() async {
        do {
            children = try await store.profiles().filter { $0.kind == .child }.map { profile in
                FamilyMember(profile: profile, realName: profile.remoteID.flatMap { realNames[$0] })
            }
        } catch {
            log.error("Couldn't read profiles: \(error)")
        }
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
