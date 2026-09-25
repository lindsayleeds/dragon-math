import Audio
import Foundation
import GameRules
import Store
import Sync
import SwiftUI

/// The lair's Stepping Stones, for whoever is playing, skip counting by the
/// number picked in the facts grid. Deals the crossing from the synced
/// `stepping_stones` rule settings when there are some, else the built-in
/// fallbacks — as the web deals from the served settings once loaded.
struct SteppingStonesEntry: View {
    let baseNumber: Int
    var backToLair: () -> Void

    @Environment(\.store) private var store
    @Environment(\.sync) private var sync
    @Environment(\.currentProfile) private var profile
    @Environment(\.audio) private var audio
    @State private var model: SteppingStonesModel?

    var body: some View {
        Group {
            if let model {
                SteppingStonesView(model: model, backToLair: backToLair)
            } else {
                ZStack {
                    SteppingStonesStyle.sky.ignoresSafeArea()
                    ProgressView()
                }
            }
        }
        .task {
            guard model == nil else { return }
            let settings = await Self.settings(from: store)
            let audio = audio
            model = SteppingStonesModel(
                baseNumber: baseNumber, store: store, profileID: profile?.id, sync: sync, settings: settings,
                playSound: { audio?.play($0) })
        }
    }

    /// The synced settings, checked like the web's converter, or the defaults.
    static func settings(from store: (any Store)?) async -> SteppingStonesSettings {
        guard let served = try? await store?.cachedContent(.ruleSettings)?.steppingStones else { return .defaults }
        return .served(numStones: served.numStones, choicesPerHop: served.choicesPerHop)
    }
}

enum SteppingStonesStyle {
    static let sky = LinearGradient(
        colors: [Color(hex: 0x87CEEB), Color(hex: 0xE0F6FF)], startPoint: .top, endPoint: .bottom)
    static let water = LinearGradient(
        stops: [
            .init(color: Color(hex: 0x7FB3D5), location: 0),
            .init(color: Color(hex: 0x5A9BC3), location: 0.55),
            .init(color: Color(hex: 0x4D8CB5), location: 1),
        ],
        startPoint: .top, endPoint: .bottom)
    static let bank = LinearGradient(
        colors: [Color(hex: 0x8FBF6F), Color(hex: 0x7AAB5C)], startPoint: .leading, endPoint: .trailing)
    static let bankLabel = Color(hex: 0x38602F)
    static let rock = [Color(hex: 0xB9B3A6), Color(hex: 0x8A8478), Color(hex: 0x6F6A5F)]
    static let rockNumbered = [Color(hex: 0xE4D57A), Color(hex: 0xC7B54E), Color(hex: 0xA8953C)]
    static let rockTarget = [Color(hex: 0xD2DAE1), Color(hex: 0x9FB0BD), Color(hex: 0x7F909D)]
    /// Violet, not green, so pads stay distinct from the gold landed rocks for
    /// red/green color-blind players (the web's reasoning).
    static let pad = [Color(hex: 0xC6AEF2), Color(hex: 0x9269D6), Color(hex: 0x6F49B8)]
    static let streak = Color(hex: 0xFF6B6B)

    static func stone(_ colors: [Color], size: CGFloat) -> RadialGradient {
        RadialGradient(
            colors: colors, center: UnitPoint(x: 0.32, y: 0.28), startRadius: 0, endRadius: size * 0.75)
    }
}

/// Stepping Stones — the iOS twin of src/components/SteppingStones.jsx: tap the
/// lily pad with the next multiple and the otter hops onto the rock; tap a
/// wrong one and it plunges in, back to the near bank.
struct SteppingStonesView: View {
    let model: SteppingStonesModel
    var backToLair: () -> Void

    @State private var confirmingQuit = false

