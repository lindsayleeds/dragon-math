import GameRules
import SwiftUI
import TextNormalization

/// One practice run of a passage at one difficulty: the web's MemoryPractice.
/// The rules (which words, which tiles, what counts as right) are GameRules'
/// `MemorizePractice`; this draws it and turns its feedback into a message
/// and a haptic.
struct MemorizePracticeView: View {
    let passage: MemorizePassage
    let difficulty: MemorizeDifficulty
    /// Called once when the last sentence is done and the child finishes.
    let finish: () async -> Void

    @State private var practice: MemorizePractice<SystemRandomSource>
    @State private var message: String?
    @State private var saving = false
    @State private var correctCount = 0
    @State private var wrongCount = 0
    @FocusState private var keyboardFocused: Bool

    init(passage: MemorizePassage, difficulty: MemorizeDifficulty, finish: @escaping () async -> Void) {
        self.passage = passage
        self.difficulty = difficulty
        self.finish = finish
        // Rule settings stay at the web fallback until the app loads
        // /api/rule-settings; they only change which words Easy hides.
        _practice = State(initialValue: MemorizePractice(body: passage.body, difficulty: difficulty, rng: SystemRandomSource()))
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("Sentence \(practice.sentenceIndex + 1) of \(practice.sentences.count)")
                .font(.caption.weight(.bold))
                .foregroundStyle(MemorizeStyle.ember)
                .accessibilityIdentifier("memorize.progress")
            Text(passage.title).font(.title2.bold())

            switch difficulty {
            case .easy: easy
            case .medium: medium
            case .hard: hard
            }

            if let message {
                // Every message here is a miss: the cross says so without
                // the colour (#169).
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    AnswerFeedbackMark(feedback: .tryAgain, size: 18)
                    Text(message)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(MemorizeStyle.ember)
                        .multilineTextAlignment(.center)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("memorize.message")
            }
            if practice.sentenceDone { successRow }
        }
        .foregroundStyle(MemorizeStyle.ink)
        .sensoryFeedback(.success, trigger: correctCount)
        .sensoryFeedback(.error, trigger: wrongCount)
    }

    // MARK: - Easy

    private var easy: some View {
        VStack(spacing: 16) {
            sentenceLine { index, word in
                practice.hidden.contains(index) && !practice.revealed.contains(index)
                    ? .blank(word, current: index == practice.hidden.first { !practice.revealed.contains($0) })
                    : .word(word)
            }
            .accessibilityLabel("Sentence with missing words")
            Text("Choose the words in blank order.").font(.subheadline).foregroundStyle(.secondary)
            tileTray(disabled: { practice.usedTiles.contains($0.id) }) { tile in
                respond(to: practice.pickEasy(tile))
            }
        }
    }

    // MARK: - Medium

    private var medium: some View {
        VStack(spacing: 16) {
            Group {
                if practice.chosen.isEmpty {
                    Text("Build the sentence here…").foregroundStyle(.secondary)
                } else {
                    builtLine
                }
            }
            .font(.title3)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .padding()
            .background(MemorizeStyle.card, in: RoundedRectangle(cornerRadius: 16))

            tileTray(disabled: { practice.chosen.contains($0.id) }) { tile in
                respond(to: practice.pickMedium(tile))
            }
            HStack {
                Button("Undo last") {
                    practice.undoMedium()
                    message = nil
                }
                .disabled(practice.chosen.isEmpty || practice.sentenceDone)
                if message != nil, practice.chosen.count == practice.words.count, !practice.sentenceDone {
                    Button("Try again") {
                        practice.clearChosen()
                        message = nil
                    }
                }
            }
            .buttonStyle(.bordered)
        }
    }

    /// The placed words with the sentence's own punctuation between them, up
    /// to the next word not placed yet.
    private var builtLine: some View {
        let chosen = practice.chosenWords
        var text = AttributedString()
        for segment in practice.segments {
            switch segment {
            case .word(_, let index):
                guard index < chosen.count else { return Text(text) }
                text += AttributedString(chosen[index])
            case .separator(let value):
                text += AttributedString(value)
            }
        }
        return Text(text)
    }

    // MARK: - Hard

    private var hard: some View {
        VStack(spacing: 16) {
            Text("Press the first letter of each word.").font(.subheadline).foregroundStyle(.secondary)
            sentenceLine { index, word in
                index < practice.hardIndex ? .word(word) : .blank(word, current: index == practice.hardIndex)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 9), spacing: 6) {
                ForEach(Memorize.keys, id: \.self) { key in
                    Button {
                        respond(to: practice.pressLetter(key))
                    } label: {
                        Text(key)
                            .font(.headline.monospaced())
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .background(MemorizeStyle.card, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("memorize.key.\(key)")
                }
            }
            .accessibilityLabel("Letter keyboard")
        }
        // A hardware keyboard (iPad) types letters straight in, as on the web.
        .focusable()
        .focused($keyboardFocused)
        .focusEffectDisabled()
        .onAppear { keyboardFocused = true }
        .onKeyPress(phases: .down) { press in
            let key = press.characters
            guard key.count == 1, let scalar = key.unicodeScalars.first, scalar.isASCII,
                scalar.properties.isAlphabetic || ("0"..."9").contains(scalar)
            else { return .ignored }
            respond(to: practice.pressLetter(key))
            return .handled
        }
    }

    // MARK: - Pieces

    private enum Shown {
        case word(String)
        case blank(String, current: Bool)
    }

    /// The current sentence, with each word shown or blanked by `show`.
    private func sentenceLine(_ show: (Int, String) -> Shown) -> some View {
        var text = AttributedString()
        for segment in practice.segments {
            switch segment {
            case .separator(let value):
                text += AttributedString(value)
            case .word(let word, let index):
                switch show(index, word) {
                case .word(let word):
                    text += AttributedString(word)
                case .blank(let word, let current):
                    var blank = AttributedString(String(repeating: "_", count: min(word.count, 10)))
                    blank.foregroundColor = current ? MemorizeStyle.ember : .secondary
                    if current { blank.backgroundColor = MemorizeStyle.ember.opacity(0.12) }
                    text += blank
                }
            }
        }
        return Text(text)
            .font(.title3.monospaced())
            .lineSpacing(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(MemorizeStyle.card, in: RoundedRectangle(cornerRadius: 16))
    }

    private func tileTray(
        disabled: @escaping (MemorizeTile) -> Bool, pick: @escaping (MemorizeTile) -> Void
    ) -> some View {
        FlowLayout(spacing: 8) {
            ForEach(practice.tiles) { tile in
                Button { pick(tile) } label: {
                    Text(tile.word)
                        .font(.title3.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(
                            disabled(tile) ? Color.gray.opacity(0.15) : MemorizeStyle.card,
                            in: RoundedRectangle(cornerRadius: 10))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(MemorizeStyle.ember.opacity(disabled(tile) ? 0 : 0.5), lineWidth: 1.5))
                }
                .buttonStyle(.plain)
                .disabled(disabled(tile) || practice.sentenceDone)
                .opacity(disabled(tile) ? 0.4 : 1)
                .accessibilityIdentifier("memorize.tile.\(tile.id)")
            }
        }
    }

    private var successRow: some View {
        VStack(spacing: 12) {
            HStack(spacing: 6) {
                AnswerFeedbackMark(feedback: .correct, size: 20)
                Text("🌿 Sentence remembered!").font(.headline).foregroundStyle(MemorizeStyle.moss)
            }
            .accessibilityElement(children: .combine)
            Button(practice.isLastSentence ? "Finish passage" : "Next sentence") {
                if practice.advance() {
                    message = nil
                } else {
                    guard !saving else { return }
                    saving = true
                    Task { await finish() }
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(MemorizeStyle.ember)
            .controlSize(.large)
            .disabled(saving)
            .accessibilityIdentifier("memorize.next")
        }
    }

    private func respond(to feedback: MemorizeFeedback) {
        switch feedback {
        case .none: return
        case .placed: message = nil
        case .correct:
            message = nil
            correctCount += 1
        case .wrongBlank:
            message = String(localized: "That word belongs in a different blank.")
            wrongCount += 1
        case .wrongOrder:
            message = String(localized: "Almost—check the order, then try again.")
            wrongCount += 1
        case .wrongLetter:
            message = String(localized: "Try the first letter of the next word.")
            wrongCount += 1
        }
    }
}

/// Lays children out left to right, wrapping onto new rows — the word tiles.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(for: subviews, width: proposal.width ?? .infinity)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(for: subviews, width: bounds.width) {
            // Centre each row, as the web's tile tray does.
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

    private func rows(for subviews: Subviews, width: CGFloat) -> [Row] {
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
