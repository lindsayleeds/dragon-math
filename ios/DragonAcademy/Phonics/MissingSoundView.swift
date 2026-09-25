import Audio
import GameRules
import SwiftUI

/// Missing Sound's level picker: its own three levels rather than the eight
/// stages, since its words are hand-segmented (DragonPhonicsPage.jsx's
/// `LEGACY_MODE` section).
struct MissingSoundLevelPicker: View {
    @Binding var level: PhonicsLevel?

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 12)], spacing: 12) {
            ForEach(PhonicsLevel.all) { option in
                let on = level == option
                Button {
                    level = option
                } label: {
                    VStack(spacing: 6) {
                        Text(verbatim: option.emoji).font(.system(size: 34))
                        Text(verbatim: option.label).font(Typeface.display(22, relativeTo: .title3))
                        Text(verbatim: option.blurb)
                            .font(Typeface.body(15, relativeTo: .subheadline))
                            .foregroundStyle(Palette.pencil)
                            .multilineTextAlignment(.center)
                    }
                    .foregroundStyle(Palette.charcoal)
                    .frame(maxWidth: .infinity, minHeight: 140)
                    .padding(14)
                    .background(on ? Palette.sage.opacity(0.35) : Palette.cardTop)
                    .overlay(
                        Rectangle().strokeBorder(on ? Palette.charcoal : Palette.kraft.opacity(0.6), lineWidth: on ? 2 : 1.5))
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("phonics.level.\(option.key)")
            }
        }
    }
}

/// One round of Missing Sound: the SwiftUI twin of
/// src/components/DragonPhonics.jsx. The word is spoken whole (its spelling
/// clip, or the device voice); each tile has an "as in …" example to hear.
struct MissingSoundGameView: View {
    @State private var model: MissingSoundModel
    var exit: () -> Void

    @Environment(\.audio) private var audio
    @State private var voice = PhonicsWordVoice()

    init(model: MissingSoundModel, exit: @escaping () -> Void) {
        _model = State(initialValue: model)
        self.exit = exit
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
        }
        // Each new word is spoken once; replay is the button.
        .task(id: model.promptID) {
            guard model.phase == .play, let item = model.current else { return }
            await voice.say(item.entry.word, audio: audio)
        }
        .onChange(of: model.results.count) { _, count in
            guard count > 0, let last = model.results.last else { return }
            audio?.play(last.correct ? .correct : .wrong)
        }
        .onChange(of: model.phase) { _, phase in
            if phase == .done && model.total > 0 && model.correctCount == model.total { audio?.play(.correct) }
        }
        .onDisappear {
            audio?.stopSpeaking()
            voice.stop()
        }
    }

    @ViewBuilder private var content: some View {
        if model.phase == .done {
            MissingSoundEndCard(model: model, exit: exit)
        } else if let item = model.current {
            VStack(spacing: 22) {
                header
                Button {
                    Task { await voice.say(item.entry.word, audio: audio) }
                } label: {
                    Label("Hear the word", systemImage: "speaker.wave.2.fill")
                        .font(Typeface.display(24, relativeTo: .title3))
                }
                .buttonStyle(StampButtonStyle())
                .accessibilityLabel(Text("Hear the word again"))
                .accessibilityIdentifier("phonics.hear")

                wordRow(item)

                if let result = model.lastResult {
                    feedback(result)
                } else {
                    optionRow(item.options)
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button("← Quit", action: exit)
                .font(Typeface.body(15, relativeTo: .callout))
                .foregroundStyle(Palette.charcoal)
                .accessibilityIdentifier("phonics.quit")
            VStack(alignment: .leading, spacing: 4) {
                Text("Word \(min(model.index + 1, model.total)) of \(model.total)")
                    .font(Typeface.body(14, relativeTo: .caption))
                    .foregroundStyle(Palette.kraftDark)
                    .accessibilityIdentifier("phonics.progress")
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(.white.opacity(0.5))
                        Rectangle()
                            .fill(Palette.sage)
                            .frame(width: geo.size.width * CGFloat(model.index) / CGFloat(max(1, model.total)))
                    }
                    .overlay(Rectangle().strokeBorder(Palette.charcoal.opacity(0.5), lineWidth: 1))
                }
                .frame(height: 10)
                .accessibilityHidden(true)
            }
            Text(verbatim: "\(model.level.emoji) \(model.correctCount) ✓")
                .font(Typeface.display(18, relativeTo: .headline))
                .foregroundStyle(Palette.charcoal)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Palette.sage.opacity(0.35), in: Capsule())
                .accessibilityLabel(Text("\(model.correctCount) right"))
        }
    }

    /// The word with its blank; in the feedback the blank fills with the
    /// answer so the kid sees the whole word.
    private func wordRow(_ item: MissingSoundModel.Item) -> some View {
        let result = model.lastResult
        return HStack(spacing: 6) {
            ForEach(Array(item.entry.graphemes.enumerated()), id: \.offset) { i, grapheme in
                if i == item.entry.blank {
                    Text(verbatim: result == nil ? "?" : item.entry.answer)
                        .font(Typeface.display(44, relativeTo: .largeTitle))
                        .foregroundStyle(result == nil ? Palette.kraftDark : result!.correct ? Palette.sageInk : Palette.roseInk)
                        .frame(minWidth: 64, minHeight: 72)
                        .background(result == nil ? Color.white.opacity(0.5) : result!.correct ? Palette.sage.opacity(0.3) : Palette.rose.opacity(0.25))
                        .overlay(Rectangle().strokeBorder(style: StrokeStyle(lineWidth: 2, dash: result == nil ? [6, 4] : [])))
                } else {
                    Text(verbatim: grapheme)
                        .font(Typeface.display(44, relativeTo: .largeTitle))
                        .frame(minWidth: 52, minHeight: 72)
                        .paperCard()
                }
            }
        }
        .foregroundStyle(Palette.charcoal)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(result == nil ? Text("Tap the missing sound below") : Text("The word is \(item.entry.word)"))
        .accessibilityIdentifier("phonics.word")
    }

    private func optionRow(_ options: [String]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 12)], spacing: 12) {
            ForEach(options, id: \.self) { option in
                let cue = PhonicsWords.cueWord(for: option)
                VStack(spacing: 6) {
                    Button {
                        model.tap(option)
                    } label: {
                        Text(verbatim: option)
                            .font(Typeface.display(40, relativeTo: .largeTitle))
                            .foregroundStyle(Palette.charcoal)
                            .frame(maxWidth: .infinity, minHeight: 90)
                            .paperCard()
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Choose \(option), as in \(cue)"))
                    .accessibilityIdentifier("phonics.option.\(option)")
                    if !cue.isEmpty {
                        Button {
                            Task { await voice.synthesize(cue) }
                        } label: {
                            Label {
                                Text("as in \(cue)")
                            } icon: {
                                Image(systemName: "speaker.wave.2.fill")
                            }
                            .font(Typeface.body(15, relativeTo: .caption))
                            .foregroundStyle(Palette.kraftDark)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Hear \(cue), the example for \(option)"))
                        .accessibilityIdentifier("phonics.cue.\(option)")
                    }
                }
            }
        }
    }

    private func feedback(_ result: MissingSoundModel.Result) -> some View {
        VStack(spacing: 10) {
            Text(verbatim: result.correct ? "✓" : "✗")
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(result.correct ? Palette.sageInk : Palette.roseInk)
                .accessibilityLabel(result.correct ? Text("Right!") : Text("Not quite!"))
            Text(verbatim: result.item.entry.word).font(Typeface.display(36, relativeTo: .largeTitle))
            if !result.correct {
                Text("you tapped: \(result.chosen)")
                    .font(Typeface.body(16, relativeTo: .body))
                    .foregroundStyle(Palette.roseInk)
            }
            Button {
                model.next()
            } label: {
                Text(result.correct ? "OK! 🎉" : "Got it")
            }
            .buttonStyle(StampButtonStyle())
            .accessibilityIdentifier("phonics.next")
        }
        .foregroundStyle(Palette.charcoal)
        .frame(maxWidth: .infinity)
        .padding(20)
        .paperCard(rotation: -0.4)
        .overlay(alignment: .top) { WashiTape(color: result.correct ? Palette.sage : Palette.rose).offset(y: -9) }
    }
}

