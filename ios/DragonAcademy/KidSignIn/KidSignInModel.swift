import Foundation
import OSLog
import Store
import SwiftUI

/// Kid sign-in by link or QR code (#132). A kid's login link `/k/<token>` or
/// a family-device link `/family/<token>` reaches the app as a universal link
/// (`open(_:)`), or from the in-app scanner (`scan()` → `scanned(_:)`) on a
/// classroom iPad. Either way the kid ends up playing as themselves:
///
/// - **No parent signed in** (guest or kid mode): the kid's own session is
///   saved in the Keychain and handed to `SessionTokens`, their kid-facing
///   profile saved in the Store, and `CurrentPlayer` switches to them. One kid
///   session at a time: the next kid's code replaces it. Sync then uploads
///   only that kid's queue; others' events wait on the device until their own
///   session (or their parent's) is back.
/// - **A parent signed in** (family mode): the parent's session already
///   uploads for every child in the family, so the kid's token is not kept.
///   A kid in this family is simply picked; anyone else is turned away, since
///   the parent's session couldn't upload their events.
///
/// A family link first lists that family's kids (`choosing`), and the kid
/// taps themselves.
@MainActor
@Observable
final class KidSignInModel {
    enum Phase: Equatable {
        /// Nothing showing.
        case closed
        /// The QR scanner is up.
        case scanning
        /// Talking to the server.
        case working
        /// A family link's kids, to pick from.
        case choosing(familyToken: String, kids: [RemoteChild])
        /// It didn't work; `notice` says why.
        case failed
    }

    enum Notice: Equatable {
        /// The scanner saw a code that isn't a Dragon Math link.
        case notACode
        case brokenLink
        /// The server's message: the link was revoked or never existed.
        case notFound(message: String)
        /// A grown-up's link.
        case notAKid
        /// A parent is signed in, and this kid isn't in their family.
        case notInFamily
        case rateLimited
        case unavailable
        /// The session came, but this device couldn't keep it.
        case notSaved
    }

    private(set) var phase: Phase = .closed
    private(set) var notice: Notice?

    /// Whether the sign-in sheet is up.
    var isPresented: Bool {
        get { phase != .closed }
        set { if !newValue { close() } }
    }

