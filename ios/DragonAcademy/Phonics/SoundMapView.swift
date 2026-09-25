import AVFoundation
import Audio
import GameRules
import SwiftUI

// The Sound Map ("My Sounds"): every sound in the program, coloured by how
// well the kid knows it — the SwiftUI twin of src/components/
// PhonicsMasteryMap.jsx. It shows the WHOLE curriculum, sounds never tried
// included, so a kid who has played one stage doesn't look finished.

/// What each mastery level means, in words a kid can read (the web's
/// `LEVEL_INFO`). `solid` says "one way" because mastering a sound needs it
/// right in two different games, and a kid staring at a stuck tile should
/// know that's what's missing.
extension PhonicsMasteryLevel {
    var label: String {
        switch self {
        case .new: String(localized: "Not tried yet", comment: "Sound Map: a sound's mastery level — never attempted.")
        case .learning: String(localized: "Learning", comment: "Sound Map: a sound's mastery level — still learning it.")
        case .solid: String(localized: "Got it one way", comment: "Sound Map: a sound's mastery level — strong in one game only.")
        case .mastered: String(localized: "Mastered!", comment: "Sound Map: a sound's mastery level — right in two or more games.")
        }
    }

    var hint: String {
        switch self {
        case .new: String(localized: "You have not met this sound yet.", comment: "Sound Map detail: what a new sound's level means.")
        case .learning:
            String(localized: "Getting there — keep practicing this one.", comment: "Sound Map detail: what the learning level means.")
        case .solid:
            String(
                localized: "Strong in one game. Try it in another game to master it.",
                comment: "Sound Map detail: what the solid level means, and how to master it.")
        case .mastered:
            String(localized: "You know this sound in more than one way. Nice.", comment: "Sound Map detail: what the mastered level means.")
        }
    }

    /// Shown on the tile as well as its colour, so the level is never told by
    /// colour alone.
    var emoji: String {
        switch self {
        case .new: "·"
        case .learning: "🌱"
        case .solid: "🌤️"
        case .mastered: "⭐"
        }
    }
}

/// The map's tile colours (the web's `.tile_<level>`), with inks dark enough
/// for their fills (ThemeContrast checks them).
enum SoundMapStyle {
    static func fillHex(_ level: PhonicsMasteryLevel) -> UInt32 {
        switch level {
        case .new: 0xEFE6D2
        case .learning: 0xF3CFC6
        case .solid: 0xECC978
        case .mastered: 0xA8CF92
        }
    }

    /// The web's new-tile ink (#9d8c74) is only 2.6:1; this one is darker.
    static func inkHex(_ level: PhonicsMasteryLevel) -> UInt32 {
        switch level {
        case .new: 0x6E604B
        case .learning: 0x6B3A32
        case .solid: 0x4A3714
        case .mastered: 0x23301C
        }
    }

    static func fill(_ level: PhonicsMasteryLevel) -> Color { Color(hex: fillHex(level)) }
    static func ink(_ level: PhonicsMasteryLevel) -> Color { Color(hex: inkHex(level)) }
}

/// The Sound Map's state and words: which tile is open, and what the
/// headline, tiles and detail say.
@MainActor @Observable
final class SoundMapModel {
    let progress: PhonicsProgress
    /// The element whose detail is open.
    var selected: String?

    init(progress: PhonicsProgress) {
        self.progress = progress
    }

    var overview: PhonicsMasteryOverview { progress.overview }

    /// A tile was tapped: it opens (true: say the sound) or, if already
    /// open, closes (false).
    @discardableResult
    func tap(_ key: String) -> Bool {
        if selected == key {
            selected = nil
            return false
        }
        selected = key
        return true
    }

    /// The open tile's element and verdict.
    var detail: (element: PhonicsElement, state: PhonicsElementMastery)? {
        guard let selected, let element = Phonics.elementByKey[selected] else { return nil }
        return (element, overview[selected])
    }

    /// The confusions whose elements are both in the curriculum.
    var confusions: [Confusion] {
        progress.confusions.compactMap { c in
            guard let a = Phonics.elementByKey[c.element], let b = Phonics.elementByKey[c.chose] else { return nil }
            return Confusion(element: a, chose: b, count: c.count)
        }
    }

    /// Asked `element`, answered `chose`, `count` times.
    struct Confusion: Hashable {
        let element: PhonicsElement
        let chose: PhonicsElement
        let count: Int
        var id: String { "\(element.key)\t\(chose.key)" }
    }