private struct MissingSoundEndCard: View {
    let model: MissingSoundModel
    var exit: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Text(verbatim: "🐲").font(.system(size: 56)).accessibilityHidden(true)
            Text(model.correctCount == model.total ? "Perfect ear!" : "Great listening!")
                .font(Typeface.display(34, relativeTo: .largeTitle))
            Text("You found \(model.correctCount) of \(model.total) sounds.")
                .font(Typeface.body(18, relativeTo: .body))
                .accessibilityIdentifier("phonics.score")
            Text(verbatim: String(repeating: "★", count: model.stars) + String(repeating: "☆", count: 5 - model.stars))
                .font(.system(size: 30))
                .foregroundStyle(Palette.mustard)
                .accessibilityHidden(true)
            if let best = model.best {
                Group {
                    if model.isNewBest {
                        Text("🏆 New best! \(best) / \(model.total)")
                    } else {
                        Text("Best: \(best) / \(model.total)")
                    }
                }
                .font(Typeface.body(16, relativeTo: .body))
                .foregroundStyle(Palette.kraftDark)
                .accessibilityIdentifier("phonics.best")
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(model.results.enumerated()), id: \.offset) { _, result in
                    HStack(spacing: 10) {
                        Text(verbatim: result.correct ? "✓" : "✗")
                            .foregroundStyle(result.correct ? Palette.sageInk : Palette.roseInk)
                        Text(verbatim: result.item.entry.word).font(Typeface.display(20, relativeTo: .headline))
                        Spacer()
                    }
                    .font(Typeface.body(16, relativeTo: .body))
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(14)
            .background(.white.opacity(0.35))
            HStack(spacing: 14) {
                Button("↻ play again") { model.playAgain() }
                    .buttonStyle(StampButtonStyle())
                    .accessibilityIdentifier("phonics.playAgain")
                Button("Choose level", action: exit)
                    .buttonStyle(StampButtonStyle(kind: .secondary))
                    .accessibilityIdentifier("phonics.done")
            }
        }
        .foregroundStyle(Palette.charcoal)
        .frame(maxWidth: .infinity)
        .padding(20)
        .paperCard()
    }
}
