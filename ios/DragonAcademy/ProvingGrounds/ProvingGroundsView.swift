import GameRules
import Store
import SwiftUI

/// Proving Grounds: a timed drill that proves a kid's times tables (or the
/// matching division facts) for one digit, for a bronze, silver or gold medal.
/// The SwiftUI twin of src/pages/ProvingGroundsPage.jsx. Pushed from the
/// Learning Lair (math → Proving Grounds).
struct ProvingGroundsView: View {
    @State private var model: ProvingGroundsModel
    @Environment(\.dismiss) private var dismiss

    init(model: ProvingGroundsModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ZStack {
            ProvingStyle.paper.ignoresSafeArea()
            content
                .frame(maxWidth: 640)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if let fact = model.correction {
                CorrectionCard(fact: fact, accent: ProvingStyle.accent(model.mode))
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.snappy, value: model.correction)
        .navigationTitle("Proving Grounds")
        .navigationBarTitleDisplayMode(.inline)
        // Our own back button: it steps back through the drill's screens
        // and only leaves (pops the lair route) from the first one.
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(backLabel) {
                    if model.screen == .mode { dismiss() } else { model.back() }
                }
                .accessibilityIdentifier("proving.back")
            }
        }
        .task { await model.load() }
    }

    private var backLabel: LocalizedStringKey {
        switch model.screen {
        case .mode: "← the lair"
        case .play: "← give up"
        case .level, .result: "← back"
        }
    }


    @ViewBuilder private var content: some View {
        switch model.screen {
        case .mode: ModeScreen(model: model)
        case .level: LevelScreen(model: model)
        case .play: PlayScreen(model: model)
        case .result: ResultScreen(model: model)
        }
    }
}

// MARK: - Style

enum ProvingStyle {
    static let paper = Color(red: 0.98, green: 0.96, blue: 0.91)
    static let ink = Color(red: 0.24, green: 0.2, blue: 0.17)

    static func accent(_ mode: ProvingMode) -> Color {
        switch mode {
        case .mul: Color(red: 0.85, green: 0.45, blue: 0.45)  // #d97474
        case .div: Color(red: 0.83, green: 0.66, blue: 0.34)  // #d4a957
        }
    }

    static func icon(_ medal: Medal) -> String {
        switch medal {
        case .gold: "🥇"
        case .silver: "🥈"
        case .bronze: "🥉"
        }
    }

    static func label(_ medal: Medal) -> LocalizedStringKey {
        switch medal {
        case .gold: "Gold"
        case .silver: "Silver"
        case .bronze: "Bronze"
        }
    }

    static func name(_ mode: ProvingMode) -> LocalizedStringKey {
        switch mode {
        case .mul: "Multiplication"
        case .div: "Division"
        }
    }

    static func blurb(_ mode: ProvingMode) -> LocalizedStringKey {
        switch mode {
        case .mul: "prove your times tables"
        case .div: "prove your sharing facts"
        }
    }

    /// "41.2s"
    static func time(_ seconds: Double) -> String {
        seconds.formatted(.number.precision(.fractionLength(1))) + "s"
    }

    /// Settings seconds without a needless ".0" ("45s", "45.5s").
    static func threshold(_ seconds: Double) -> String {
        seconds.formatted(.number.precision(.fractionLength(0...1))) + "s"
    }
}

// MARK: - Choose × or ÷

private struct ModeScreen: View {
    let model: ProvingGroundsModel

    var body: some View {
        VStack(spacing: 24) {
            Text(verbatim: "🏆").font(.system(size: 56)).accessibilityHidden(true)
            Text("What will you prove today?")
                .font(.title2.bold())
                .foregroundStyle(ProvingStyle.ink)
            Text("Answer every fact twice, as fast as you can. Earn 🥉 🥈 🥇 for your speed!")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            HStack(spacing: 16) {
                ForEach(ProvingMode.allCases, id: \.self) { mode in
                    Button { model.choose(mode) } label: {
                        VStack(spacing: 8) {
                            Text(mode.symbol).font(.system(size: 64, weight: .bold, design: .rounded))
                            Text(ProvingStyle.name(mode)).font(.headline)
                            Text(ProvingStyle.blurb(mode)).font(.caption).opacity(0.85)
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 180)
                        .background(ProvingStyle.accent(mode), in: .rect(cornerRadius: 20))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("proving.mode.\(mode.rawValue)")
                }
            }
        }
    }
}

// MARK: - Choose a digit

private struct LevelScreen: View {
    let model: ProvingGroundsModel

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 12)]

    var body: some View {
        let mode = model.mode
        let accent = ProvingStyle.accent(mode)
        let s = model.settings
        ScrollView {
            VStack(spacing: 20) {
                Text("Pick a challenge")
                    .font(.title2.bold())
                    .foregroundStyle(ProvingStyle.ink)
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(provingDigits, id: \.self) { digit in
                        Button { model.start(digit) } label: {
                            DigitCard(
                                mode: mode, digit: digit, medal: model.bestMedal(mode, digit),
                                bestMs: model.best(mode, digit)?.bestMs, accent: accent)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("proving.digit.\(digit)")
                    }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Beat the clock:").font(.subheadline.bold())
                    Text("🥇 under \(ProvingStyle.threshold(s.medalSeconds.gold)) · perfect")
                    Text("🥈 under \(ProvingStyle.threshold(s.medalSeconds.silver)) · perfect")
                    Text("🥉 under \(ProvingStyle.threshold(s.medalSeconds.bronze)) · ^[\(s.maxWrongForBronze) slip](inflect: true) ok")
                }
                .font(.subheadline)
                .foregroundStyle(ProvingStyle.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(.white.opacity(0.7), in: .rect(cornerRadius: 14))
            }
        }
    }
}