    // MARK: - Words

    /// "3 nearly there · 2 still learning · 97 not tried yet": the headline's
    /// second line, leaving out empty levels except "not tried".
    nonisolated static func headlineDetail(_ counts: PhonicsMasteryCounts) -> String {
        var parts: [String] = []
        if counts.solid > 0 {
            parts.append(String(localized: "\(counts.solid) nearly there", comment: "Sound Map headline: sounds at the solid level."))
        }
        if counts.learning > 0 {
            parts.append(
                String(localized: "\(counts.learning) still learning", comment: "Sound Map headline: sounds at the learning level."))
        }
        parts.append(String(localized: "\(counts.new) not tried yet", comment: "Sound Map headline: sounds never attempted."))
        return parts.joined(separator: " · ")
    }

    /// "2 sounds need a re-check"; nil when nothing is stale.
    nonisolated static func staleLine(_ stale: Int) -> String? {
        guard stale > 0 else { return nil }
        return stale == 1
            ? String(localized: "\(stale) sound needs a re-check", comment: "Sound Map headline: one mastered sound not practised lately.")
            : String(localized: "\(stale) sounds need a re-check", comment: "Sound Map headline: mastered sounds not practised lately.")
    }

    /// "5 right out of your last 6 · right in 2 games"; nil before any attempt.
    nonisolated static func stats(_ state: PhonicsElementMastery) -> String? {
        guard state.attempts > 0 else { return nil }
        var text = String(
            localized: "\(state.correct) right out of your last \(state.attempts)",
            comment: "Sound Map detail: right answers in the recent attempts at a sound.")
        let modes = state.modes.count
        if modes > 0 {
            text += " · "
            text += modes == 1
                ? String(localized: "right in \(modes) game", comment: "Sound Map detail: the sound was answered right in one game.")
                : String(localized: "right in \(modes) games", comment: "Sound Map detail: the number of games the sound was answered right in.")
        }
        return text
    }
}

/// The Sound Map tab.
struct SoundMapView: View {
    @State private var model: SoundMapModel
    /// "Practice this stage": back to the games with the stage picked.
    var practise: (Int) -> Void

    @Environment(\.audio) private var audio
    @State private var voice = AVSpeechSynthesizer()

    init(progress: PhonicsProgress, practise: @escaping (Int) -> Void) {
        _model = State(initialValue: SoundMapModel(progress: progress))
        self.practise = practise
    }

    var body: some View {
        let overview = model.overview
        VStack(alignment: .leading, spacing: 16) {
            headline(overview)
            legend
            ForEach(overview.stages) { stage in
                stageCard(stage, overview: overview)
            }
            if !model.confusions.isEmpty { confusions }
        }
        .sheet(
            isPresented: Binding(get: { model.selected != nil }, set: { if !$0 { model.selected = nil } })
        ) {
            if let detail = model.detail {
                SoundDetailCard(element: detail.element, state: detail.state, hear: { say(detail.element) }) {
                    model.selected = nil
                }
                .presentationDetents([.medium, .large])
            }
        }
        .onDisappear {
            audio?.stopSpeaking()
            voice.stopSpeaking(at: .immediate)
        }
    }

    private func headline(_ overview: PhonicsMasteryOverview) -> some View {
        HStack(spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(verbatim: "\(overview.overall.mastered)")
                    .font(Typeface.display(44, relativeTo: .largeTitle))
                Text(verbatim: "/\(overview.total)")
                    .font(Typeface.display(22, relativeTo: .title3))
            }
            .foregroundStyle(Palette.kraftDark)
            .fixedSize()
            VStack(alignment: .leading, spacing: 3) {
                Text("sounds mastered")
                    .font(Typeface.display(20, relativeTo: .headline))
                    .foregroundStyle(Palette.charcoal)
                Text(verbatim: SoundMapModel.headlineDetail(overview.overall))
                    .font(Typeface.body(14, relativeTo: .subheadline))
                    .foregroundStyle(Palette.pencil)
                if let stale = SoundMapModel.staleLine(overview.overall.stale) {
                    Text(verbatim: "🔁 \(stale)")
                        .font(Typeface.body(14, relativeTo: .subheadline))
                        .foregroundStyle(Palette.roseInk)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .paperCard()
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("soundMap.headline")
    }

    private var legend: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(PhonicsMasteryLevel.allCases, id: \.self) { level in
                HStack(spacing: 6) {
                    Text(verbatim: level.emoji)
                        .font(.system(size: 11))
                        .frame(width: 20, height: 20)
                        .background(SoundMapStyle.fill(level), in: RoundedRectangle(cornerRadius: 4))
                        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Palette.kraft, lineWidth: 1.5))
                        .accessibilityHidden(true)
                    Text(verbatim: level.label)
                        .font(Typeface.body(14, relativeTo: .caption))
                        .foregroundStyle(Palette.pencil)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("What the colors mean"))
    }

