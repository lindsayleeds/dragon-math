import Audio
import GameRules
import OSLog
import Store
import SwiftUI
import Sync

/// Dragon Spelling from the Learning Lair: the picker (a grade or one of the
/// kid's own lists, a difficulty), then a game, and back to the picker when it
/// ends — the SwiftUI side of src/pages/DragonSpellingPage.jsx. The back tab
/// steps out to the lair.
///
/// The built-in grade catalogs' clips are bundled, so they work offline. A
/// child's own lists (made by a grown-up on the web) sync with their clips
/// (#161) and show only once every clip is on the device; the picker reads
/// them again after each sync.
struct SpellingEntry: View {
    @Environment(\.store) private var store
    @Environment(\.sync) private var sync
    @Environment(\.spellingLists) private var spellingLists
    @Environment(\.currentProfile) private var profile
    @Environment(\.audio) private var audio
    @Environment(\.dismiss) private var dismiss

    @State private var pick: SpellingPick?
    @State private var lists: [SyncedSpellingList] = []
    @State private var difficulty: SpellingDifficulty?
    @State private var model: SpellingModel?

    private static let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Spelling")

    var body: some View {
        Group {
            if let model {
                SpellingGameView(model: model) {
                    model.leave()
                    audio?.stopSpeaking()
                    self.model = nil
                }
            } else {
                SpellingPicker(pick: $pick, lists: lists, difficulty: $difficulty, start: start, back: { dismiss() })
            }
        }
        .task(id: profile?.remoteID) { await watchLists() }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .onDisappear {
            model?.leave()
            audio?.stopSpeaking()
        }
    }

    /// Reads the kid's playable lists now and after every sync.
    private func watchLists() async {
        await loadLists()
        guard let sync else { return }
        for await _ in await sync.reports() {
            await loadLists()
        }
    }

    private func loadLists() async {
        guard let spellingLists, let childID = profile?.remoteID else {
            lists = []
            return
        }
        let ready = await spellingLists.lists(for: childID)
        lists = ready
        // A list picked before it changed plays as it is now, or not at all.
        if case .list(let picked) = pick {
            pick = ready.first { $0.id == picked.id }.map(SpellingPick.list)
        }
    }

    private func start() {
        guard let pick, let difficulty else { return }
        let audio = audio, store = store, profileID = profile?.id
        model = SpellingModel(
            pick: pick, difficulty: difficulty, store: store, profileID: profileID, sync: sync,
            speak: { word in await Self.say(word, clip: pick.clipURL(for: word), with: audio) },
            playSound: { audio?.play($0) },
            prizeContext: { await PrizeContext.load(from: store, for: profileID) })
    }

    /// Plays a word's clip through the silent switch. Every grade word has a
    /// bundled one (a test checks the bundle) and a list shows only once all of
    /// its clips downloaded; the plan is recorded clips only, no device voice,
    /// so a missing one is logged and stays quiet.
    static func say(_ word: String, clip: URL?, with audio: AudioPlayer?) async {
        guard let url = clip else {
            log.fault("No spelling clip for \(word, privacy: .public)")
            return
        }
        do {
            try await audio?.speak(url)
        } catch {
            log.error("Couldn't play the clip for \(word, privacy: .public): \(error)")
        }
    }
}

extension SpellingDifficulty {
    var emoji: String {
        switch self {
        case .easy: "🌱"
        case .medium: "🌟"
        case .hard: "🔥"
        }
    }

    var label: Text {
        switch self {
        case .easy: Text("Easy")
        case .medium: Text("Medium")
        case .hard: Text("Hard")
        }
    }

    var blurb: Text {
        switch self {
        case .easy: Text("Tap the letters into order — ask for a hint if you need one.")
        case .medium: Text("The word flashes once, then you type it — hints are there if needed.")
        case .hard: Text("Listen and type — ask for a hint if you get stuck.")
        }
    }
}

// MARK: - Picker

