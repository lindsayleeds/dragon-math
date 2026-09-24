import AVFoundation
import GameRules
import Store
import SwiftUI

/// The lair's way in: Memorize for the player on this device. Until the
/// family picker lands that is the guest, as for Proving Grounds; a child
/// profile gets its server passages through the same model.
struct MemorizeEntry: View {
    @Environment(\.store) private var store
    @Environment(\.sync) private var sync
    @Environment(\.memorizePassages) private var passages

    var body: some View {
        if let store {
            MemorizeView(model: MemorizeModel(profile: store.guestProfile, store: store, sync: sync, source: passages))
        } else {
            Text("Dragon Memorize needs the app's store.")
        }
    }
}

/// Dragon Memorize: pick a passage, pick a challenge, study it, then rebuild
/// it sentence by sentence — the iOS twin of src/pages/DragonMemorizePage.jsx.
struct MemorizeView: View {
    enum Phase: Equatable {
        case pick
        case level(MemorizePassage)
        case study(MemorizePassage, MemorizeDifficulty)
        case practice(MemorizePassage, MemorizeDifficulty)
        case done(MemorizePassage, MemorizeDifficulty)
    }

    @State private var model: MemorizeModel
    @State private var phase: Phase = .pick

    init(model: MemorizeModel) {
        _model = State(initialValue: model)
    }

    // Pushed onto the app's NavigationStack from the Learning Lair: on the
    // passage list the system Back returns to the lair; deeper in, Back steps
    // back one phase, like the web's back tab.
    var body: some View {
        ScrollView {
            content
                .frame(maxWidth: 640)
                .padding()
                .frame(maxWidth: .infinity)
        }
        .background(MemorizeStyle.paper.ignoresSafeArea())
        .navigationTitle("Dragon Memorize")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(phase != .pick)
        .toolbar {
            if phase != .pick {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Back", systemImage: "chevron.left", action: goBack)
                        .accessibilityIdentifier("memorize.back")
                }
            }
        }
        .task { await model.load() }
        .task { await model.observeProgress() }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .pick:
            MemorizePassageList(model: model) { phase = .level($0) }
        case .level(let passage):
            MemorizeLevelPicker(passage: passage) { phase = .study(passage, $0) }
        case .study(let passage, let difficulty):
            MemorizeStudyView(passage: passage) { phase = .practice(passage, difficulty) }
        case .practice(let passage, let difficulty):
            MemorizePracticeView(passage: passage, difficulty: difficulty) {
                await model.complete(passage, at: difficulty)
                phase = .done(passage, difficulty)
            }
            .id("\(passage.id):\(difficulty.rawValue)")
        case .done(let passage, let difficulty):
            MemorizeDoneView(
                passage: passage, difficulty: difficulty,
                tryAnother: { phase = .level(passage) },
                backToPassages: { phase = .pick })
        }
    }

    private func goBack() {
        switch phase {
        case .pick: break
        case .level, .done: phase = .pick
        case .study(let passage, _): phase = .level(passage)
        case .practice(let passage, let difficulty): phase = .study(passage, difficulty)
        }
    }
}

enum MemorizeStyle {
    static let paper = Color(red: 0.99, green: 0.96, blue: 0.9)
    static let card = Color.white
    static let ink = Color(red: 0.24, green: 0.16, blue: 0.1)
    static let ember = Color(red: 0.87, green: 0.4, blue: 0.13)
    static let moss = Color(red: 0.24, green: 0.5, blue: 0.3)
}

// MARK: - Passage list

