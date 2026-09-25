import Foundation
import OSLog
import Store
import SwiftUI

/// Who is playing right now: the app state every kid screen (map, battle,
/// proving grounds, …) records events and reads progress for, via
/// `@Environment(\.currentProfile)`. Never assume the guest.
///
/// With no parent signed in the device is in guest mode and the guest profile
/// plays. With a parent signed in it's a family device: the kid screens start
/// at the family picker, and a kid taps their avatar to play as themselves or
/// to switch to a sibling. Switching is local, needs no parental gate and
/// never touches the session token: Sync uploads every kid's queue with the
/// parent's session (see `SessionTokens`).
@MainActor
@Observable
final class CurrentPlayer {
    enum Mode: Equatable {
        /// No parent signed in: offline play as the device's guest.
        case guest
        /// A parent is signed in: kids pick themselves on the family picker.
        case family
    }

    /// A kid on the family picker.
    struct Kid: Identifiable, Equatable {
        let profile: Profile
        /// The kid-facing name: their handle, numbered when two share one
        /// (two new kids are both "New adventurer" until they pick handles).
        let label: String
        var id: Profile.ID { profile.id }
    }

    private(set) var mode: Mode
    /// The device's child profiles, oldest first.
    private(set) var kids: [Kid] = []
    /// Whether the kid list has been read from the Store at least once.
    private(set) var hasLoaded = false
    /// The kid playing now in family mode; nil at the picker.
    private(set) var chosen: Profile?

    private let store: any Store
    private let family: any FamilyService
    /// Bumped by each refresh, so an older one finishing late can't put back
    /// a stale list.
    private var generation = 0
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Player")

    init(store: any Store, family: any FamilyService, parentSignedIn: Bool) {
        self.store = store
        self.family = family
        mode = parentSignedIn ? .family : .guest
    }

    /// The profile kid screens play as; nil only at the family picker.
    var profile: Profile? {
        switch mode {
        case .guest: store.guestProfile
        case .family: chosen
        }
    }

    /// Whether the family picker is showing.
    var isPicking: Bool { profile == nil }

    /// Plays as `kid` (from the picker, or to switch to a sibling).
    func choose(_ kid: Profile) {
        guard mode == .family, kid.kind == .child else { return }
        chosen = kid
    }

    /// Back to the family picker, so a sibling can take a turn.
    func switchKid() {
        chosen = nil
    }

    /// The parent signed in or out (or their session expired). Signing in
    /// opens the family picker; signing out returns to guest play.
    func parentSessionChanged(signedIn: Bool) async {
        let mode: Mode = signedIn ? .family : .guest
        guard mode != self.mode else { return }
        self.mode = mode
        chosen = nil
        await refresh()
    }

    /// Reads the device's kids, then, in family mode, brings in any the
    /// server has (new siblings, changed handles or avatars) with the
    /// parent's session. Offline, the device's list stands.
    func refresh() async {
        generation += 1
        let generation = generation
        await readStore(generation)
        guard mode == .family else { return }
        do {
            for child in try await family.children() {
                try? await FamilyModel.save(child, in: store)
            }
        } catch {
            log.info("Couldn't refresh the family: \(String(describing: error), privacy: .public)")
            return
        }
        await readStore(generation)
    }

    private func readStore(_ generation: Int) async {
        do {
            let children = try await store.profiles().filter { $0.kind == .child }
            guard generation == self.generation else { return }
            kids = zip(children, Self.labels(for: children)).map { Kid(profile: $0, label: $1) }
            // Keep the chosen kid's latest name/avatar; drop them if gone.
            chosen = chosen.flatMap { current in children.first { $0.id == current.id } }
        } catch {
            log.error("Couldn't read profiles: \(error)")
        }
        hasLoaded = true
    }

    /// Each profile's display name, with " 1", " 2", … added in order where
    /// several share one, so siblings can tell their tiles apart.
    static func labels(for profiles: [Profile]) -> [String] {
        let counts = Dictionary(profiles.map { ($0.displayName, 1) }, uniquingKeysWith: +)
        var seen: [String: Int] = [:]
        return profiles.map { profile in
            let name = profile.displayName
            guard counts[name, default: 0] > 1 else { return name }
            seen[name, default: 0] += 1
            return "\(name) \(seen[name]!)"
        }
    }
}

extension EnvironmentValues {
    /// Who is playing; set by the app. Nil in previews that don't set one.
    @Entry var player: CurrentPlayer? = nil

    /// The profile the kid screens below the family picker play as: record
    /// events for it and read its progress. Nil only in previews.
    @Entry var currentProfile: Profile? = nil
}