private struct SpellingPicker: View {
    @Binding var pick: SpellingPick?
    /// The kid's own lists that are ready to play.
    var lists: [SyncedSpellingList]
    @Binding var difficulty: SpellingDifficulty?
    var start: () -> Void
    var back: () -> Void

    var body: some View {
        ZStack {
            PaperBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Button(action: back) { Text("← back") }
                        .buttonStyle(StampButtonStyle(kind: .secondary))
                        .accessibilityIdentifier("spelling.back")
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 8) {
                            Text(verbatim: "🐲").font(.system(size: 34)).accessibilityHidden(true)
                            Text("Dragon Spelling")
                                .font(Typeface.display(36, relativeTo: .largeTitle))
                                .rotationEffect(.degrees(-1))
                        }
                        Text("listen to the word, then spell it")
                            .font(Typeface.body(18, relativeTo: .headline))
                            .foregroundStyle(Palette.pencil)
                    }
                    .foregroundStyle(Palette.charcoal)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)

                    section(Text("Pick a grade")) {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 12)], spacing: 12) {
                            ForEach(SpellingGrade.all) { g in
                                let on = pick == .grade(g)
                                Button { pick = .grade(g) } label: {
                                    VStack(spacing: 2) {
                                        Text(verbatim: "\(g.grade)")
                                            .font(Typeface.display(34, relativeTo: .title))
                                        Text(verbatim: g.label)
                                            .font(Typeface.body(14, relativeTo: .caption))
                                    }
                                    .foregroundStyle(on ? Palette.cardTop : Palette.charcoal)
                                    .frame(maxWidth: .infinity, minHeight: 84)
                                    // Sage ink: cream on crayon sage is 2.7:1.
                                    .background(on ? Palette.sageInk : Palette.cardTop)
                                    .overlay(Rectangle().strokeBorder(on ? Palette.kraftDark : Palette.kraft, lineWidth: 2))
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(on ? .isSelected : [])
                                .accessibilityLabel(Text(verbatim: g.label))
                                .accessibilityIdentifier("spelling.grade.\(g.grade)")
                            }
                        }
                    }

                    if !lists.isEmpty {
                        section(Text("Or one of your lists")) {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                                ForEach(lists) { list in
                                    let on = pick == .list(list)
                                    Button { pick = .list(list) } label: {
                                        VStack(spacing: 2) {
                                            Text(verbatim: list.name)
                                                .font(Typeface.display(20, relativeTo: .title3))
                                                .multilineTextAlignment(.center)
                                            Text("\(list.words.count) words")
                                                .font(Typeface.body(14, relativeTo: .caption))
                                        }
                                        .foregroundStyle(on ? Palette.cardTop : Palette.charcoal)
                                        .padding(8)
                                        .frame(maxWidth: .infinity, minHeight: 84)
                                        .background(on ? Palette.sageInk : Palette.cardTop)
                                        .overlay(Rectangle().strokeBorder(on ? Palette.kraftDark : Palette.kraft, lineWidth: 2))
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityElement(children: .combine)
                                    .accessibilityAddTraits(on ? .isSelected : [])
                                    .accessibilityIdentifier("spelling.list.\(list.id)")
                                }
                            }
                        }
                    }

                    section(Text("Pick a difficulty")) {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 12)], spacing: 12) {
                            ForEach(SpellingDifficulty.allCases) { d in
                                let on = difficulty == d
                                Button { difficulty = d } label: {
                                    VStack(spacing: 6) {
                                        Text(verbatim: d.emoji).font(.system(size: 30)).accessibilityHidden(true)
                                        d.label.font(Typeface.display(22, relativeTo: .title3))
                                        d.blurb
                                            .font(Typeface.body(14, relativeTo: .caption))
                                            .foregroundStyle(Palette.pencil)
                                            .multilineTextAlignment(.center)
                                    }
                                    .foregroundStyle(Palette.charcoal)
                                    .padding(12)
                                    .frame(maxWidth: .infinity, minHeight: 140)
                                    .background(on ? Palette.sky : Palette.cardTop)
                                    .overlay(Rectangle().strokeBorder(on ? Palette.kraftDark : Palette.kraft, lineWidth: 2))
                                }
                                .buttonStyle(.plain)
                                .accessibilityElement(children: .combine)
                                .accessibilityAddTraits(on ? .isSelected : [])
                                .accessibilityIdentifier("spelling.difficulty.\(d.rawValue)")
                            }
                        }
                    }

                    Button(action: start) { Text("Start spelling →") }
                        .buttonStyle(StampButtonStyle())
                        .disabled(pick == nil || difficulty == nil)
                        .opacity(pick == nil || difficulty == nil ? 0.5 : 1)
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("spelling.start")
                }
                .padding(16)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func section(_ heading: Text, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            heading
                .font(Typeface.display(22, relativeTo: .title3))
                .foregroundStyle(Palette.kraftDark)
                .accessibilityAddTraits(.isHeader)
            content()
        }
    }
}

