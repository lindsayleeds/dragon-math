import GameRules
import Store
import SwiftUI
import Sync

/// The battle route: builds the model from the environment (Store, Sync, the
/// random source) and the kid's chosen companion, and hands it to `BattleView`.
struct BattleScreen: View {
    let nodeID: Int

    @Environment(\.store) private var store
    /// Who is playing: the guest, or the kid picked on the family picker.
    @Environment(\.currentProfile) private var profile
    @Environment(\.sync) private var sync
    @Environment(\.makeBattleRandomSource) private var makeRandomSource
    @Environment(\.dismiss) private var dismiss
    @State private var model: BattleModel?

    var body: some View {
        Group {
            if let model {
                BattleView(
                    model: model,
                    node: model.node,
                    playerName: profile?.displayName ?? "",
                    onBackToMap: { dismiss() })
            } else {
                PaperBackground()
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .onAppear { model?.resume() }
        .task {
            guard model == nil else { return }
            let companion: Companion
            do {
                companion = try await CompanionChoice.current(in: store, for: profile?.id)
            } catch {
                // The battle goes on with Pip rather than not at all.
                companion = .pip
            }
            guard model == nil, !Task.isCancelled else { return }
            let sync = sync
            let model = BattleModel(
                nodeID: nodeID,
                companion: companion,
                rng: makeRandomSource(),
                onWin: BattleModel.recordingWins(
                    in: store, for: profile?.id, requestSync: { sync?.requestSync() }))
            self.model = model
            model.start()
        }
        .onDisappear { model?.stop() }
    }
}

/// The battle itself: scoreboard, problem, number grid, and the result card.
/// Visuals follow src/pages/BattlePage.jsx and BattlePage.module.css.
struct BattleView: View {
    let model: BattleModel
    let node: MapNode
    let playerName: String
    var onBackToMap: () -> Void

    /// The regular-node opponent. The web shows a goblin (👺); iOS uses a
    /// fox instead, keeping to CLAUDE.md's nature-forward, no-dark-themes rule.
    private let opponentIcon = "🦊"

    var body: some View {
        let state = model.state
        ZStack {
            PaperBackground()
            Color.clear
                .overlay {
                    Image("BattleWallpaperWorld\(node.worldID)")
                        .resizable()
                        .scaledToFill()
                }
                .clipped()
                .ignoresSafeArea()
                .accessibilityHidden(true)

            VStack(spacing: 16) {
                header
                scoreboard(state)
                problemCard(state)
                BattleGrid(model: model, opponentIcon: opponentIcon)
                    .frame(maxHeight: .infinity)
                lockedNote
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: 720)

            if state.status != .playing {
                BattleResultCard(
                    won: state.status == .won,
                    target: state.target,
                    matchDurationMs: state.matchDurationMs,
                    onRetry: { model.retry() },
                    onBackToMap: onBackToMap)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
            }
        }
        .animation(.easeOut(duration: 0.25), value: state.status)
    }

    private var header: some View {
        HStack {
            Button(action: onBackToMap) {
                Text("⌂ map")
            }
            .buttonStyle(StampButtonStyle(kind: .secondary))
            .accessibilityLabel(Text("Return to the map"))
            .accessibilityIdentifier("battle.back")
            companionTag
            Spacer()
            HStack(spacing: 6) {
                Text(verbatim: node.icon).accessibilityHidden(true)
                Text(node.localizedLabel)
            }
            .font(Typeface.display(24, relativeTo: .title2))
        }
        .foregroundStyle(Palette.charcoal)
    }

    /// Who came along. Using the Bond Power is #139.
    private var companionTag: some View {
        let companion = model.companion
        return HStack(spacing: 4) {
            Text(verbatim: companion.icon).accessibilityHidden(true)
            Text(verbatim: companion.name)
        }
        .font(Typeface.body(17, relativeTo: .callout))
        .foregroundStyle(Palette.charcoal)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(Color(highlight: companion.bondPower.highlightColor).opacity(0.45))
        .rotationEffect(.degrees(-2))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Your companion: \(companion.name)"))
        .accessibilityValue(Text(verbatim: companion.bondPowerName))
        .accessibilityIdentifier("battle.companion")
    }

    private func scoreboard(_ state: BattleState) -> some View {
        HStack(spacing: 10) {
            ScoreCard(
                icon: "⚔️", name: Text(verbatim: playerName), score: state.playerScore, target: state.target,
                rotation: -1, tape: Palette.sage)
                .accessibilityIdentifier("score.player")
            Text("vs.")
                .font(Typeface.display(22, relativeTo: .title3))
                .foregroundStyle(Palette.kraftDark)
                .rotationEffect(.degrees(-6))
            ScoreCard(
                icon: opponentIcon, name: Text("fox"), score: state.aiScore, target: state.target,
                rotation: 1, tape: Palette.rose, grabbing: state.aiSolvedAnswer != nil)
                .accessibilityIdentifier("score.opponent")
        }
    }

    private func problemCard(_ state: BattleState) -> some View {
        VStack(spacing: 4) {
            Text("tap the answer")
                .font(Typeface.body(15, relativeTo: .caption))
                .foregroundStyle(Palette.kraftDark)
            HStack(spacing: 0) {
                Text(verbatim: "\(model.problemText) = ")
                if let answer = state.aiSolvedAnswer {
                    Text(verbatim: "\(answer)").foregroundStyle(Palette.rose)
                } else {
                    Text(verbatim: "?")
                }
            }
            .font(Typeface.display(40, relativeTo: .largeTitle))
            .foregroundStyle(Palette.charcoal)
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 12)
        .paperCard(rotation: -0.5)
        .overlay(alignment: .top) { WashiTape(color: Palette.mustard, rotation: -2).offset(y: -10) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(model.problemText) = \(state.aiSolvedAnswer.map(String.init) ?? "?")"))
        .accessibilityIdentifier("battle.problem")
    }

    /// Shown during the wrong-tap pause, so the lock never relies on the
    /// dimming alone. Keeps its height so the grid doesn't jump.
    private var lockedNote: some View {
        Text("Take a breath — the numbers wake up in a moment.")
            .font(Typeface.body(16, relativeTo: .callout))
            .foregroundStyle(Palette.pencil)
            .multilineTextAlignment(.center)
            .opacity(model.gridMode == .locked ? 1 : 0)
            .accessibilityHidden(model.gridMode != .locked)
    }
}

/// One side of the scoreboard: icon, name, "3/10" and a progress bar.
private struct ScoreCard: View {
    let icon: String
    let name: Text
    let score: Int
    let target: Int
    let rotation: Double
    let tape: Color
    var grabbing = false

    var body: some View {
        HStack(spacing: 10) {
            Text(verbatim: icon)
                .font(.system(size: 34))
                .scaleEffect(grabbing ? 1.2 : 1)
                .animation(.spring(duration: 0.3), value: grabbing)
            VStack(alignment: .leading, spacing: 2) {
                name
                    .font(Typeface.body(16, relativeTo: .callout))
                    .foregroundStyle(Palette.pencil)
                    .lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text(score, format: .number)
                        .font(Typeface.display(28, relativeTo: .title))
                    Text(verbatim: "/\(target)")
                        .font(Typeface.display(16, relativeTo: .callout))
                        .foregroundStyle(Palette.kraftDark)
                }
                .foregroundStyle(Palette.charcoal)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(Palette.paperRule.opacity(0.5))
                        Rectangle().fill(tape)
                            .frame(width: geo.size.width * min(1, Double(score) / Double(max(target, 1))))
                    }
                }
                .frame(height: 6)
                .animation(.easeOut(duration: 0.3), value: score)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .paperCard(rotation: rotation)
        .overlay(alignment: .topLeading) { WashiTape(color: tape, width: 46, rotation: -8).offset(x: -6, y: -8) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(name): \(score) of \(target)"))
        .accessibilityValue(Text(verbatim: "\(score)"))
    }
}

/// The number grid. Spacers (nil) keep their place so the layout's shape
/// shows; cells hide their numbers while blanking and go inert while locked.
private struct BattleGrid: View {
    let model: BattleModel
    let opponentIcon: String

    private let gap: CGFloat = 8

    var body: some View {
        let state = model.state
        let mode = model.gridMode
        let cols = max(state.layout.cols, 1)
        let rows = max(state.layout.rows, 1)
        GeometryReader { geo in
            let side = max(0, min(
                (geo.size.width - gap * CGFloat(cols - 1)) / CGFloat(cols),
                (geo.size.height - gap * CGFloat(rows - 1)) / CGFloat(rows),
                120))
            VStack(spacing: gap) {
                ForEach(0..<rows, id: \.self) { r in
                    HStack(spacing: gap) {
                        ForEach(0..<cols, id: \.self) { c in
                            let index = r * cols + c
                            if index < state.grid.count, let value = state.grid[index] {
                                BattleCell(
                                    index: index, value: value, mode: mode,
                                    wrong: state.wrongCellIndex == index,
                                    eating: state.aiEatCellIndex == index,
                                    opponentIcon: opponentIcon,
                                    side: side,
                                    onTap: { model.tap(index) })
                            } else {
                                Color.clear.frame(width: side, height: side)
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .opacity(mode == .locked ? 0.7 : 1)
        .saturation(mode == .locked ? 0.85 : 1)
        .animation(.easeOut(duration: 0.15), value: mode)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("battle.grid")
        .accessibilityValue(Text(verbatim: mode.rawValue))
    }
}

private struct BattleCell: View {
    let index: Int
    let value: Int
    let mode: BattleModel.GridMode
    let wrong: Bool
    let eating: Bool
    let opponentIcon: String
    let side: CGFloat
    var onTap: () -> Void

    /// The web's alternating tilts, so the grid looks hand-placed.
    private var tilt: Double { [-0.8, 0.6, -0.3][index % 3] }
    private var showsNumber: Bool { mode != .blank || eating }

    var body: some View {
        Button(action: onTap) {
            ZStack {
                Text(verbatim: showsNumber ? "\(value)" : "")
                    .font(Typeface.display(side * 0.4))
                    .minimumScaleFactor(0.5)
                    .foregroundStyle(wrong ? Color(hex: 0x8C2A2A) : Palette.charcoal)
                    .scaleEffect(eating ? 1.3 : 1)
                if eating {
                    Text(verbatim: opponentIcon)
                        .font(.system(size: side * 0.4))
                        .offset(x: side * 0.3, y: side * 0.3)
                }
            }
            .frame(width: side, height: side)
            .background(background)
            .overlay(border)
            .shadow(color: Palette.charcoal.opacity(0.10), radius: 0, x: 2, y: 3)
            .rotationEffect(.degrees(tilt))
            .modifier(Shake(amount: wrong ? 1 : 0))
            .animation(.easeOut(duration: 0.35), value: wrong)
        }
        .buttonStyle(CellPressStyle())
        .disabled(mode != .ready)
        .accessibilityIdentifier("cell.\(index)")
        .accessibilityLabel(Text(verbatim: showsNumber ? "\(value)" : ""))
    }

    @ViewBuilder private var background: some View {
        if wrong {
            Palette.rose.opacity(0.25)
        } else if eating {
            LinearGradient(colors: [Color(hex: 0xC3E8AC), Color(hex: 0x9FD47F)], startPoint: .top, endPoint: .bottom)
        } else {
            Palette.card
        }
    }

    @ViewBuilder private var border: some View {
        if wrong {
            Rectangle().strokeBorder(Palette.rose, lineWidth: 2)
        } else if eating {
            Rectangle().strokeBorder(Palette.sage, lineWidth: 2)
        } else {
            Rectangle().strokeBorder(Palette.kraft, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
        }
    }
}

private struct CellPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// The wrong-tap shake: a couple of side-to-side swings as `amount` goes 0→1.
private struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 6 * sin(amount * .pi * 4), y: 0))
    }
}

/// Win or lose: the result card with try again and back to map.
private struct BattleResultCard: View {
    let won: Bool
    let target: Int
    let matchDurationMs: Double?
    var onRetry: () -> Void
    var onBackToMap: () -> Void

    var body: some View {
        ZStack {
            Palette.charcoal.opacity(0.35).ignoresSafeArea()
            VStack(spacing: 12) {
                Text(verbatim: won ? "⭐" : "💔")
                    .font(.system(size: 56))
                    .accessibilityHidden(true)
                Text(won ? "Victory!" : "So close!")
                    .font(Typeface.display(38, relativeTo: .largeTitle))
                    .foregroundStyle(Palette.charcoal)
                    .underline(color: Palette.rose)
                    .accessibilityIdentifier("result.title")
                Group {
                    if won {
                        Text("You reached \(target) before your foe — onward, traveler.")
                    } else {
                        Text("Your foe reached \(target) first. Take a breath and try again?")
                    }
                }
                .font(Typeface.body(18, relativeTo: .body))
                .italic()
                .foregroundStyle(Palette.pencil)
                .multilineTextAlignment(.center)
                if won, let ms = matchDurationMs {
                    Text("Total time: \(Duration.milliseconds(ms).formatted(.units(allowed: [.minutes, .seconds], width: .abbreviated)))")
                        .font(Typeface.display(20, relativeTo: .title3))
                        .foregroundStyle(Palette.kraftDark)
                }
                HStack(spacing: 18) {
                    if won {
                        Button(action: onRetry) { Text("↻ play again") }
                            .buttonStyle(StampButtonStyle(kind: .secondary))
                            .accessibilityIdentifier("result.retry")
                        Button(action: onBackToMap) { Text("→ back to map") }
                            .buttonStyle(StampButtonStyle(kind: .primary))
                            .accessibilityIdentifier("result.map")
                    } else {
                        Button(action: onBackToMap) { Text("→ back to map") }
                            .buttonStyle(StampButtonStyle(kind: .secondary))
                            .accessibilityIdentifier("result.map")
                        Button(action: onRetry) { Text("↻ one more try") }
                            .buttonStyle(StampButtonStyle(kind: .primary))
                            .accessibilityIdentifier("result.retry")
                    }
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 30)
            .padding(.vertical, 32)
            .frame(maxWidth: 440)
            .paperCard(rotation: -1.2)
            .overlay(alignment: .topLeading) { WashiTape(color: Palette.sky, width: 96, rotation: -10).offset(x: -20, y: -10) }
            .padding(24)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("battle.result")
        }
    }
}
