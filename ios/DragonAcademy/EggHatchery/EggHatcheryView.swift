import GameRules
import Store
import Sync
import SwiftUI

/// The lair's Egg Hatchery, for whoever is playing (the guest, or the kid
/// picked on the family picker), on the facts they picked; a child profile's
/// attempts and dragons upload through Sync.
struct EggHatcheryEntry: View {
    let facts: LairFacts

    @Environment(\.store) private var store
    @Environment(\.sync) private var sync
    @Environment(\.currentProfile) private var profile

    var body: some View {
        EggHatcheryView(model: EggHatcheryModel(facts: facts, store: store, profileID: profile?.id, sync: sync))
    }
}

/// Dragon Egg Hatchery: twelve problems on one number, each solved egg
/// hatching a baby dragon, then a mastery tier for the time. The SwiftUI twin
/// of src/components/DragonEggHatchery.jsx (and its module CSS).
struct EggHatcheryView: View {
    @State private var model: EggHatcheryModel
    @Environment(\.dismiss) private var dismiss

    init(model: EggHatcheryModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ZStack {
            PaperBackground()
            ScrollView {
                content
                    .frame(maxWidth: 640)
                    .padding(16)
                    .frame(maxWidth: .infinity)
            }
            if model.confirmingQuit {
                QuitCard(
                    quit: {
                        model.quit()
                        dismiss()
                    },
                    keepPlaying: { model.confirmingQuit = false })
            }
        }
        .animation(.snappy, value: model.confirmingQuit)
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .task { await model.load() }
    }

    @ViewBuilder private var content: some View {
        if let result = model.result, let round = model.round {
            AchievementCard(result: result, dragons: round.dragons) {
                dismiss()
            }
        } else if let round = model.round, let problem = round.current {
            VStack(spacing: 18) {
                ProgressStrip(hatched: model.hatchedCount) { model.confirmingQuit = true }
                ProblemCard(model: model, round: round, problem: problem)
                AnswerGrid(model: model, problem: problem)
                if model.showsHintButton {
                    Button {
                        model.toggleHint()
                    } label: {
                        Text(round.hintShown ? "🐉 Hide hint" : "🐉 Need a hand?")
                            .font(Typeface.body(16, relativeTo: .callout))
                            .foregroundStyle(Palette.charcoal)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 9)
                            .background(Palette.lavender.opacity(0.45), in: Capsule())
                            .overlay(Capsule().strokeBorder(Palette.lavender, lineWidth: 2))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(round.hintShown ? Text("Hide hint") : Text("Get a hint"))
                    .accessibilityIdentifier("hatchery.hint")
                    .transition(.scale.combined(with: .opacity))
                }
                BabiesCollected(dragons: round.dragons)
            }
            .animation(.snappy, value: model.showsHintButton)
        } else {
            // Only the moment before the synced catalog and settings are read.
            ProgressView()
                .frame(maxWidth: .infinity, minHeight: 300)
                .accessibilityLabel(Text("Loading…"))
        }
    }
}

// MARK: - Pieces

private struct ProgressStrip: View {
    let hatched: Int
    var quit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Eggs Hatched: \(Text(verbatim: "\(hatched)/\(hatcherySize)").foregroundStyle(Palette.rose))")
                    .font(Typeface.display(20, relativeTo: .headline))
                    .foregroundStyle(Palette.charcoal)
                    .accessibilityLabel(Text("\(hatched) of \(hatcherySize) eggs hatched"))
                    .accessibilityIdentifier("hatchery.progress")
                Spacer()
                Button(action: quit) {
                    Text("← Quit")
                        .font(Typeface.body(14, relativeTo: .caption))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Palette.rose.opacity(0.9), in: RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Quit game"))
                .accessibilityIdentifier("hatchery.quit")
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle().fill(.white.opacity(0.5))
                    Rectangle()
                        .fill(Palette.sage)
                        .frame(width: geo.size.width * CGFloat(hatched) / CGFloat(hatcherySize))
                }
                .overlay(Rectangle().strokeBorder(Palette.charcoal.opacity(0.6), lineWidth: 1.5))
            }
            .frame(height: 16)
            .animation(.easeOut(duration: 0.4), value: hatched)
            .accessibilityHidden(true)
        }
        .padding(16)
        .paperCard(rotation: -0.4)
        .overlay(alignment: .top) { WashiTape(color: Palette.sage).offset(y: -9) }
    }
}