// MARK: - Game

struct SpellingGameView: View {
    let model: SpellingModel
    var quit: () -> Void

    var body: some View {
        ZStack {
            PaperBackground()
            ScrollView {
                Group {
                    if model.phase == .done {
                        SpellingEndCard(model: model, done: quit)
                    } else {
                        VStack(spacing: 20) {
                            header
                            stage
                        }
                    }
                }
                .padding(16)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            if model.difficulty.usesTiles, model.peeking, model.phase == .spell, let word = model.word {
                PeekCard(word: word) { model.endPeek() }
                    .transition(.opacity)
            }
        }
        .animation(.snappy, value: model.phase)
        .animation(.easeOut(duration: 0.2), value: model.peeking)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button(action: quit) { Text("← Quit") }
                .buttonStyle(StampButtonStyle(kind: .secondary))
                .accessibilityIdentifier("spelling.quit")
            VStack(alignment: .leading, spacing: 4) {
                Text("\(model.pick.label) · word \(model.wordNumber) of \(model.words.count)")
                    .font(Typeface.body(14, relativeTo: .caption))
                    .foregroundStyle(Palette.pencil)
                    .accessibilityIdentifier("spelling.progress")
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.paperDeep)
                        Capsule().fill(Palette.sage)
                            .frame(width: geo.size.width * CGFloat(model.index) / CGFloat(max(1, model.words.count)))
                    }
                }
                .frame(height: 10)
                .animation(.easeOut(duration: 0.3), value: model.index)
                .accessibilityHidden(true)
            }
            Text(verbatim: "\(model.difficulty.emoji) \(model.correctCount) ✓")
                .font(Typeface.display(18, relativeTo: .headline))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Palette.cardTop, in: Capsule())
                .overlay(Capsule().strokeBorder(Palette.kraft, lineWidth: 1.5))
                .accessibilityLabel(Text("\(model.correctCount) right"))
        }
        .foregroundStyle(Palette.charcoal)
    }

    @ViewBuilder private var stage: some View {
        if let word = model.word {
            VStack(spacing: 18) {
                Button { model.sayWord() } label: {
                    Label { Text("Hear the word") } icon: { Text(verbatim: "🔊") }
                        .font(Typeface.display(22, relativeTo: .title3))
                        .foregroundStyle(Palette.charcoal)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 12)
                        .background(Palette.sky, in: Capsule())
                        .overlay(Capsule().strokeBorder(Palette.charcoal, lineWidth: 2))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Hear the word again"))
                .accessibilityIdentifier("spelling.hear")

                if model.phase == .flash {
                    VStack(spacing: 6) {
                        Text("Look closely…")
                            .font(Typeface.body(16, relativeTo: .callout))
                            .foregroundStyle(Palette.pencil)
                        Text(verbatim: word)
                            .font(Typeface.display(44, relativeTo: .largeTitle))
                            .accessibilityIdentifier("spelling.flashWord")
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity)
                    .paperCard(rotation: -0.5)
                }

                if !model.difficulty.usesTiles, model.phase == .spell {
                    firstLetterHint(word)
                }

                if model.phase == .feedback {
                    feedback(word)
                } else if model.difficulty.usesTiles {
                    SpellingTileArea(model: model, word: word)
                } else {
                    // Shown while Medium flashes the word too, so nothing
                    // jumps; its keys only type once the word is hidden.
                    SpellingKeyboardArea(model: model)
                }
            }
            .foregroundStyle(Palette.charcoal)
        }
    }

    private func firstLetterHint(_ word: String) -> some View {
        VStack(spacing: 8) {
            Button { model.toggleHint() } label: {
                Text(model.showHint ? "Hide hint" : "💡 Show hint")
                    .font(Typeface.body(16, relativeTo: .callout))
                    .foregroundStyle(Palette.kraftDark)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Palette.cardTop, in: Capsule())
                    .overlay(Capsule().strokeBorder(Palette.kraft, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("spelling.hint")
            if model.showHint, let first = word.first {
                Text("starts with “\(String(first))” · \(word.count) letters")
                    .font(Typeface.body(16, relativeTo: .callout))
                    .foregroundStyle(Palette.pencil)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 5)
                    .background(Palette.paperDeep, in: Capsule())
                    .accessibilityIdentifier("spelling.hintText")
            }
        }
    }

    private func feedback(_ word: String) -> some View {
        let right = model.lastCorrect
        return VStack(spacing: 10) {
            AnswerFeedbackMark(feedback: right ? .correct : .tryAgain, size: 40)
                .accessibilityHidden(true)
            Text(verbatim: word)
                .font(Typeface.display(40, relativeTo: .largeTitle))
                .accessibilityIdentifier("spelling.feedbackWord")
            if !right {
                let wrote = model.answer.isEmpty ? "—" : model.answer
                Text("you wrote: \(wrote)")
                    .font(Typeface.body(17, relativeTo: .callout))
                    .foregroundStyle(Palette.pencil)
            }
            Button { model.advance() } label: { right ? Text("OK! 🎉") : Text("Got it") }
                .buttonStyle(StampButtonStyle())
                .accessibilityIdentifier("spelling.next")
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background((right ? Palette.sage : Palette.rose).opacity(0.18))
        .paperCard(rotation: right ? -0.6 : 0.6)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(right ? Text("Correct: \(word)") : Text("Not quite. The word is \(word)"))
        .accessibilityIdentifier("spelling.feedback")
    }
}

// MARK: - Easy: letter tiles

private struct SpellingTileArea: View {
    let model: SpellingModel
    let word: String

    var body: some View {
        let slots = Array(word).indices
        VStack(spacing: 18) {
            // The word's slots, filled left to right; a filled one taps back out.
            FlowRow(spacing: 8) {
                ForEach(slots, id: \.self) { i in
                    let id = model.placed.indices.contains(i) ? model.placed[i] : nil
                    let letter = id.flatMap { id in model.tiles.first { $0.id == id }?.letter }
                    Button {
                        if let id { model.remove(id) }
                    } label: {
                        Text(verbatim: letter ?? " ")
                            .font(Typeface.display(fixedSize: 28))
                            .frame(width: 46, height: 54)
                            .background(letter == nil ? Palette.cardTop : Palette.mustard)
                            .overlay(Rectangle().strokeBorder(
                                Palette.kraftDark, style: StrokeStyle(lineWidth: 2, dash: letter == nil ? [5, 4] : [])))
                    }
                    .buttonStyle(.plain)
                    .disabled(letter == nil)
                    .accessibilityLabel(letter.map { Text("Remove \($0)") } ?? Text("Empty slot"))
                    .accessibilityIdentifier("spelling.slot.\(i)")
                }
            }
            // The scrambled tray.
            FlowRow(spacing: 10) {
                ForEach(model.trayTiles) { tile in
                    Button { model.place(tile.id) } label: {
                        Text(verbatim: tile.letter)
                            .font(Typeface.display(fixedSize: 28))
                            .frame(width: 52, height: 56)
                            .background(Palette.cardTop)
                            .overlay(Rectangle().strokeBorder(Palette.charcoal, lineWidth: 2))
                            .background(Palette.charcoal.offset(x: 2, y: 3))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: tile.letter))
                    .accessibilityIdentifier("spelling.tile.\(tile.id)")
                }
            }
            .frame(minHeight: 60)
            .animation(.snappy, value: model.placed)

            HStack(spacing: 12) {
                Button { model.undoTile() } label: { Text("⌫ Backspace") }
                    .buttonStyle(StampButtonStyle(kind: .secondary))
                    .disabled(model.placed.isEmpty)
                    .accessibilityLabel(Text("Backspace — take back the last letter"))
                    .accessibilityIdentifier("spelling.undo")
                Button { model.peek() } label: { Text("💡 Hint") }
                    .buttonStyle(StampButtonStyle(kind: .secondary))
                    .accessibilityLabel(Text("Hint — show the word for a moment"))
                    .accessibilityIdentifier("spelling.peek")
            }
            Button { model.submit() } label: { Text("Check it") }
                .buttonStyle(StampButtonStyle())
                .disabled(!model.canSubmit)
                .opacity(model.canSubmit ? 1 : 0.5)
                .accessibilityIdentifier("spelling.check")
        }
    }
}