    var body: some View {
        ZStack {
            SteppingStonesStyle.sky.ignoresSafeArea()
            if let result = model.result {
                ScrollView {
                    SteppingStonesFinish(baseNumber: model.baseNumber, result: result, backToLair: backToLair)
                        .padding(16)
                        .frame(maxWidth: 520)
                        .frame(maxWidth: .infinity)
                }
            } else {
                play
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .alert("Are you sure you want to go back?", isPresented: $confirmingQuit) {
            Button("Yes, back to the Lair", role: .destructive, action: backToLair)
                .accessibilityIdentifier("stones.quit.confirm")
            Button("Keep crossing", role: .cancel) {}
        }
    }

    private var play: some View {
        VStack(spacing: 8) {
            header
            Text("Choose the next multiple of \(model.baseNumber)")
                .font(Typeface.display(22, relativeTo: .title3))
                .foregroundStyle(Palette.charcoal)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            SteppingStonesStream(model: model)
                .frame(maxWidth: 460)
                .frame(maxHeight: .infinity)
            if model.streak > 0 {
                Text("🔥 \(model.streak) in a row!")
                    .font(Typeface.display(20, relativeTo: .headline))
                    .foregroundStyle(SteppingStonesStyle.streak)
                    .accessibilityIdentifier("stones.streak")
            }
            Text(instructions)
                .font(Typeface.body(15, relativeTo: .footnote))
                .foregroundStyle(Palette.charcoal)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var instructions: LocalizedStringKey {
        let n = model.baseNumber
        return "Tap the next number in the \(n)× count: \(n), \(n * 2), \(n * 3)…"
    }

    private var header: some View {
        HStack(spacing: 10) {
            ProgressView(value: Double(model.shownLanded), total: Double(max(1, model.numStones)))
                .tint(Palette.sage)
                .accessibilityLabel(Text("Stones crossed"))
            TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                Text("\(model.shownLanded)/\(model.numStones) · ⏱ \(Self.seconds(model.elapsedMs()))s")
                    .font(Typeface.body(15, relativeTo: .subheadline)).monospacedDigit()
                    .foregroundStyle(Palette.charcoal)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.white.opacity(0.8), in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.kraft, lineWidth: 1.5))
            }
            Button {
                confirmingQuit = true
            } label: {
                Text("← Quit")
                    .font(Typeface.body(15, relativeTo: .subheadline))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Palette.rose.opacity(0.9), in: RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Quit game"))
            .accessibilityIdentifier("stones.quit")
        }
    }

    /// Tenths of a second, as the web shows them.
    static func seconds(_ ms: Double) -> String {
        String(format: "%.1f", ms / 1000)
    }
}

// MARK: - The stream

private struct SteppingStonesStream: View {
    let model: SteppingStonesModel

    static let rockSize: CGFloat = 54
    static let padSize: CGFloat = 58
    static let bankWidth: CGFloat = 45

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack(alignment: .topLeading) {
                SteppingStonesStyle.water
                banks
                ForEach(model.path.indices, id: \.self) { i in
                    rock(i).position(point(model.path[i], in: size))
                }
                if let hop = model.offeredHop {
                    let slots = SteppingStonesPads.place(
                        target: model.path[model.crossing.landed], occupied: occupied, count: hop.choices.count,
                        size: size)
                    ForEach(hop.choices.indices, id: \.self) { i in
                        pad(hop.choices[i].value, index: i)
                            .position(point(slots.indices.contains(i) ? slots[i] : model.path[model.crossing.landed], in: size))
                    }
                    .id("\(model.crossing.landed)-\(model.restarts)")
                }
                otter(in: size)
                if model.showReset {
                    Text("🌊 Oops! Back to the start!")
                        .font(Typeface.display(20, relativeTo: .headline))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Palette.rose.opacity(0.96), in: RoundedRectangle(cornerRadius: 12))
                        .position(x: size.width / 2, y: size.height / 2)
                        .transition(.scale.combined(with: .opacity))
                        .accessibilityIdentifier("stones.reset")
                }
            }
            .animation(.easeOut(duration: 0.2), value: model.showReset)
        }
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .shadow(color: Color(hex: 0x23506E).opacity(0.3), radius: 8)
    }

    private var banks: some View {
        HStack(spacing: 0) {
            bank(Text("🌿 Near Bank"), rotation: -90)
            Spacer(minLength: 0)
            bank(Text("Far Bank 🌿"), rotation: 90)
        }
        .accessibilityHidden(true)
    }

    private func bank(_ label: Text, rotation: Double) -> some View {
        SteppingStonesStyle.bank
            .frame(width: Self.bankWidth)
            .overlay {
                label
                    .font(Typeface.display(22, relativeTo: .title3))
                    .foregroundStyle(SteppingStonesStyle.bankLabel)
                    .fixedSize()
                    .rotationEffect(.degrees(rotation))
            }
    }

    /// The other rocks and the otter: what the pads must not cover.
    private var occupied: [StonePosition] {
        let landed = model.crossing.landed
        return model.path.indices.filter { $0 != landed }.map { model.path[$0] } + [otterRest]
    }

    /// The otter's spot on the near bank or on its rock.
    private var otterRest: StonePosition {
        switch model.otter {
        case .start, .pad: startPosition
        case .rock(let i): model.path[i]
        }
    }

    /// Left of the first rock, before the first hop.
    private var startPosition: StonePosition {
        guard let first = model.path.first else { return StonePosition(x: 10, y: 10) }
        return StonePosition(x: min(50, max(3, first.x - 14)), y: first.y)
    }

    private func point(_ p: StonePosition, in size: CGSize) -> CGPoint {
        CGPoint(x: p.x / 100 * size.width, y: p.y / 100 * size.height)
    }

    @ViewBuilder
    private func rock(_ i: Int) -> some View {
        let stamping = model.stamping?.index == i ? model.stamping?.value : nil
        let value = i < model.shownLanded ? model.crossing.hops[i].target : stamping
        let isTarget = model.offeredHop != nil && i == model.crossing.landed
        let colors = value != nil ? SteppingStonesStyle.rockNumbered
            : isTarget ? SteppingStonesStyle.rockTarget : SteppingStonesStyle.rock
        Circle()
            .fill(SteppingStonesStyle.stone(colors, size: Self.rockSize))
            .frame(width: Self.rockSize, height: Self.rockSize)
            .shadow(color: .black.opacity(0.28), radius: 5, y: 5)
            .overlay {
                if let value {
                    Text(verbatim: "\(value)")
                        .font(Typeface.display(22, relativeTo: .title3))
                        .foregroundStyle(Palette.charcoal)
                } else if isTarget {
                    Text(verbatim: "?")
                        .font(Typeface.display(26, relativeTo: .title2))
                        .foregroundStyle(Color(hex: 0x44525C))
                }
            }
            .scaleEffect(stamping != nil ? 1.12 : 1)
            .animation(.spring(duration: 0.2), value: stamping)
            .accessibilityElement()
            .accessibilityLabel(rockLabel(i, value: value, isTarget: isTarget))
    }

    private func rockLabel(_ i: Int, value: Int?, isTarget: Bool) -> Text {
        if let value { return Text("Rock \(i + 1): \(value)") }
        return isTarget ? Text("Rock \(i + 1): next") : Text("Rock \(i + 1)")
    }

    private func pad(_ value: Int, index: Int) -> some View {
        Button {
            model.tap(index)
        } label: {
            Text(verbatim: "\(value)")
                .font(Typeface.display(22, relativeTo: .title3))
                .foregroundStyle(Palette.charcoal)
                .frame(width: Self.padSize, height: Self.padSize)
                .background(Circle().fill(SteppingStonesStyle.stone(SteppingStonesStyle.pad, size: Self.padSize)))
                .overlay(Circle().strokeBorder(.white.opacity(0.7), lineWidth: 2.5))
                .shadow(color: .black.opacity(0.25), radius: 5, y: 5)
        }
        .buttonStyle(PadButtonStyle())
        .accessibilityLabel(Text("Lily pad with \(value)"))
        .accessibilityIdentifier("stones.pad.\(value)")
    }

    @ViewBuilder
    private func otter(in size: CGSize) -> some View {
        let spot: StonePosition = {
            switch model.otter {
            case .start: return startPosition
            case .rock(let i): return model.path[i]
            case .pad(let i):
                guard model.crossing.hops.indices.contains(padHopIndex) else { return startPosition }
                let hop = model.crossing.hops[padHopIndex]
                let slots = SteppingStonesPads.place(
                    target: model.path[padHopIndex], occupied: occupiedBeforeFall, count: hop.choices.count, size: size)
                return slots.indices.contains(i) ? slots[i] : startPosition
            }
        }()
        ZStack {
            if model.otterSinking {
                SplashView().transition(.opacity)
            }
            Text(verbatim: "🦦")
                .font(.system(size: 38))
                .scaleEffect(model.otterHopping ? 1.2 : 1)
                .offset(y: model.otterSinking ? 22 : model.otterHopping ? -10 : 0)
                .opacity(model.otterSinking ? 0 : 1)
                .animation(.easeIn(duration: SteppingStonesModel.Timing.sink / 1000), value: model.otterSinking)
        }
        .position(point(spot, in: size))
        .animation(.easeOut(duration: SteppingStonesModel.Timing.hop / 1000), value: model.otter)
        .animation(.easeOut(duration: SteppingStonesModel.Timing.hop / 1000), value: model.otterHopping)
        // A fresh otter on the near bank rather than one sliding back underwater.
        .id(model.otterGeneration)
        .accessibilityHidden(true)
    }

    /// While the otter falls the crossing has already restarted, so the pads
    /// it leapt to belong to the rock it was heading for: the one after the
    /// last numbered rock.
    private var padHopIndex: Int { min(model.shownLanded, model.path.count - 1) }

    private var occupiedBeforeFall: [StonePosition] {
        let rest = model.shownLanded == 0 ? startPosition : model.path[model.shownLanded - 1]
        return model.path.indices.filter { $0 != padHopIndex }.map { model.path[$0] } + [rest]
    }
}