private struct ProblemCard: View {
    let model: EggHatcheryModel
    let round: HatcheryRound
    let problem: HatcheryProblem

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let hatching = model.hatchingButton != nil
        VStack(spacing: 10) {
            Text(verbatim: "🥚")
                .font(.system(size: 60))
                .rotationEffect(.degrees(hatching && !reduceMotion ? 12 : 0))
                .scaleEffect(hatching ? 1.15 : 1)
                .animation(hatching && !reduceMotion ? .easeInOut(duration: 0.1).repeatCount(7, autoreverses: true) : .default, value: hatching)
                .accessibilityHidden(true)
            HStack(spacing: 0) {
                Text(verbatim: "\(problem.operand1) \(round.operation.symbol) \(problem.operand2)")
                if hatching {
                    Text(verbatim: " = \(problem.correctAnswer)")
                        .foregroundStyle(Palette.sage)
                        .transition(.opacity)
                }
            }
            .font(Typeface.display(46, relativeTo: .largeTitle))
            .foregroundStyle(Palette.charcoal)
            .monospacedDigit()
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("hatchery.problem")

            Group {
                if hatching {
                    Text("✓ Correct!").foregroundStyle(Palette.sage)
                } else if model.wrongButton != nil {
                    Text("✗ Not quite, try again!").foregroundStyle(Palette.rose)
                }
            }
            .font(Typeface.display(22, relativeTo: .title3))
            .transition(.scale.combined(with: .opacity))
            .accessibilityIdentifier("hatchery.feedback")

            if let hint = round.hintText {
                Text(verbatim: "💡 \(hint)")
                    .font(Typeface.body(17, relativeTo: .callout))
                    .foregroundStyle(Palette.charcoal)
                    .multilineTextAlignment(.center)
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .background(Palette.lavender.opacity(0.15))
                    .overlay(Rectangle().strokeBorder(Palette.lavender, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])))
                    .accessibilityIdentifier("hatchery.hintText")
            } else if round.hintShown {
                Text("No hint for this one — you've got it!")
                    .font(Typeface.body(17, relativeTo: .callout))
                    .foregroundStyle(Palette.pencil)
            }
        }
        .animation(.snappy, value: model.wrongButton)
        .animation(.snappy, value: hatching)
        .frame(maxWidth: .infinity)
        .padding(20)
        .paperCard(rotation: 0.5)
        .overlay(alignment: .top) { WashiTape(color: Palette.rose).offset(y: -9) }
    }
}

private struct AnswerGrid: View {
    let model: EggHatcheryModel
    let problem: HatcheryProblem

    private static let tilts: [Double] = [-1.2, 0.8, -0.5, 1.1]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)], spacing: 14) {
            ForEach(Array(model.choices.enumerated()), id: \.offset) { i, value in
                let right = model.hatchingButton == i
                let wrong = model.wrongButton == i
                Button {
                    model.tap(i)
                } label: {
                    Text(verbatim: "\(value)")
                        .font(Typeface.display(34, relativeTo: .title))
                        .monospacedDigit()
                        .foregroundStyle(right ? Color(hex: 0x3D5A2B) : wrong ? Color(hex: 0x5A2A2A) : Palette.charcoal)
                        .frame(maxWidth: .infinity, minHeight: 76)
                        .background(
                            right ? AnyShapeStyle(Palette.sage.opacity(0.45))
                                : wrong ? AnyShapeStyle(Palette.rose.opacity(0.3)) : AnyShapeStyle(Palette.card))
                        .overlay(Rectangle().strokeBorder(
                            right ? Palette.sage : wrong ? Palette.rose : Palette.charcoal.opacity(0.7), lineWidth: 2))
                        .shadow(color: Palette.charcoal.opacity(0.18), radius: 0, x: 2, y: 3)
                }
                .buttonStyle(.plain)
                .rotationEffect(.degrees(Self.tilts[i % Self.tilts.count]))
                .scaleEffect(wrong ? 0.96 : 1)
                .disabled(model.hatchingButton != nil)
                .accessibilityIdentifier("hatchery.answer.\(i)")
            }
        }
        // A new problem gets fresh buttons, not an animated reshuffle.
        .id(problem.id)
        .animation(.snappy, value: model.wrongButton)
    }
}

/// The twelve slots, filled as eggs hatch.
private struct BabiesCollected: View {
    let dragons: [HatchedDragon]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("🐉 Babies Collected:")
                .font(Typeface.display(20, relativeTo: .headline))
                .foregroundStyle(Palette.charcoal)
            DragonSlots(dragons: dragons, emptySlots: hatcherySize - dragons.count)
        }
        .padding(16)
        .paperCard(rotation: -0.3)
        .overlay(alignment: .top) { WashiTape(color: Palette.mustard).offset(y: -9) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(dragons.count) baby dragons collected"))
    }
}

