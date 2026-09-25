import Store
import SwiftUI

/// The kid sign-in sheet (presented by `RootView` while `KidSignInModel`
/// isn't closed): the QR scanner, a family link's kids, progress, or what
/// went wrong.
struct KidSignInView: View {
    let model: KidSignInModel

    var body: some View {
        ZStack {
            PaperBackground()
            switch model.phase {
            case .closed:
                EmptyView()
            case .scanning:
                ScanCodeView(model: model)
            case .working:
                ProgressView {
                    Text("Signing in…")
                        .font(Typeface.body(20, relativeTo: .title3))
                        .foregroundStyle(Palette.charcoal)
                }
                .accessibilityIdentifier("kidSignIn.working")
            case .choosing(_, let kids):
                FamilyLinkPicker(kids: kids) { kid in Task { await model.choose(kid) } }
            case .failed:
                SignInFailedView(model: model)
            }
        }
        .overlay(alignment: .topTrailing) {
            if model.phase != .working {
                Button("Close") { model.close() }
                    .buttonStyle(StampButtonStyle(kind: .secondary))
                    .padding()
                    .accessibilityIdentifier("kidSignIn.close")
            }
        }
        .interactiveDismissDisabled(model.phase == .working)
    }
}

/// The camera, framed, with a line for the kid.
private struct ScanCodeView: View {
    let model: KidSignInModel

    @Environment(\.makeCodeScanner) private var makeCodeScanner
    @State private var scan: CodeScanModel?

    var body: some View {
        VStack(spacing: 20) {
            Text("Show your login code")
                .font(Typeface.display(34, relativeTo: .largeTitle))
                .foregroundStyle(Palette.charcoal)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 56)

            Group {
                switch scan?.status {
                case .scanning:
                    if let scan {
                        CodeScannerPreview(scanner: scan.scanner)
                            .accessibilityLabel(Text("Camera"))
                    }
                case .denied:
                    message("Dragon Academy can't use the camera. Ask a grown-up to turn it on in Settings.")
                case .unavailable:
                    message("This device has no camera to scan with.")
                case .starting, nil:
                    ProgressView()
                }
            }
            .frame(maxWidth: 420, maxHeight: 420)
            .aspectRatio(1, contentMode: .fit)
            .background(Palette.paperDeep)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.charcoal, lineWidth: 3))

            (model.notice == .notACode
                ? Text("That's not a Dragon Math code. Try your own login code.")
                : Text("Hold your QR code up to the camera."))
                .font(Typeface.body(20, relativeTo: .title3))
                .foregroundStyle(model.notice == .notACode ? Palette.roseInk : Palette.pencil)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("kidSignIn.scanHint")
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 24)
        .task {
            let scan = CodeScanModel(scanner: makeCodeScanner()) { code in await model.scanned(code) }
            self.scan = scan
            await scan.start()
        }
        .onDisappear { scan?.stop() }
        .accessibilityIdentifier("kidSignIn.scanner")
    }

    private func message(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(Typeface.body(20, relativeTo: .title3))
            .foregroundStyle(Palette.charcoal)
            .multilineTextAlignment(.center)
            .padding()
    }
}

/// A family-device link's kids: each taps their own avatar. Only kid-facing
/// names (handles), as on the family picker.
private struct FamilyLinkPicker: View {
    let kids: [RemoteChild]
    let choose: (RemoteChild) -> Void