private struct PadButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.94 : 1)
    }
}

/// Where the otter plunges: a ripple and a crown of droplets.
private struct SplashView: View {
    @State private var burst = false

    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(.white.opacity(0.75), lineWidth: 3)
                .frame(width: 30, height: 30)
                .scaleEffect(burst ? 2.6 : 0.4)
                .opacity(burst ? 0 : 1)
            ForEach(0..<9, id: \.self) { k in
                let angle = Double.pi * (0.1 + 0.8 * Double(k) / 8)
                Circle()
                    .fill(Color(hex: 0x9ED4F3))
                    .frame(width: 9, height: 9)
                    .offset(
                        x: burst ? -cos(angle) * 44 : 0,
                        y: burst ? -sin(angle) * 58 : 0)
                    .opacity(burst ? 0 : 1)
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: SteppingStonesModel.Timing.sink / 1000)) { burst = true }
        }
    }
}

/// Rings the answer pads around the target rock, spun to whichever of 36
/// orientations keeps every pad farthest from the other rocks and the otter
/// (placePads in SteppingStones.jsx). Positions are percentages of the stream.
enum SteppingStonesPads {
    static let ringMax: Double = 62

    static func place(target: StonePosition, occupied: [StonePosition], count: Int, size: CGSize)
        -> [StonePosition]
    {
        let w = Double(size.width), h = Double(size.height)
        guard w > 0, h > 0, count > 0 else { return [] }
        // Pull the ring in on narrow screens so the pads don't spill onto the banks.
        let ring = min(ringMax, max(46, w * 0.135))
        let tx = target.x / 100 * w, ty = target.y / 100 * h
        let occ = occupied.map { (x: $0.x / 100 * w, y: $0.y / 100 * h) }
        let sector = 2 * Double.pi / Double(count)
        let steps = 36
        var best: [(x: Double, y: Double)] = []
        var bestClear = -Double.infinity
        for s in 0..<steps {
            let rot = Double(s) / Double(steps) * sector
            var pts: [(x: Double, y: Double)] = []
            var minClear = Double.infinity
            for k in 0..<count {
                let a = rot + Double(k) * sector - Double.pi / 2
                let px = tx + cos(a) * ring, py = ty + sin(a) * ring
                pts.append((px, py))
                for o in occ { minClear = min(minClear, hypot(px - o.x, py - o.y)) }
            }
            if minClear > bestClear {
                bestClear = minClear
                best = pts
            }
        }
        return best.map {
            StonePosition(x: min(92, max(8, $0.x / w * 100)), y: min(94, max(6, $0.y / h * 100)))
        }
    }
}