private struct DragonSlots: View {
    let dragons: [HatchedDragon]
    var emptySlots = 0

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 6), spacing: 8) {
            ForEach(dragons, id: \.problemID) { dragon in
                DragonArtView(dragonID: dragon.dragonID)
                    .padding(3)
                    .frame(maxWidth: .infinity, minHeight: 48, maxHeight: 48)
                    .background(.white.opacity(0.6), in: RoundedRectangle(cornerRadius: 4))
                    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Palette.kraft, lineWidth: 1.5))
                    .transition(.scale.combined(with: .opacity))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text("Baby dragon"))
            }
            ForEach(0..<max(0, emptySlots), id: \.self) { _ in
                RoundedRectangle(cornerRadius: 4)
                    .fill(.white.opacity(0.3))
                    .strokeBorder(Palette.kraft.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                    .frame(minHeight: 48)
                    .accessibilityHidden(true)
            }
        }
        .animation(.spring(duration: 0.5, bounce: 0.4), value: dragons.count)
    }
}

private struct AchievementCard: View {
    let result: HatcheryResult
    let dragons: [HatchedDragon]
    var done: () -> Void

    @State private var shown = false

    var body: some View {
        VStack(spacing: 14) {
            Text(verbatim: result.tier.icon)
                .font(.system(size: 80))
                .scaleEffect(shown ? 1 : 0.3)
                .accessibilityHidden(true)
            result.tier.label
                .font(Typeface.display(34, relativeTo: .largeTitle))
                .foregroundStyle(Palette.charcoal)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("hatchery.tier")
            result.tier.message
                .font(Typeface.body(18, relativeTo: .headline))
                .foregroundStyle(Palette.pencil)
                .multilineTextAlignment(.center)
            HStack(spacing: 36) {
                stat(Text("time"), value: hatcheryFormatTime(result.elapsedSeconds))
                    .accessibilityIdentifier("hatchery.time")
                stat(Text("Score"), value: "\(hatcherySize)/\(hatcherySize)")
            }
            DragonSlots(dragons: dragons)
            Button("Continue", action: done)
                .buttonStyle(StampButtonStyle())
                .accessibilityIdentifier("hatchery.continue")
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .paperCard(rotation: -0.5)
        .overlay(alignment: .top) { WashiTape(color: Palette.mustard).offset(y: -9) }
        .padding(.top, 24)
        .onAppear { withAnimation(.spring(duration: 0.6, bounce: 0.5).delay(0.2)) { shown = true } }
    }

    private func stat(_ label: Text, value: String) -> some View {
        VStack(spacing: 2) {
            label
                .font(Typeface.body(13, relativeTo: .caption))
                .textCase(.uppercase)
                .kerning(1)
                .foregroundStyle(Palette.kraftDark)
            Text(verbatim: value)
                .font(Typeface.display(28, relativeTo: .title2))
                .foregroundStyle(Palette.charcoal)
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }
}

private struct QuitCard: View {
    var quit: () -> Void
    var keepPlaying: () -> Void

    var body: some View {
        ZStack {
            Palette.charcoal.opacity(0.5).ignoresSafeArea()
                .onTapGesture(perform: keepPlaying)
            VStack(spacing: 16) {
                Text("Are you sure you want to quit?")
                    .font(Typeface.body(18, relativeTo: .headline))
                    .foregroundStyle(Palette.charcoal)
                    .multilineTextAlignment(.center)
                HStack(spacing: 12) {
                    Button("Yes, quit", action: quit)
                        .buttonStyle(StampButtonStyle(kind: .secondary))
                        .accessibilityIdentifier("hatchery.quit.confirm")
                    Button("Keep playing", action: keepPlaying)
                        .buttonStyle(StampButtonStyle())
                        .accessibilityIdentifier("hatchery.quit.cancel")
                }
            }
            .padding(24)
            .frame(maxWidth: 360)
            .paperCard()
            .padding(24)
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
        }
        .transition(.opacity)
    }
}

extension HatcheryTier {
    /// The badge, as the web shows it.
    var icon: String {
        switch self {
        case .legendary: "💎"
        case .gold: "⭐"
        case .silver: "✨"
        case .bronze: "🌱"
        }
    }

    var label: Text {
        switch self {
        case .legendary: Text("Mastered!")
        case .gold: Text("Almost Mastered!")
        case .silver: Text("Getting There!")
        // "Keep Practicing!" on the web; the catalog already has this key,
        // and keys differing only by case break the build.
        case .bronze: Text("Keep practicing!")
        }
    }

    var message: Text {
        switch self {
        case .legendary: Text("Incredible! You completely mastered this!")
        case .gold: Text("Excellent work! You're almost there!")
        case .silver: Text("Great job! Keep practicing!")
        case .bronze: Text("Good effort! Practice makes perfect!")
        }
    }
}

#Preview {
    NavigationStack {
        EggHatcheryView(model: EggHatcheryModel(
            facts: LairFacts(operation: .mul, number: 7), store: nil, profileID: nil, sync: nil))
    }
}