private struct DigitCard: View {
    let mode: ProvingMode
    let digit: Int
    let medal: Medal?
    let bestMs: Int?
    let accent: Color

    var body: some View {
        VStack(spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(verbatim: "\(digit)").font(.system(size: 44, weight: .bold, design: .rounded))
                Text(mode.symbol).font(.title2.bold()).opacity(0.7)
            }
            .foregroundStyle(accent)
            Text("the \(digit)s").font(.subheadline).foregroundStyle(ProvingStyle.ink)
            Text(medal.map(ProvingStyle.icon) ?? "·").font(.title2)
            Text(bestMs.map { ProvingStyle.time(Double($0) / 1000) } ?? " ")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(.white, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(accent.opacity(0.4), lineWidth: 2))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: Text {
        var text = Text("the \(digit)s")
        if let medal {
            text = text + Text(", best: ") + Text(ProvingStyle.label(medal))
        }
        if let bestMs {
            text = text + Text(", fastest \(ProvingStyle.time(Double(bestMs) / 1000))")
        }
        return text
    }
}

// MARK: - The drill

private struct PlayScreen: View {
    let model: ProvingGroundsModel

    var body: some View {
        let accent = ProvingStyle.accent(model.mode)
        VStack(spacing: 16) {
            if let drill = model.drill, let fact = drill.current {
                HStack {
                    TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                        Label(ProvingStyle.time(model.elapsedSec()), systemImage: "stopwatch")
                            .monospacedDigit()
                    }
                    .accessibilityIdentifier("proving.timer")
                    Spacer()
                    Text(verbatim: "\(drill.index + 1) / \(drill.problems.count)").monospacedDigit()
                    Spacer()
                    Label { Text(verbatim: "\(drill.wrongCount)") } icon: { Image(systemName: "xmark") }
                        .foregroundStyle(drill.wrongCount > 0 ? .red : .secondary)
                }
                .font(.headline)
                .foregroundStyle(ProvingStyle.ink)

                ProgressView(value: Double(drill.index), total: Double(drill.problems.count))
                    .tint(accent)

                VStack(spacing: 12) {
                    Text(fact.prompt)
                        .font(.system(size: 56, weight: .bold, design: .rounded))
                        .accessibilityIdentifier("proving.prompt")
                    Text(model.input.isEmpty ? " " : model.input)
                        .font(.system(size: 44, weight: .semibold, design: .rounded).monospacedDigit())
                        .frame(minWidth: 120, minHeight: 64)
                        .background(accent.opacity(0.12), in: .rect(cornerRadius: 12))
                        .accessibilityIdentifier("proving.input")
                }
                .foregroundStyle(ProvingStyle.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
                .background(.white, in: .rect(cornerRadius: 20))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .strokeBorder(model.feedback.correct ? accent : .red, lineWidth: 3))
                .keyframeAnimator(initialValue: 1.0, trigger: model.feedback.id) { card, scale in
                    card.scaleEffect(scale)
                } keyframes: { _ in
                    SpringKeyframe(1.04, duration: 0.1)
                    SpringKeyframe(1.0, duration: 0.2)
                }
                .sensoryFeedback(trigger: model.feedback.id) { _, _ in
                    model.feedback.correct ? .success : .error
                }

                Spacer(minLength: 0)
                Numpad(accent: accent) { model.press($0) }
            }
        }
    }
}

private struct Numpad: View {
    let accent: Color
    let press: (ProvingGroundsModel.Key) -> Void

    private let rows: [[ProvingGroundsModel.Key]] = [
        [.digit(7), .digit(8), .digit(9)],
        [.digit(4), .digit(5), .digit(6)],
        [.digit(1), .digit(2), .digit(3)],
        [.delete, .digit(0), .ok],
    ]