struct MemorizePassageList: View {
    let model: MemorizeModel
    let choose: (MemorizePassage) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            if model.hasPassageBook {
                Text("My passages").font(.title2.bold())
                switch model.loadState {
                case .loading:
                    ProgressView("Opening your passage book…")
                        .frame(maxWidth: .infinity)
                case .failed(let message):
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message).foregroundStyle(.red)
                        Button("Try again") { Task { await model.load() } }
                            .buttonStyle(.bordered)
                    }
                case .loaded where model.serverPassages.isEmpty:
                    emptyBook
                case .loaded:
                    cards(model.serverPassages)
                }
            }
            if !model.samples.isEmpty {
                Text(model.hasPassageBook ? "Try a sample" : "Sample passages").font(.title2.bold())
                cards(model.samples)
            }
        }
        .foregroundStyle(MemorizeStyle.ink)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("🐲").font(.system(size: 44)).accessibilityHidden(true)
            Text("Learn each line until the whole passage is yours.")
                .font(.headline)
                .foregroundStyle(.secondary)
        }
    }

    private var emptyBook: some View {
        VStack(spacing: 6) {
            Text("📖").font(.largeTitle).accessibilityHidden(true)
            Text("Your passage book is ready").font(.headline)
            Text("Ask a grown-up to add a verse, poem, quotation, speech, or definition.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(MemorizeStyle.card, in: RoundedRectangle(cornerRadius: 16))
    }

    private func cards(_ passages: [MemorizePassage]) -> some View {
        VStack(spacing: 12) {
            ForEach(passages) { passage in
                Button { choose(passage) } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(passage.category.uppercased())
                            .font(.caption.weight(.bold))
                            .foregroundStyle(MemorizeStyle.ember)
                        Text(passage.title).font(.headline)
                        Text(passage.body)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        Text(MemorizeModel.masteryLabel(model.mastery(of: passage)))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(model.mastery(of: passage) > 0 ? MemorizeStyle.moss : .secondary)
                    }
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(MemorizeStyle.card, in: RoundedRectangle(cornerRadius: 16))
                    .shadow(color: .black.opacity(0.06), radius: 4, y: 2)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("memorize.passage.\(passage.id)")
            }
        }
    }
}

// MARK: - Level, study, done

struct MemorizeLevelPicker: View {
    let passage: MemorizePassage
    let choose: (MemorizeDifficulty) -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(passage.title).font(.headline).foregroundStyle(.secondary)
            Text("Choose your challenge").font(.title.bold())
            ForEach(MemorizeDifficulty.allCases, id: \.self) { difficulty in
                Button { choose(difficulty) } label: {
                    HStack(spacing: 16) {
                        Text(difficulty.icon).font(.largeTitle).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(difficulty.label).font(.title3.bold())
                            Text(difficulty.help).font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .multilineTextAlignment(.leading)
                    .padding()
                    .background(MemorizeStyle.card, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("memorize.level.\(difficulty.rawValue)")
            }
        }
        .foregroundStyle(MemorizeStyle.ink)
    }
}

extension MemorizeDifficulty {
    var label: String {
        switch self {
        case .easy: String(localized: "Easy")
        case .medium: String(localized: "Medium")
        case .hard: String(localized: "Hard")
        }
    }

    var icon: String {
        switch self {
        case .easy: "🌱"
        case .medium: "🌟"
        case .hard: "🐉"
        }
    }

    var help: String {
        switch self {
        case .easy: String(localized: "Fill a few missing words from a word bank.")
        case .medium: String(localized: "Put every word back in the right order.")
        case .hard: String(localized: "Press the first letter of each word from memory.")
        }
    }
}

struct MemorizeStudyView: View {
    let passage: MemorizePassage
    let hideTheWords: () -> Void
    @State private var speaker = AVSpeechSynthesizer()

    var body: some View {
        VStack(spacing: 20) {
            Text("Study first")
                .font(.caption.weight(.bold))
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(MemorizeStyle.ember.opacity(0.15), in: Capsule())
                .foregroundStyle(MemorizeStyle.ember)
            Text(passage.title).font(.title.bold())
            Text(passage.body)
                .font(.title3)
                .lineSpacing(6)
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(MemorizeStyle.card, in: RoundedRectangle(cornerRadius: 16))
            HStack(spacing: 12) {
                Button("Hear it", systemImage: "speaker.wave.2.fill") { speak() }
                    .buttonStyle(.bordered)
                Button("Hide the words", action: hideTheWords)
                    .buttonStyle(.borderedProminent)
                    .tint(MemorizeStyle.ember)
                    .accessibilityIdentifier("memorize.hideWords")
            }
            .controlSize(.large)
        }
        .foregroundStyle(MemorizeStyle.ink)
        .onDisappear { speaker.stopSpeaking(at: .immediate) }
    }

    private func speak() {
        speaker.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: passage.body)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.82
        speaker.speak(utterance)
    }
}

struct MemorizeDoneView: View {
    let passage: MemorizePassage
    let difficulty: MemorizeDifficulty
    let tryAnother: () -> Void
    let backToPassages: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("🐉").font(.system(size: 72)).accessibilityHidden(true)
            Text("Passage remembered!").font(.largeTitle.bold())
            Text("You completed **\(passage.title)** on \(difficulty.label).")
                .multilineTextAlignment(.center)
            Button("Try another level", action: tryAnother)
                .buttonStyle(.borderedProminent)
                .tint(MemorizeStyle.ember)
                .controlSize(.large)
            Button("My passages", action: backToPassages)
                .buttonStyle(.bordered)
        }
        .foregroundStyle(MemorizeStyle.ink)
        .accessibilityIdentifier("memorize.done")
    }
}
