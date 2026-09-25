import AVFoundation
import GameRules
import Store
import Sync
import SwiftUI

/// Dragon Phonics from the Learning Lair, for whoever is playing (the guest,
/// or the kid picked on the family picker): pick a game, then the sounds, then
/// play — the flow of src/pages/DragonPhonicsPage.jsx. The first two games are
/// here, Sound Match and Sound Spell; a child profile's answers upload through
/// Sync. The web's Sound Map tab and the mastery counts on the stage cards
/// need the server's mastery, which the app doesn't read yet.
struct PhonicsEntry: View {
    @Environment(\.store) private var store
    @Environment(\.sync) private var sync
    @Environment(\.currentProfile) private var profile
    @Environment(\.dismiss) private var dismiss

    @State private var mode: PhonicsRoundMode?
    @State private var stages: PhonicsStages?
    @State private var game: PhonicsModel?

    /// The games built on iOS so far, in the web picker's order.
    static let modes: [PhonicsRoundMode] = [.choose, .typeIt]

    var body: some View {
        Group {
            if let game {
                PhonicsGameView(model: game) { self.game = nil }
            } else {
                picker
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
    }

    private var picker: some View {
        ZStack {
            PaperBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button {
                        if mode != nil {
                            mode = nil
                            stages = nil
                        } else {
                            dismiss()
                        }
                    } label: {
                        Text("← back")
                    }
                    .buttonStyle(StampButtonStyle(kind: .secondary))
                    .accessibilityIdentifier("phonics.back")

                    HStack(spacing: 8) {
                        Text(verbatim: "🐲").font(.system(size: 34)).accessibilityHidden(true)
                        Text("Dragon Phonics")
                            .font(Typeface.display(36, relativeTo: .largeTitle))
                            .rotationEffect(.degrees(-1))
                    }
                    .foregroundStyle(Palette.charcoal)

                    if let mode, let info = PhonicsMode.named(mode.rawValue) {
                        stagePicker(info)
                    } else {
                        modePicker
                    }
                }
                .frame(maxWidth: 720, alignment: .leading)
                .padding(20)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var modePicker: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Pick a game")
                .font(Typeface.display(26, relativeTo: .title2))
                .foregroundStyle(Palette.charcoal)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 16)], spacing: 16) {
                ForEach(Self.modes, id: \.self) { mode in
                    if let info = PhonicsMode.named(mode.rawValue) {
                        Button {
                            self.mode = mode
                            stages = nil
                        } label: {
                            VStack(spacing: 6) {
                                Text(verbatim: info.emoji).font(.system(size: 40))
                                HStack(spacing: 6) {
                                    Text(verbatim: info.name).font(Typeface.display(24, relativeTo: .title3))
                                    Text(verbatim: info.difficulty)
                                        .font(Typeface.body(13, relativeTo: .caption))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 2)
                                        .background(Palette.mustard.opacity(0.35), in: Capsule())
                                }
                                Text(verbatim: info.blurb)
                                    .font(Typeface.body(15, relativeTo: .subheadline))
                                    .foregroundStyle(Palette.pencil)
                                    .multilineTextAlignment(.center)
                            }
                            .phonicsCard(accent: Palette.lavender)
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("phonics.mode.\(mode.rawValue)")
                    }
                }
            }
            Text("A sound counts as mastered once you get it right in two different games — so it is worth playing more than one.")
                .font(Typeface.body(15, relativeTo: .footnote))
                .foregroundStyle(Palette.kraftDark)
        }
    }

    private func stagePicker(_ info: PhonicsMode) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(verbatim: info.name)
                .font(Typeface.display(26, relativeTo: .title2))
                .foregroundStyle(Palette.charcoal)
            Text(verbatim: info.blurb)
                .font(Typeface.body(16, relativeTo: .body))
                .foregroundStyle(Palette.pencil)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                stageButton(
                    .all, emoji: "🌍", name: Text("Everything"), meta: Text("all \(PhonicsElement.all.count) sounds"),
                    id: "all")
                ForEach(PhonicsStage.all) { stage in
                    stageButton(
                        .stage(stage.stage), emoji: stage.emoji, name: Text(verbatim: stage.label),
                        meta: Text("\(stage.elements.count) sounds"), id: "\(stage.stage)")
                }
            }
            Button {
                guard let mode, let stages else { return }
                game = PhonicsModel(mode: mode, stages: stages, store: store, profileID: profile?.id, sync: sync)
            } label: {
                Text("Start listening →")
            }
            .buttonStyle(StampButtonStyle())
            .disabled(stages == nil)
            .opacity(stages == nil ? 0.5 : 1)
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
            .accessibilityIdentifier("phonics.start")
        }
    }

    private func stageButton(_ value: PhonicsStages, emoji: String, name: Text, meta: Text, id: String) -> some View {
        let on = stages == value
        return Button {
            stages = value
        } label: {
            VStack(spacing: 4) {
                Text(verbatim: emoji).font(.system(size: 28))
                name.font(Typeface.display(19, relativeTo: .headline)).multilineTextAlignment(.center)
                meta.font(Typeface.body(13, relativeTo: .caption)).foregroundStyle(Palette.kraftDark)
            }
            .foregroundStyle(Palette.charcoal)
            .frame(maxWidth: .infinity, minHeight: 104)
            .padding(10)
            .background(on ? Palette.sage.opacity(0.35) : Palette.cardTop)
            .overlay(Rectangle().strokeBorder(on ? Palette.charcoal : Palette.kraft.opacity(0.6), lineWidth: on ? 2 : 1.5))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("phonics.stage.\(id)")
    }
}