    var body: some View {
        Grid(horizontalSpacing: 10, verticalSpacing: 10) {
            ForEach(rows, id: \.self) { row in
                GridRow {
                    ForEach(row, id: \.self) { key in
                        Button { press(key) } label: {
                            label(key)
                                .font(.system(size: 30, weight: .semibold, design: .rounded))
                                .frame(maxWidth: .infinity, minHeight: 60)
                                .foregroundStyle(key == .ok ? .white : ProvingStyle.ink)
                                .background(key == .ok ? accent : .white, in: .rect(cornerRadius: 14))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier(identifier(key))
                    }
                }
            }
        }
    }

    @ViewBuilder private func label(_ key: ProvingGroundsModel.Key) -> some View {
        switch key {
        case .digit(let d): Text(verbatim: "\(d)")
        case .delete: Image(systemName: "delete.left").accessibilityLabel("Delete")
        case .ok: Image(systemName: "checkmark").accessibilityLabel("Check answer")
        }
    }

    private func identifier(_ key: ProvingGroundsModel.Key) -> String {
        switch key {
        case .digit(let d): "proving.key.\(d)"
        case .delete: "proving.key.delete"
        case .ok: "proving.key.ok"
        }
    }
}

private struct CorrectionCard: View {
    let fact: ProvingFact
    let accent: Color

    var body: some View {
        ZStack {
            Color.black.opacity(0.25).ignoresSafeArea()
            VStack(spacing: 10) {
                Text("Not quite!").font(.headline).foregroundStyle(.secondary)
                (Text(verbatim: "\(fact.prompt) = ") + Text(verbatim: "\(fact.answer)").bold())
                    .font(.system(size: 40, design: .rounded))
                Text("remember this one!").font(.subheadline).foregroundStyle(.secondary)
            }
            .foregroundStyle(ProvingStyle.ink)
            .padding(32)
            .background(.white, in: .rect(cornerRadius: 24))
            .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(accent, lineWidth: 4))
            .padding()
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isModal)
        .accessibilityIdentifier("proving.correction")
    }
}

// MARK: - The result

private struct ResultScreen: View {
    let model: ProvingGroundsModel

    var body: some View {
        if let run = model.lastRun {
            let result = run.result
            let s = model.settings
            VStack(spacing: 16) {
                Text(result.medal.map(ProvingStyle.icon) ?? "💪")
                    .font(.system(size: 96))
                    .accessibilityHidden(true)
                Group {
                    if let medal = result.medal {
                        Text("\(Text(ProvingStyle.label(medal))) medal!")
                    } else {
                        Text("Keep practicing!")
                    }
                }
                .font(.largeTitle.bold())
                .accessibilityIdentifier("proving.result.heading")
                if result.medal != nil, run.isBestMedal {
                    Text("★ new personal best ★").font(.headline).foregroundStyle(.orange)
                } else if result.medal != nil, run.isBestTime {
                    Text("★ your fastest yet ★").font(.headline).foregroundStyle(.orange)
                }
                Text("\(Text(ProvingStyle.name(model.mode))) · the \(model.digit)s")
                    .foregroundStyle(.secondary)
                HStack(spacing: 24) {
                    stat(ProvingStyle.time(result.elapsedSec), "time")
                    stat("\(result.wrongCount)", "missed")
                }
                if let bestMs = model.best(model.mode, model.digit)?.bestMs {
                    Text("Best time: \(ProvingStyle.time(Double(bestMs) / 1000))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if result.medal == nil {
                    Group {
                        if result.wrongCount > s.maxWrongForBronze {
                            Text("^[\(s.wrongLimit) miss](inflect: true) ends the run. Try again!")
                        } else {
                            Text("Finish under \(ProvingStyle.threshold(s.medalSeconds.bronze)) with ^[\(s.maxWrongForBronze) slip](inflect: true) or fewer to earn a medal.")
                        }
                    }
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                }
                HStack(spacing: 12) {
                    Button("Try again") { model.retry() }
                        .buttonStyle(.borderedProminent)
                        .tint(ProvingStyle.accent(model.mode))
                        .accessibilityIdentifier("proving.retry")
                    Button("Pick another") { model.pickAnother() }
                        .buttonStyle(.bordered)
                }
                .controlSize(.large)
                .padding(.top, 8)
            }
            .foregroundStyle(ProvingStyle.ink)
        }
    }

    private func stat(_ value: String, _ label: LocalizedStringKey) -> some View {
        VStack {
            Text(value).font(.title.bold().monospacedDigit())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// The lair's Proving Grounds, for whoever is playing (the guest, or the kid
/// picked on the family picker); a child profile's medals upload through Sync.
struct ProvingGroundsEntry: View {
    @Environment(\.store) private var store
    @Environment(\.sync) private var sync
    @Environment(\.currentProfile) private var profile

    var body: some View {
        ProvingGroundsView(model: ProvingGroundsModel(store: store, profileID: profile?.id, sync: sync))
    }
}

#Preview {
    NavigationStack {
        ProvingGroundsView(model: ProvingGroundsModel(store: nil, profileID: nil, sync: nil))
    }
}