    private let service: any KidSignInService
    private let sessions: any KidSessionStore
    private let store: any Store
    private let player: CurrentPlayer
    /// Hands the new kid session's token to `SessionTokens` (nil: signed out).
    private let sessionChanged: @Sendable (String?) async -> Void
    /// The link being signed in with, so a universal link that arrives twice
    /// (as a URL and as a user activity) signs in once.
    private var handling: KidLink?
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "KidSignIn")

    init(
        service: any KidSignInService,
        sessions: any KidSessionStore,
        store: any Store,
        player: CurrentPlayer,
        sessionChanged: @escaping @Sendable (String?) async -> Void
    ) {
        self.service = service
        self.sessions = sessions
        self.store = store
        self.player = player
        self.sessionChanged = sessionChanged
    }

    /// The kid session kept from last launch, if it hasn't expired; an
    /// expired or unreadable one is removed.
    nonisolated static func storedSession(in sessions: some KidSessionStore, now: Date = .now) -> KidSession? {
        do {
            guard let stored = try sessions.load() else { return nil }
            if stored.isExpired(now: now) {
                try sessions.clear()
                return nil
            }
            return stored
        } catch {
            Logger(subsystem: "dev.placeholder.dragonacademy", category: "KidSignIn")
                .error("Couldn't read the kid session: \(error)")
            return nil
        }
    }

    // MARK: - Ways in

    /// A universal link (or any URL the app is asked to open). Returns whether
    /// it was a sign-in link.
    @discardableResult
    func open(_ url: URL) -> Bool {
        guard let link = KidLink(url: url) else { return false }
        Task { await handle(link) }
        return true
    }

    /// "I have a login code": opens the scanner.
    func scan() {
        guard phase != .working else { return }
        notice = nil
        phase = .scanning
    }

    /// A code the scanner read. Anything but a sign-in link leaves the
    /// scanner up with a notice, so the kid can try their own code.
    func scanned(_ text: String) async {
        guard phase == .scanning else { return }
        guard let link = KidLink(scanned: text) else {
            notice = .notACode
            return
        }
        await handle(link)
    }

    /// Signs in with `link`: a kid link at once, a family link after the kid
    /// picks themselves.
    func handle(_ link: KidLink) async {
        guard handling != link else { return }
        handling = link
        defer { handling = nil }
        notice = nil
        phase = .working
        switch link {
        case .kid(let token):
            do {
                await finish(try await service.signIn(loginToken: token))
            } catch {
                fail(error)
            }
        case .family(let token):
            do {
                let kids = try await service.family(familyToken: token)
                phase = .choosing(familyToken: token, kids: kids)
            } catch {
                fail(error)
            }
        }
    }

    /// The kid tapped themselves on a family link's list.
    func choose(_ kid: RemoteChild) async {
        guard case .choosing(let familyToken, _) = phase else { return }
        notice = nil
        phase = .working
        do {
            await finish(try await service.signIn(childID: kid.id, familyToken: familyToken))
        } catch {
            fail(error)
        }
    }

    /// In kid mode, from the landing: "someone else is playing" lists the
    /// family again if the session came from a family link, else scans.
    func switchKid() async {
        if let familyToken = try? sessions.load()?.familyToken {
            await handle(.family(token: familyToken))
        } else {
            scan()
        }
    }

    func close() {
        guard phase != .working else { return }
        phase = .closed
        notice = nil
    }

    /// Back to guest play: forgets the kid's session on this device. Their
    /// events stay queued for the next time they sign in.
    func signOutKid() async {
        do {
            try sessions.clear()
        } catch {
            log.error("Couldn't clear the kid session: \(error)")
        }
        await sessionChanged(nil)
        player.kidSignedOut()
    }

    /// A parent signed in: their session replaces the kid's.
    func parentSignedIn() {
        do {
            try sessions.clear()
        } catch {
            log.error("Couldn't clear the kid session: \(error)")
        }
    }

    // MARK: -

    private func finish(_ account: KidAccount) async {
        if player.mode == .family {
            // The parent's session uploads for their family, so the kid's
            // token isn't kept; and it couldn't upload for anyone outside the
            // family, so they don't get a profile here.
            let childID = account.session.childID
            if familyProfile(childID) == nil { await player.refresh() }
            guard let profile = familyProfile(childID) else {
                fail(.notInFamily)
                return
            }
            player.choose(profile)
            phase = .closed
            return
        }

        let profile: Profile
        do {
            profile = try await FamilyModel.save(account.child, in: store)
        } catch {
            log.error("Couldn't save the kid's profile: \(error)")
            fail(.notSaved)
            return
        }
        do {
            try sessions.save(account.session)
        } catch {
            // Still signed in until the app quits.
            log.error("Couldn't save the kid session: \(error)")
        }
        await sessionChanged(account.session.token)
        await player.kidSignedIn(profile)
        phase = .closed
    }

    private func familyProfile(_ childID: Int) -> Profile? {
        player.kids.first { $0.profile.remoteID == childID }?.profile
    }

    private func fail(_ error: KidSignInError) {
        fail(Self.notice(for: error))
    }

    private func fail(_ notice: Notice) {
        self.notice = notice
        phase = .failed
    }

    private static func notice(for error: KidSignInError) -> Notice {
        switch error {
        case .brokenLink: .brokenLink
        case .notFound(let message): .notFound(message: message)
        case .notAKid: .notAKid
        case .rateLimited: .rateLimited
        case .unavailable: .unavailable
        }
    }
}

extension EnvironmentValues {
    /// Kid sign-in by link or QR code; set by the app. Nil in previews and
    /// tests that don't set one, where "I have a login code" is hidden.
    @Entry var kidSignIn: KidSignInModel? = nil
}