    private let columns = [GridItem(.adaptive(minimum: 140, maximum: 200), spacing: 20)]

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                Text("Who's playing?")
                    .font(Typeface.display(40, relativeTo: .largeTitle))
                    .foregroundStyle(Palette.charcoal)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 56)
                if kids.isEmpty {
                    Text("No adventurers in this family yet. Ask a grown-up to add you.")
                        .font(Typeface.body(20, relativeTo: .title3))
                        .foregroundStyle(Palette.pencil)
                        .multilineTextAlignment(.center)
                } else {
                    LazyVGrid(columns: columns, spacing: 20) {
                        ForEach(kids, id: \.id) { kid in
                            let name = FamilyModel.kidFacingName(kid.username)
                            Button { choose(kid) } label: {
                                VStack(spacing: 12) {
                                    AvatarView(avatar: kid.avatar)
                                        .font(.system(size: 60))
                                        .frame(width: 96, height: 96)
                                        .background(Circle().fill(Palette.sage.opacity(0.35)))
                                        .overlay(Circle().strokeBorder(Palette.charcoal, lineWidth: 2.5))
                                    Text(verbatim: name)
                                        .font(Typeface.display(24, relativeTo: .title3))
                                        .foregroundStyle(Palette.charcoal)
                                        .lineLimit(2)
                                        .multilineTextAlignment(.center)
                                }
                                .padding(16)
                                .frame(maxWidth: .infinity, minHeight: 180)
                                .modifier(PaperCard(rotation: 0))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(verbatim: name))
                            .accessibilityHint(Text("Play as this adventurer"))
                            .accessibilityIdentifier("kidSignIn.kid.\(kid.id)")
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
    }
}

private struct SignInFailedView: View {
    let model: KidSignInModel

    var body: some View {
        VStack(spacing: 24) {
            message
                .font(Typeface.body(22, relativeTo: .title2))
                .foregroundStyle(Palette.charcoal)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("kidSignIn.failed")
            Button("Scan a code") { model.scan() }
                .buttonStyle(StampButtonStyle(kind: .primary))
                .accessibilityIdentifier("kidSignIn.retry")
        }
        .padding(32)
        .frame(maxWidth: 560)
    }

    private var message: Text {
        switch model.notice {
        case .notFound(let message) where !message.isEmpty:
            // The server's own words, written for kids.
            Text(verbatim: message)
        case .notFound, .brokenLink, .notACode:
            Text("That login code didn't work. Ask for a fresh one.")
        case .notAKid:
            Text("That's a grown-up's code. Grown-ups sign in from Grown-ups.")
        case .notInFamily:
            Text("That adventurer isn't in this family. A grown-up can sign out in Grown-ups first.")
        case .rateLimited:
            Text("Too many tries. Wait a few minutes, then try again.")
        case .unavailable, nil:
            Text("Couldn't reach Dragon Academy. Check the internet and try again.")
        case .notSaved:
            Text("Something went wrong on this device. Try again.")
        }
    }
}

/// "I have a login code": opens the scanner. Shown where a kid starts
/// playing: the family picker, the guest map, and the kid-mode landing.
struct LoginCodeButton: View {
    @Environment(\.kidSignIn) private var kidSignIn
    /// Just the icon, for the map header's tight row.
    var compact = false

    var body: some View {
        if let kidSignIn {
            Button {
                kidSignIn.scan()
            } label: {
                if compact {
                    Image(systemName: "qrcode.viewfinder")
                } else {
                    Label("I have a login code", systemImage: "qrcode.viewfinder")
                }
            }
            .buttonStyle(StampButtonStyle(kind: .secondary))
            .accessibilityLabel(Text("I have a login code"))
            .accessibilityIdentifier("kidSignIn.open")
        }
    }
}

/// Kid mode's "Who's playing?", when the signed-in kid taps their avatar on
/// the map: carry on as them, hand over to someone else (their family link's
/// list, or the scanner), or go back to guest play.
struct KidLandingView: View {
    let player: CurrentPlayer
    let kidSignIn: KidSignInModel

    var body: some View {
        ZStack {
            PaperBackground()
            ScrollView {
                VStack(spacing: 24) {
                    HStack {
                        Spacer()
                        GrownUpsButton()
                    }
                    Text("Who's playing?")
                        .font(Typeface.display(40, relativeTo: .largeTitle))
                        .foregroundStyle(Palette.charcoal)
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)

                    if let kid = player.signedInKid {
                        Button { player.choose(kid) } label: {
                            VStack(spacing: 12) {
                                AvatarView(avatar: kid.avatar)
                                    .font(.system(size: 60))
                                    .frame(width: 96, height: 96)
                                    .background(Circle().fill(Palette.sage.opacity(0.35)))
                                    .overlay(Circle().strokeBorder(Palette.charcoal, lineWidth: 2.5))
                                Text(verbatim: kid.displayName)
                                    .font(Typeface.display(24, relativeTo: .title3))
                                    .foregroundStyle(Palette.charcoal)
                            }
                            .padding(16)
                            .frame(maxWidth: 220, minHeight: 180)
                            .modifier(PaperCard(rotation: -1.5))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(verbatim: kid.displayName))
                        .accessibilityHint(Text("Play as this adventurer"))
                        .accessibilityIdentifier("landing.kid")
                    } else if !player.hasLoaded {
                        ProgressView()
                    }

                    Button("Someone else is playing") { Task { await kidSignIn.switchKid() } }
                        .buttonStyle(StampButtonStyle(kind: .primary))
                        .accessibilityIdentifier("landing.someoneElse")
                    Button("Play as a guest") { Task { await kidSignIn.signOutKid() } }
                        .buttonStyle(StampButtonStyle(kind: .secondary))
                        .accessibilityIdentifier("landing.guest")
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityIdentifier("landing")
    }
}

#Preview("Family link") {
    let store = try! SQLiteStore.inMemory()
    let player = CurrentPlayer(store: store, family: FakeFamilyService(), parentSignedIn: false)
    let model = KidSignInModel(
        service: FakeKidSignInService(), sessions: InMemoryKidSessionStore(), store: store, player: player,
        sessionChanged: { _ in })
    KidSignInView(model: model)
        .task { await model.handle(.family(token: "00000000-0000-4000-8000-000000000001")) }
}