// MARK: - Finish

private struct SteppingStonesFinish: View {
    let baseNumber: Int
    let result: SteppingStonesModel.Result
    var backToLair: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text(verbatim: "💎").font(.system(size: 60)).accessibilityHidden(true)
            Text("You crossed the river!")
                .font(Typeface.display(32, relativeTo: .largeTitle))
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("stones.won")
            Text("You crossed the \(baseNumber)× stones in")
                .font(Typeface.body(17, relativeTo: .headline))
                .foregroundStyle(Palette.kraftDark)
            Text("\(SteppingStonesView.seconds(Double(result.elapsedMs)))s")
                .font(Typeface.display(56, relativeTo: .largeTitle)).monospacedDigit()
                .foregroundStyle(Palette.sage)
                .accessibilityIdentifier("stones.time")
            if result.restarts == 1 {
                Text("with 1 restart along the way").restartNote()
            } else if result.restarts > 1 {
                Text("with \(result.restarts) restarts along the way").restartNote()
            }
            if let verdict = result.verdict {
                verdictText(verdict)
                    .font(Typeface.body(17, relativeTo: .body))
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("stones.verdict")
            }
            board
            Button("Back to the Lair", action: backToLair)
                .buttonStyle(StampButtonStyle())
                .accessibilityIdentifier("stones.back")
        }
        .foregroundStyle(Palette.charcoal)
        .padding(24)
        .frame(maxWidth: .infinity)
        .paperCard()
    }

    private func verdictText(_ verdict: SteppingStonesModel.Verdict) -> Text {
        let s = { (ms: Int) -> String in SteppingStonesView.seconds(Double(ms)) }
        switch verdict {
        case .first: return Text("Your very first \(baseNumber)× crossing — this is the time to beat! 🚩")
        case .newRecord(let previous): return Text("🎉 New record! You beat your old best of \(s(previous))s!")
        case .tied(let previous): return Text("So close — you tied your best of \(s(previous))s!")
        case .slower(let best): return Text("Your best is still \(s(best))s — try again to beat it!")
        }
    }

    private var board: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("🏆 Best \(baseNumber)× times")
                .font(Typeface.display(20, relativeTo: .headline))
                .frame(maxWidth: .infinity)
            ForEach(result.board.indices, id: \.self) { i in
                let entry = result.board[i]
                HStack {
                    Text(verbatim: "\(i + 1)")
                        .foregroundStyle(Palette.kraftDark)
                        .frame(width: 28, alignment: .leading)
                    Text("\(SteppingStonesView.seconds(Double(entry.ms)))s").monospacedDigit()
                    Spacer()
                    if entry.isCurrent {
                        Text("← this run").foregroundStyle(Palette.sage)
                    }
                }
                .font(Typeface.body(16, relativeTo: .body))
                .foregroundStyle(entry.isCurrent ? Palette.charcoal : Palette.pencil)
                .padding(.horizontal, 10)
                .padding(.vertical, 3)
                .background(entry.isCurrent ? Palette.sage.opacity(0.3) : .clear, in: RoundedRectangle(cornerRadius: 6))
                .accessibilityElement(children: .combine)
            }
        }
        .padding(12)
        .background(Color.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.kraft, lineWidth: 2))
        .accessibilityIdentifier("stones.board")
    }
}

private extension Text {
    @MainActor func restartNote() -> some View {
        font(Typeface.body(15, relativeTo: .subheadline)).foregroundStyle(Palette.kraftDark)
    }
}

#Preview {
    NavigationStack {
        SteppingStonesView(
            model: SteppingStonesModel(baseNumber: 3, store: nil, profileID: nil, sync: nil), backToLair: {})
    }
}
