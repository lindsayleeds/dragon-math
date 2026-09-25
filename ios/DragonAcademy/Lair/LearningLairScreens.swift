import GameRules
import SwiftUI

// The Learning Lair screens, the SwiftUI side of src/pages/LearningLairPage.jsx
// and the number grid of LearningLairOperationPage.jsx. What each tap leads to
// is decided by `Lair` in GameRules; these only draw the choices and push the
// route they are handed.
//
// Catalog text (game names, blurbs) is English data from games.js, shown
// verbatim like the web; the screens' own words are localized.

/// Pushes the next lair screen.
typealias LairNavigate = (LairRoute) -> Void

/// The screen for a lair route.
struct LairScreen: View {
    let route: LairRoute
    var navigate: LairNavigate
    /// Leaves a game for the lair's front door.
    var backToLair: () -> Void
    /// Opens the Dragon's Trial.
    var openTrial: () -> Void = {}

    @Environment(\.premiumAccess) private var premiumAccess
    @Environment(\.currentProfile) private var profile

    var body: some View {
        switch route {
        case .subjects:
            LairSubjectsScreen(navigate: navigate, openTrial: openTrial)
        case .games(let subject):
            LairGamesScreen(subject: subject, navigate: navigate)
        case .facts(let game, let operation):
            LairFactsScreen(game: game, operation: operation, navigate: navigate)
        case .play(let game, _) where premiumAccess?.isLocked(game, for: profile) == true:
            // The card already asks for a grown-up; this covers any other way in.
            LairLockedScreen(game: game)
        case .play(let game, let facts):
            switch LairGameDestination(game: game, facts: facts) {
            case .provingGrounds:
                ProvingGroundsEntry()
            case .memorize:
                MemorizeEntry()
            case .eggHatchery(let facts):
                EggHatcheryEntry(facts: facts)
            case .steppingStones(let baseNumber):
                SteppingStonesEntry(baseNumber: baseNumber, backToLair: backToLair)
            case .comingSoon(let game, let facts):
                LairComingSoonScreen(game: game, facts: facts, backToLair: backToLair)
            }
        }
    }
}

// MARK: - Step 1: subject

struct LairSubjectsScreen: View {
    var navigate: LairNavigate
    var openTrial: () -> Void = {}

    var body: some View {
        LairPage(title: Text("Learning Lair"), subtitle: Text("— what shall we work on?"), icon: "🦉", backLabel: "⌂ map") {
            TrialInvitation(action: openTrial, style: .card)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 16)], spacing: 16) {
                ForEach(Lair.stockedSubjects()) { subject in
                    let count = Lair.games(in: subject.id).count
                    Button {
                        navigate(.games(subject))
                    } label: {
                        VStack(spacing: 6) {
                            Text(verbatim: subject.emoji).font(.system(size: 40))
                            Text(verbatim: subject.label)
                                .font(Typeface.display(26, relativeTo: .title2))
                            Text(verbatim: subject.blurb)
                                .font(Typeface.body(15, relativeTo: .subheadline))
                                .foregroundStyle(Palette.pencil)
                                .multilineTextAlignment(.center)
                            (count == 1 ? Text("1 game") : Text("\(count) games"))
                                .font(Typeface.body(14, relativeTo: .caption))
                                .foregroundStyle(Palette.kraftDark)
                        }
                        .lairCard(accent: Color(hex: subject.color))
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(Text("\(subject.label) games"))
                    .accessibilityIdentifier("lair.subject.\(subject.id)")
                }
            }
        }
    }
}

// MARK: - Step 2: game

struct LairGamesScreen: View {
    let subject: LairSubject
    var navigate: LairNavigate

    @State private var filter: String?
    /// The locked game whose "Ask a grown-up" sheet is up.
    @State private var askingAbout: LairGame?
    /// The sheet's "Get a grown-up" was tapped: open the parent area once the
    /// sheet has gone (one presentation at a time).
    @State private var openParentAfterSheet = false

    @Environment(\.premiumAccess) private var premiumAccess
    @Environment(\.currentProfile) private var profile
    @Environment(\.openParentAccess) private var openParentAccess

    var body: some View {
        let chips = Lair.filterChips(for: subject.id)
        LairPage(
            title: Text("Learning Lair"),
            subtitle: Text("— \(subject.label.lowercased()): pick a game"),
            icon: subject.emoji
        ) {
            VStack(alignment: .leading, spacing: 16) {
                if !chips.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            LairChip(label: Text("all games"), accent: Palette.kraft, on: filter == nil) {
                                filter = nil
                            }
                            .accessibilityIdentifier("lair.chip.all")
                            ForEach(chips) { tag in
                                LairChip(
                                    label: Text(verbatim: "\(tag.symbol) \(tag.label)"),
                                    accent: Color(hex: tag.color), on: filter == tag.id
                                ) {
                                    filter = tag.id
                                }
                                .accessibilityIdentifier("lair.chip.\(tag.id)")
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text("Filter games by skill"))
                }
                ForEach(Lair.games(in: subject.id, filter: filter)) { game in
                    let locked = premiumAccess?.isLocked(game, for: profile) == true
                    LairGameCard(game: game, locked: locked) {
                        if locked {
                            askingAbout = game
                        } else {
                            navigate(LairRoute(Lair.pick(game, filter: filter)))
                        }
                    }
                }
            }
        }
        .sheet(item: $askingAbout, onDismiss: {
            if openParentAfterSheet {
                openParentAfterSheet = false
                openParentAccess()
            }
        }) { game in
            AskAGrownUpView(game: game) {
                openParentAfterSheet = true
                askingAbout = nil
            } notNow: {
                askingAbout = nil
            }
            .padding(24)
            .presentationDetents([.medium, .large])
            .presentationBackground(Palette.cardTop)
        }
    }
}