/// Easy's hint: the word floats over the stage for a moment, so the tiles
/// don't jump out from under a tapping finger when it fades.
private struct PeekCard: View {
    let word: String
    var dismiss: () -> Void

    var body: some View {
        ZStack {
            Palette.charcoal.opacity(0.25).ignoresSafeArea()
            VStack(spacing: 6) {
                Text("Quick — memorize it!")
                    .font(Typeface.body(16, relativeTo: .callout))
                    .foregroundStyle(Palette.pencil)
                Text(verbatim: word)
                    .font(Typeface.display(46, relativeTo: .largeTitle))
                    .foregroundStyle(Palette.charcoal)
            }
            .padding(28)
            .paperCard(rotation: -1)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: dismiss)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityIdentifier("spelling.peekCard")
    }
}

// MARK: - Medium, Hard: on-screen keyboard

/// Plain QWERTY rows, so the device keyboard's autocomplete can't whisper the
/// answer.
private struct SpellingKeyboardArea: View {
    let model: SpellingModel

    private static let rows: [[Character]] = ["qwertyuiop", "asdfghjkl", "zxcvbnm"].map(Array.init)

    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 2) {
                Text(verbatim: model.typed.isEmpty ? String(localized: "tap the letters…") : model.typed)
                    .foregroundStyle(model.typed.isEmpty ? Palette.pencil.opacity(0.6) : Palette.charcoal)
                Rectangle().fill(Palette.kraftDark).frame(width: 2, height: 30).accessibilityHidden(true)
            }
            .font(Typeface.display(34, relativeTo: .title))
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(Palette.cardTop)
            .overlay(Rectangle().strokeBorder(Palette.kraftDark, lineWidth: 2))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(model.typed.isEmpty ? Text("Tap the letters to spell the word") : Text("You typed \(model.typed)"))
            .accessibilityIdentifier("spelling.typed")

            VStack(spacing: 8) {
                ForEach(Self.rows.indices, id: \.self) { r in
                    HStack(spacing: 5) {
                        if r == Self.rows.count - 1 {
                            wideKey(Text(verbatim: "✓"), label: Text("Check it"), enabled: model.canSubmit, id: "enter") {
                                model.submit()
                            }
                        }
                        ForEach(Self.rows[r], id: \.self) { letter in
                            Button { model.press(letter) } label: {
                                Text(verbatim: String(letter))
                                    .font(Typeface.display(fixedSize: 22))
                                    .frame(maxWidth: 40, minHeight: 46)
                                    .frame(maxWidth: .infinity)
                                    .background(Palette.cardTop)
                                    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Palette.kraft, lineWidth: 1.5))
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("spelling.key.\(letter)")
                        }
                        if r == Self.rows.count - 1 {
                            wideKey(Text(verbatim: "⌫"), label: Text("Backspace — take back the last letter"), enabled: !model.typed.isEmpty, id: "backspace") {
                                model.backspace()
                            }
                        }
                    }
                }
            }
            .foregroundStyle(Palette.charcoal)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Letter keyboard"))

            Button { model.submit() } label: { Text("Check it") }
                .buttonStyle(StampButtonStyle())
                .disabled(!model.canSubmit)
                .opacity(model.canSubmit ? 1 : 0.5)
                .accessibilityIdentifier("spelling.check")
        }
    }

    private func wideKey(_ face: Text, label: Text, enabled: Bool, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            face
                .font(Typeface.display(fixedSize: 22))
                .frame(minWidth: 52, minHeight: 46)
                .background(Palette.paperDeep)
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Palette.kraftDark, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
        .accessibilityLabel(label)
        .accessibilityIdentifier("spelling.key.\(id)")
    }
}