    private func stageCard(_ stage: PhonicsStageSummary, overview: PhonicsMasteryOverview) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text(verbatim: stage.stage.emoji).font(.system(size: 30)).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: stage.stage.label)
                        .font(Typeface.display(21, relativeTo: .headline))
                        .foregroundStyle(Palette.kraftDark)
                    Text(verbatim: stage.stage.blurb)
                        .font(Typeface.body(14, relativeTo: .footnote))
                        .foregroundStyle(Palette.pencil)
                }
                Spacer(minLength: 0)
                Text(verbatim: "\(stage.mastered)/\(stage.total)")
                    .font(Typeface.display(18, relativeTo: .headline))
                    .foregroundStyle(Palette.charcoal)
                    .accessibilityLabel(Text(verbatim: SoundMapAccessibility.stageScore(mastered: stage.mastered, total: stage.total)))
            }
            .accessibilityElement(children: .combine)
            PhonicsMasteryBar(percent: stage.percent)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 58), spacing: 8)], spacing: 8) {
                ForEach(stage.elements) { element in
                    tile(element, state: overview[element.key])
                }
            }
            Button {
                practise(stage.stage.stage)
            } label: {
                Text("Practice \(stage.stage.label) →")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(StampButtonStyle(kind: .secondary))
            .accessibilityIdentifier("soundMap.practise.\(stage.stage.stage)")
        }
        .padding(16)
        .paperCard()
        .accessibilityIdentifier("soundMap.stage.\(stage.stage.stage)")
    }

    private func tile(_ element: PhonicsElement, state: PhonicsElementMastery) -> some View {
        let on = model.selected == element.key
        return Button {
            if model.tap(element.key) { say(element) }
        } label: {
            Text(verbatim: element.g)
                .font(Typeface.display(24, relativeTo: .title3))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .foregroundStyle(SoundMapStyle.ink(state.level))
                .frame(maxWidth: .infinity, minHeight: 58)
                .background(SoundMapStyle.fill(state.level), in: RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(on ? Palette.charcoal : Palette.kraft, lineWidth: on ? 3 : 2)
                )
                .overlay(alignment: .bottomTrailing) {
                    Text(verbatim: state.level.emoji).font(.system(size: 10)).padding(3)
                }
                .overlay(alignment: .topTrailing) {
                    if state.stale { Text(verbatim: "🔁").font(.system(size: 11)).offset(x: 4, y: -5) }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: SoundMapAccessibility.tile(element, state)))
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("soundMap.tile.\(element.key)")
    }

    private var confusions: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Sounds that get mixed up")
                .font(Typeface.display(21, relativeTo: .headline))
                .foregroundStyle(Palette.kraftDark)
            ForEach(model.confusions, id: \.id) { c in
                HStack(spacing: 8) {
                    Text(verbatim: c.element.g).font(Typeface.display(20, relativeTo: .headline))
                    Text(verbatim: c.element.sound).foregroundStyle(Palette.pencil)
                    Image(systemName: "arrow.right").accessibilityHidden(true)
                    Text(verbatim: c.chose.g).font(Typeface.display(20, relativeTo: .headline))
                    Text(verbatim: c.chose.sound).foregroundStyle(Palette.pencil)
                    Spacer()
                    Text(verbatim: "\(c.count)×").foregroundStyle(Palette.kraftDark)
                }
                .font(Typeface.body(16, relativeTo: .body))
                .foregroundStyle(Palette.charcoal)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("\(c.element.sound) heard as \(c.chose.sound), \(c.count) times"))
            }
            Text("These pairs sound alike. Hearing them right next to each other is the fastest way to split them apart.")
                .font(Typeface.body(14, relativeTo: .footnote))
                .foregroundStyle(Palette.pencil)
        }
        .padding(16)
        .paperCard()
    }

    /// The sound, a beat, then its first example word (the web's
    /// `speakSoundInWord`).
    private func say(_ element: PhonicsElement) {
        Task {
            if let url = PhonicsClips.url(for: element.key) {
                try? await audio?.speak(url)
                try? await Task.sleep(for: .milliseconds(350))
            }
            guard let word = element.words.first else { return }
            voice.stopSpeaking(at: .immediate)
            let utterance = AVSpeechUtterance(string: word)
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.85
            voice.speak(utterance)
        }
    }
}