private struct LairChip: View {
    let label: Text
    let accent: Color
    let on: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            label
                .font(Typeface.body(15, relativeTo: .subheadline))
                .foregroundStyle(Palette.charcoal)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(on ? accent.opacity(0.55) : Palette.cardTop)
                .overlay(Capsule().strokeBorder(accent, lineWidth: 1.5))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

private struct LairGameCard: View {
    let game: LairGame
    /// A premium game on a free plan: shown with a lock, and tapping asks for
    /// a grown-up instead of starting it.
    var locked = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 14) {
                Text(verbatim: game.emoji).font(.system(size: 40))
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(verbatim: game.name)
                            .font(Typeface.display(22, relativeTo: .title3))
                        Spacer(minLength: 4)
                        if game.premium {
                            Label("Premium", systemImage: locked ? "lock.fill" : "star.fill")
                                .font(Typeface.body(13, relativeTo: .caption))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Palette.mustard.opacity(0.5))
                                .overlay(Capsule().strokeBorder(Palette.kraftDark, lineWidth: 1))
                                .clipShape(Capsule())
                        }
                    }
                    Text(verbatim: game.description)
                        .font(Typeface.body(15, relativeTo: .subheadline))
                        .foregroundStyle(Palette.pencil)
                    HStack(spacing: 6) {
                        ForEach(game.practices.compactMap(LairSkillTag.named)) { tag in
                            Text(verbatim: "\(tag.symbol) \(tag.label)")
                                .font(Typeface.body(12, relativeTo: .caption2))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color(hex: tag.color).opacity(0.3))
                                .clipShape(Capsule())
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(Palette.charcoal)
            .padding(16)
            .paperCard()
            .opacity(locked ? 0.75 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityIdentifier("lair.game.\(game.id)")
    }

    private var accessibilityLabel: Text {
        if locked { return Text("\(game.name), premium, locked. Ask a grown-up") }
        return game.premium ? Text("Play \(game.name), premium") : Text("Play \(game.name)")
    }
}

// MARK: - Step 3: facts

/// Which facts a math game practices: the operation (when the game offers
/// several and no chip already said), then a number from 1 to 12.
struct LairFactsScreen: View {
    let game: LairGame
    let operation: BattleOp?
    var navigate: LairNavigate

    var body: some View {
        if let operation {
            numberPicker(operation)
        } else {
            operationPicker
        }
    }

    private var operationPicker: some View {
        LairPage(title: Text("Learning Lair"), subtitle: Text("— which skill for \(game.name)?"), icon: game.emoji) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 16)], spacing: 16) {
                ForEach(game.skills, id: \.self) { op in
                    let tag = LairSkillTag.operation(op)
                    Button {
                        navigate(LairRoute(Lair.pick(op, for: game)))
                    } label: {
                        VStack(spacing: 4) {
                            Text(verbatim: tag.symbol).font(Typeface.display(44, relativeTo: .largeTitle))
                            Text(verbatim: tag.label).font(Typeface.display(22, relativeTo: .title3))
                            Text(verbatim: tag.blurb)
                                .font(Typeface.body(15, relativeTo: .subheadline))
                                .foregroundStyle(Palette.pencil)
                        }
                        .lairCard(accent: Color(hex: tag.color))
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(Text("Play \(game.name) with \(tag.label)"))
                    .accessibilityIdentifier("lair.op.\(op.rawValue)")
                }
            }
        }
    }

    private func numberPicker(_ op: BattleOp) -> some View {
        let tag = LairSkillTag.operation(op)
        return LairPage(title: Text(verbatim: tag.label), subtitle: Text("— pick a number to practice"), icon: tag.symbol) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
                ForEach(Lair.numbers, id: \.self) { n in
                    Button {
                        navigate(LairRoute(Lair.pick(number: n, operation: op, for: game)))
                    } label: {
                        Text(verbatim: "\(n)")
                            .font(Typeface.display(30, relativeTo: .title))
                            .foregroundStyle(Palette.charcoal)
                            .frame(maxWidth: .infinity, minHeight: 64)
                            .background(Color(hex: tag.color).opacity(0.35))
                            .overlay(Circle().strokeBorder(Palette.charcoal, lineWidth: 2).padding(4))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("\(tag.label) with \(n)"))
                    .accessibilityIdentifier("lair.number.\(n)")
                }
            }
        }
    }
}