// MARK: - The game

/// One round of Sound Match or Sound Spell: the SwiftUI twin of
/// src/components/PhonicsGame.jsx. Each sound is its recorded clip
/// (`phonics/<key>.mp3`), played with `audio.speak`.
///
/// No hint during play, as on the web: "hear it in a word" is only offered in
/// the feedback, since hearing /sh/ in "ship" makes the question easier.
struct PhonicsGameView: View {
    @State private var model: PhonicsModel
    var exit: () -> Void

    @Environment(\.audio) private var audio
    @State private var typed = ""
    @State private var voice = AVSpeechSynthesizer()
    @FocusState private var typing: Bool

    init(model: PhonicsModel, exit: @escaping () -> Void) {
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
        // Each new question plays its sound once; replay is the button.
        .task(id: model.promptID) {
            guard model.phase == .play else { return }
            await playPrompt()
        }
        .onChange(of: model.results.count) { _, count in
            guard count > 0, let last = model.results.last else { return }
            if last.correct {
                audio?.play(.correct)
            } else {
                audio?.play(.wrong)
                // The teaching moment: the sound inside a real word.
                Task { await playInWord(last.item) }
            }
        }
        .onDisappear {
            audio?.stopSpeaking()
            voice.stopSpeaking(at: .immediate)
        }
    }

    @ViewBuilder private var content: some View {
        if model.phase == .done {
            PhonicsEndCard(model: model, exit: exit)
        } else if let item = model.current {
            VStack(spacing: 22) {
                header
                Button {
                    Task { await playPrompt() }
                } label: {
                    Label("Hear the sound", systemImage: "speaker.wave.2.fill")
                        .font(Typeface.display(24, relativeTo: .title3))
                }
                .buttonStyle(StampButtonStyle())
                .accessibilityLabel(Text("Hear the sound again"))
                .accessibilityIdentifier("phonics.hear")

                Text(model.mode == .typeIt ? "Type the letters that make this sound." : "Which letters make this sound?")
                    .font(Typeface.body(18, relativeTo: .headline))
                    .foregroundStyle(Palette.pencil)
                    .multilineTextAlignment(.center)

                if let result = model.lastResult {
                    PhonicsFeedbackCard(result: result, hearInWord: { Task { await playInWord(result.item) } }) {
                        typed = ""
                        model.next()
                        if model.mode == .typeIt && model.phase == .play { typing = true }
                    }
                } else if model.mode == .typeIt {
                    typeForm
                } else if let options = item.options {
                    optionRow(options)
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
                Text("Sound \(min(model.index + 1, model.total)) of \(model.total)")
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
            Text(verbatim: "\(model.correctCount) ✓")
                .font(Typeface.display(18, relativeTo: .headline))
                .foregroundStyle(Palette.charcoal)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Palette.sage.opacity(0.35), in: Capsule())
                .accessibilityLabel(Text("\(model.correctCount) right"))
        }
    }

    private func optionRow(_ options: [PhonicsElement]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 12)], spacing: 12) {
            ForEach(options) { option in
                Button {
                    model.tap(option)
                } label: {
                    VStack(spacing: 2) {
                        Text(verbatim: option.g).font(Typeface.display(40, relativeTo: .largeTitle))
                        Text(verbatim: option.sound)
                            .font(Typeface.body(15, relativeTo: .caption))
                            .foregroundStyle(Palette.kraftDark)
                    }
                    .foregroundStyle(Palette.charcoal)
                    .frame(maxWidth: .infinity, minHeight: 100)
                    .paperCard()
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: option.g))
                .accessibilityIdentifier("phonics.option.\(option.key)")
            }
        }
    }

    private var typeForm: some View {
        HStack(spacing: 12) {
            TextField(text: $typed, prompt: Text(verbatim: "?")) {
                Text("Type the letters that make this sound.")
            }
            .font(Typeface.display(36, relativeTo: .largeTitle))
            .multilineTextAlignment(.center)
            // Phone keyboards "help" in ways that break a phonics answer:
            // autocorrect turns `br` into `be`, capitals look like another answer.
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.asciiCapable)
            .submitLabel(.done)
            .focused($typing)
            .onChange(of: typed) { _, value in
                let cleaned = String(value.filter { $0.isASCII && ($0.isLetter || $0 == "_" || $0 == "-") }.prefix(5))
                if cleaned != value { typed = cleaned }
            }
            .onSubmit(check)
            .frame(maxWidth: 200)
            .padding(.vertical, 8)
            .paperCard()
            .accessibilityIdentifier("phonics.typed")
            Button("Check", action: check)
                .buttonStyle(StampButtonStyle())
                .disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("phonics.check")
        }
        .onAppear { typing = true }
    }

    private func check() {
        guard !typed.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        model.submit(typed: typed)
    }

    // MARK: - Sound

    /// The current sound's clip; with no clip (it never should be missing),
    /// its first example word, the web's fallback.
    private func playPrompt() async {
        guard let item = model.current else { return }
        model.promptStarted()
        if let url = PhonicsClips.url(for: item.element.key) {
            try? await audio?.speak(url)
        } else if let word = item.element.words.first {
            say(word)
        }
        model.promptFinished()
    }

    /// "/sh/ … ship": the clip, a beat, then the example word.
    private func playInWord(_ item: PhonicsItem) async {
        if let url = PhonicsClips.url(for: item.element.key) {
            try? await audio?.speak(url)
            try? await Task.sleep(for: .milliseconds(350))
        }
        say(PhonicsModel.example(for: item))
    }

    private func say(_ word: String) {
        voice.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: word)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.85
        voice.speak(utterance)
    }
}