/// A stage's mastered share: a thin sage bar (mastered only, as on the web).
struct PhonicsMasteryBar: View {
    let percent: Int

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.kraftDark.opacity(0.16))
                Capsule().fill(Palette.sage).frame(width: geo.size.width * CGFloat(percent) / 100)
            }
        }
        .frame(height: 7)
        .accessibilityHidden(true)
    }
}

/// A tapped tile: why the sound sits where it does, and what would move it.
private struct SoundDetailCard: View {
    let element: PhonicsElement
    let state: PhonicsElementMastery
    var hear: () -> Void
    var close: () -> Void

    var body: some View {
        ZStack {
            PaperBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(verbatim: element.g).font(Typeface.display(44, relativeTo: .largeTitle))
                            Text(verbatim: element.sound)
                                .font(Typeface.body(18, relativeTo: .body))
                                .foregroundStyle(Palette.kraftDark)
                        }
                        Spacer()
                        Button("Close", action: close)
                            .buttonStyle(StampButtonStyle(kind: .secondary))
                            .accessibilityIdentifier("soundMap.detail.close")
                    }
                    Text(verbatim: "\(state.level.emoji) \(state.level.label)")
                        .font(Typeface.display(22, relativeTo: .title3))
                        .accessibilityLabel(Text(verbatim: state.level.label))
                    Text(verbatim: state.level.hint)
                        .font(Typeface.body(16, relativeTo: .body))
                        .foregroundStyle(Palette.pencil)
                    if !element.note.isEmpty {
                        Text(verbatim: element.note)
                            .font(Typeface.body(15, relativeTo: .footnote))
                            .foregroundStyle(Palette.pencil)
                    }
                    if !element.words.isEmpty {
                        Text("as in \(element.words.joined(separator: ", "))")
                            .font(Typeface.body(16, relativeTo: .body))
                    }
                    if let stats = SoundMapModel.stats(state) {
                        Text(verbatim: stats)
                            .font(Typeface.body(15, relativeTo: .footnote))
                            .foregroundStyle(Palette.kraftDark)
                            .accessibilityIdentifier("soundMap.detail.stats")
                    }
                    Button(action: hear) {
                        Label("hear it", systemImage: "speaker.wave.2.fill")
                    }
                    .buttonStyle(StampButtonStyle())
                    .padding(.top, 6)
                    .accessibilityIdentifier("soundMap.detail.hear")
                }
                .foregroundStyle(Palette.charcoal)
                .padding(20)
            }
        }
    }
}

/// Dragon Phonics' two tabs: the games, and the picture of what the kid
/// knows (the web's Play / My Sounds).
enum PhonicsTab: Hashable {
    case play
    case map
}

struct PhonicsTabBar: View {
    @Binding var tab: PhonicsTab

    var body: some View {
        HStack(spacing: 10) {
            button(.play, emoji: "🎧", label: Text("Play"), id: "play")
            button(.map, emoji: "🗺️", label: Text("My Sounds"), id: "map")
        }
    }

    private func button(_ value: PhonicsTab, emoji: String, label: Text, id: String) -> some View {
        let on = tab == value
        return Button {
            tab = value
        } label: {
            HStack(spacing: 6) {
                Text(verbatim: emoji).accessibilityHidden(true)
                label
            }
            .font(Typeface.display(19, relativeTo: .headline))
            .foregroundStyle(Palette.charcoal)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(on ? Palette.sage.opacity(0.4) : Palette.cardTop, in: Capsule())
            .overlay(Capsule().strokeBorder(on ? Palette.charcoal : Palette.kraft.opacity(0.6), lineWidth: on ? 2 : 1.5))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
        .accessibilityIdentifier("phonics.tab.\(id)")
    }
}