// MARK: - End of round

private struct SpellingEndCard: View {
    let model: SpellingModel
    var done: () -> Void

    var body: some View {
        let correct = model.correctCount, total = model.words.count
        let stars = Spelling.stars(correct: correct, total: total)
        VStack(spacing: 14) {
            Text(verbatim: "🐲").font(.system(size: 56)).accessibilityHidden(true)
            (correct == total ? Text("Perfect spelling!") : Text("Great spelling!"))
                .font(Typeface.display(34, relativeTo: .largeTitle))
                .foregroundStyle(Palette.roseInk)
                .rotationEffect(.degrees(-2))
                .accessibilityAddTraits(.isHeader)
            Text("You spelled \(correct) of \(total) words right.")
                .font(Typeface.body(19, relativeTo: .body))
                .accessibilityIdentifier("spelling.score")
            (model.hintCount == 1 ? Text("You used 1 hint.") : Text("You used \(model.hintCount) hints."))
                .font(Typeface.body(16, relativeTo: .callout))
                .foregroundStyle(Palette.pencil)
            StarRating(filled: stars, size: 30)
                .accessibilityLabel(Text("\(stars) of 5 stars"))
            if let best = model.best {
                Group {
                    if best.isNew {
                        Text("🏆 New best! \(best.best) / \(total)")
                    } else {
                        Text("Best: \(best.best) / \(total)")
                    }
                }
                .font(Typeface.display(20, relativeTo: .title3))
                .accessibilityIdentifier("spelling.best")
            }

            PrizeReveal(prize: model.prize)

            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(model.results.enumerated()), id: \.offset) { _, result in
                    HStack(spacing: 10) {
                        Text(verbatim: result.correct ? "✓" : "✗")
                            .foregroundStyle(result.correct ? Palette.sageInk : Palette.roseInk)
                            .accessibilityHidden(true)
                        Text(verbatim: result.word)
                    }
                    .font(Typeface.body(18, relativeTo: .body))
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(result.correct ? Text("\(result.word), right") : Text("\(result.word), missed"))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Palette.paperDeep.opacity(0.5))

            HStack(spacing: 12) {
                Button { model.playAgain() } label: { Text("↻ play again") }
                    .buttonStyle(StampButtonStyle())
                    .accessibilityIdentifier("spelling.playAgain")
                Button(action: done) { Text("Choose grade") }
                    .buttonStyle(StampButtonStyle(kind: .secondary))
                    .accessibilityIdentifier("spelling.chooseGrade")
            }
        }
        .foregroundStyle(Palette.charcoal)
        .padding(24)
        .frame(maxWidth: .infinity)
        .paperCard(rotation: -0.4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("spelling.end")
    }
}

/// Lays its children out left to right, wrapping onto new centered rows — a
/// long word's slots or tiles never run off an iPhone screen.
private struct FlowRow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX + (bounds.width - row.width) / 2
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            if needed > width, !row.indices.isEmpty {
                rows.append(row)
                row = Row()
            }
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}