/// The whole truth of the item after an answer: the letters, the sound, what
/// the kid said, and an example word with the letters picked out.
private struct PhonicsFeedbackCard: View {
    let result: PhonicsModel.Result
    var hearInWord: () -> Void
    var next: () -> Void

    var body: some View {
        let element = result.item.element
        let example = PhonicsModel.example(for: result.item)
        VStack(spacing: 10) {
            Text(verbatim: result.correct ? "✓" : "✗")
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(result.correct ? Palette.sage : Palette.rose)
                .accessibilityLabel(result.correct ? Text("Right!") : Text("Not quite!"))
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: element.g).font(Typeface.display(40, relativeTo: .largeTitle))
                Text(verbatim: element.sound).font(Typeface.body(18, relativeTo: .body)).foregroundStyle(Palette.kraftDark)
            }
            if !result.correct {
                Text("you said: \(result.said ?? "—")")
                    .font(Typeface.body(16, relativeTo: .body))
                    .foregroundStyle(Palette.rose)
            }
            Text("as in \(highlighted(example, element: element))")
                .font(Typeface.body(18, relativeTo: .body))
            if !element.note.isEmpty {
                Text(verbatim: element.note)
                    .font(Typeface.body(15, relativeTo: .footnote))
                    .foregroundStyle(Palette.pencil)
            }
            Button(action: hearInWord) {
                Label("hear it in the word", systemImage: "speaker.wave.2.fill")
                    .font(Typeface.body(16, relativeTo: .callout))
            }
            .buttonStyle(StampButtonStyle(kind: .secondary))
            .accessibilityIdentifier("phonics.hearInWord")
            Button(action: next) {
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

    private func highlighted(_ word: String, element: PhonicsElement) -> AttributedString {
        guard let parts = PhonicsModel.highlight(word, element: element) else {
            var plain = AttributedString(word)
            plain.inlinePresentationIntent = .stronglyEmphasized
            return plain
        }
        var match = AttributedString(parts.match)
        match.backgroundColor = Palette.mustard.opacity(0.5)
        var whole = AttributedString(parts.before) + match + AttributedString(parts.after)
        whole.inlinePresentationIntent = .stronglyEmphasized
        return whole
    }
}

private struct PhonicsEndCard: View {
    let model: PhonicsModel
    var exit: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Text(verbatim: "🐲").font(.system(size: 56)).accessibilityHidden(true)
            Text(model.correctCount == model.total ? "Perfect ear!" : "Great listening!")
                .font(Typeface.display(34, relativeTo: .largeTitle))
            Text("You got \(model.correctCount) of \(model.total) sounds.")
                .font(Typeface.body(18, relativeTo: .body))
                .accessibilityIdentifier("phonics.score")
            Text(verbatim: String(repeating: "★", count: model.stars) + String(repeating: "☆", count: 5 - model.stars))
                .font(.system(size: 30))
                .foregroundStyle(Palette.mustard)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(model.results.enumerated()), id: \.offset) { _, result in
                    HStack(spacing: 10) {
                        Text(verbatim: result.correct ? "✓" : "✗")
                            .foregroundStyle(result.correct ? Palette.sage : Palette.rose)
                        Text(verbatim: result.item.element.g).font(Typeface.display(20, relativeTo: .headline))
                        Text(verbatim: result.item.element.sound).foregroundStyle(Palette.kraftDark)
                        if !result.correct {
                            Text("you said: \(result.said ?? "—")").foregroundStyle(Palette.rose)
                        }
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
                Button("Done", action: exit)
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

private extension View {
    /// A mode card: cream paper with an accent tape strip.
    func phonicsCard(accent: Color) -> some View {
        self
            .foregroundStyle(Palette.charcoal)
            .frame(maxWidth: .infinity, minHeight: 150)
            .padding(14)
            .paperCard()
            .overlay(alignment: .top) { WashiTape(color: accent).offset(y: -9) }
    }
}