// MARK: - Games not built yet

struct LairComingSoonScreen: View {
    let game: LairGame
    let facts: LairFacts?
    var backToLair: () -> Void

    var body: some View {
        LairPage(title: Text(verbatim: game.name), subtitle: nil, icon: game.emoji) {
            VStack(spacing: 18) {
                Text("Coming soon!")
                    .font(Typeface.display(34, relativeTo: .largeTitle))
                    .foregroundStyle(Palette.rose)
                    .rotationEffect(.degrees(-2))
                    .accessibilityIdentifier("lair.comingSoon")
                Text("The dragons are still building this game. Try another one in the meantime!")
                    .font(Typeface.body(18))
                    .multilineTextAlignment(.center)
                if let facts {
                    // Shows the facts reached the game, and what it will practice.
                    let tag = LairSkillTag.operation(facts.operation)
                    Group {
                        if let number = facts.number {
                            Text("You picked: \(tag.label) with \(number)")
                        } else {
                            Text("You picked: \(tag.label)")
                        }
                    }
                    .font(Typeface.display(20, relativeTo: .title3))
                    .accessibilityIdentifier("lair.comingSoon.facts")
                }
                Button("Back to the Learning Lair", action: backToLair)
                    .buttonStyle(StampButtonStyle())
                    .accessibilityIdentifier("lair.comingSoon.back")
            }
            .foregroundStyle(Palette.charcoal)
            .padding(24)
            .frame(maxWidth: .infinity)
            .paperCard(rotation: -0.5)
        }
    }
}

// MARK: - Premium games on a free plan

/// "Ask a grown-up": what a kid sees on tapping a premium game their family's
/// plan doesn't include. "Get a grown-up" opens the parent area, behind its
/// gate, where the Premium screen is; the kid never sees a price.
struct AskAGrownUpView: View {
    let game: LairGame
    var getGrownUp: () -> Void
    /// Nil where there's nothing to close (the locked page has its back tab).
    var notNow: (() -> Void)?

    var body: some View {
        VStack(spacing: 16) {
            Text(verbatim: "\(game.emoji)🔒").font(.system(size: 48)).accessibilityHidden(true)
            Text("Ask a grown-up")
                .font(Typeface.display(32, relativeTo: .largeTitle))
                .foregroundStyle(Palette.rose)
                .rotationEffect(.degrees(-2))
                .accessibilityAddTraits(.isHeader)
            Text("\(game.name) is a Premium game. A grown-up can unlock it for you.")
                .font(Typeface.body(18))
                .multilineTextAlignment(.center)
            Button("Get a grown-up", action: getGrownUp)
                .buttonStyle(StampButtonStyle())
                .accessibilityIdentifier("lair.locked.grownUp")
            if let notNow {
                Button("Not now", action: notNow)
                    .buttonStyle(StampButtonStyle(kind: .secondary))
                    .accessibilityIdentifier("lair.locked.notNow")
            }
        }
        .foregroundStyle(Palette.charcoal)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("lair.locked")
    }
}

/// A premium game reached some way other than its card, on a free plan.
struct LairLockedScreen: View {
    let game: LairGame

    @Environment(\.openParentAccess) private var openParentAccess

    var body: some View {
        LairPage(title: Text(verbatim: game.name), subtitle: nil, icon: game.emoji) {
            AskAGrownUpView(game: game, getGrownUp: { openParentAccess() })
                .padding(24)
                .paperCard(rotation: -0.5)
        }
    }
}

// MARK: - Shared chrome

/// A lair page: paper, a back tab, the title block, and scrolling content.
private struct LairPage<Content: View>: View {
    let title: Text
    let subtitle: Text?
    let icon: String
    var backLabel: LocalizedStringKey = "← back"
    @ViewBuilder var content: Content

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            PaperBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button(action: { dismiss() }) {
                        Text(backLabel)
                    }
                    .buttonStyle(StampButtonStyle(kind: .secondary))
                    .accessibilityIdentifier("lair.back")
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 8) {
                            Text(verbatim: icon).font(.system(size: 34)).accessibilityHidden(true)
                            title
                                .font(Typeface.display(36, relativeTo: .largeTitle))
                                .rotationEffect(.degrees(-1))
                        }
                        if let subtitle {
                            subtitle
                                .font(Typeface.body(18, relativeTo: .headline))
                                .foregroundStyle(Palette.kraftDark)
                        }
                    }
                    .foregroundStyle(Palette.charcoal)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)
                    content
                }
                .padding(16)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
    }
}

private extension View {
    /// A subject or operation card: cream paper with an accent tape strip.
    func lairCard(accent: Color) -> some View {
        self
            .foregroundStyle(Palette.charcoal)
            .frame(maxWidth: .infinity, minHeight: 150)
            .padding(14)
            .paperCard()
            .overlay(alignment: .top) { WashiTape(color: accent).offset(y: -9) }
    }
}
