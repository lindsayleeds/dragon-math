import Audio
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
    @Environment(\.audio) private var audio
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
            // Who comes along, and who's befriended already (so a boss win
            // celebrates only a new friend). Without progress the battle goes
            // on with Pip rather than not at all.
            var companion = Companion.pip
            var owned: Set<String> = [Companion.pip.id]
            if let store, let profileID = profile?.id,
               let progress = try? await store.progress(for: profileID) {
                companion = CompanionChoice.current(in: progress)
                owned = Set(Companion.befriended(nodesWon: progress.nodesWon).map(\.id))
            }
            let pace = await PlayPace.current(for: profile, in: store)
            guard model == nil, !Task.isCancelled else { return }
            let sync = sync
            let audio = audio
            let store = store
            let profileID = profile?.id
            let model = BattleModel(
                nodeID: nodeID,
                companion: companion,
                ownedCompanionIDs: owned,
                rng: makeRandomSource(),
                pace: pace,
                prizeRNG: makeRandomSource(),
                prizeContext: { await PrizeContext.load(from: store, for: profileID) },
                onWin: BattleModel.recordingWins(
                    in: store, for: profile?.id, requestSync: { sync?.requestSync() }),
                playSound: { audio?.play($0) })
            self.model = model
            model.start()
        }
        .onDisappear { model?.stop() }
    }
}

/// The battle itself: scoreboard, problem, number grid, and the result card —
/// and on a boss node its intro and, the first time it's beaten, the
/// befriending celebration (`BattleModel.Stage`). Visuals follow
/// src/pages/BattlePage.jsx and BattlePage.module.css; the arrangement (side
/// by side on iPad landscape, one column elsewhere) comes from
/// `BattleArrangement`.
struct BattleView: View {
    let model: BattleModel
    let node: MapNode
    let playerName: String
    var onBackToMap: () -> Void

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var opponentIcon: String { model.opponent.icon }

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

            GeometryReader { geo in
                let arrangement = BattleArrangement.forContainer(
                    horizontalSizeClass: horizontalSizeClass, size: geo.size)
                content(arrangement, state)
                    .frame(width: geo.size.width, height: geo.size.height)
            }
            // The board is sized to the screen, so its text stops growing at
            // the second accessibility size; the result card scales fully.
            .dynamicTypeSize(...DynamicTypeSize.accessibility2)

            switch model.stage {
            case .bossIntro:
                BossIntroCard(node: node, onFight: { model.fight() }, onBackToMap: onBackToMap)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
            case .befriended(let companion):
                BefriendedCard(companion: companion, onContinue: { model.continueAfterBefriending() })
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
            case .result:
                BattleResultCard(
                    won: state.status == .won,
                    crowned: model.outcome?.crowned == true,
                    prize: model.prize,
                    target: state.target,
                    matchDurationMs: state.matchDurationMs,
                    onRetry: { model.retry() },
                    onBackToMap: onBackToMap)
                    .motionSafeTransition(.opacity.combined(with: .scale(scale: 0.95)))
            case .battle:
                EmptyView()
            }
        }
        .animation(.easeOut(duration: 0.25), value: model.stage)
    }

    @ViewBuilder
    private func content(_ arrangement: BattleArrangement, _ state: BattleState) -> some View {
        switch arrangement {
        case .sideBySide:
            VStack(spacing: 18) {
                header(arrangement, showsCompanion: false)
                HStack(alignment: .top, spacing: 32) {
                    VStack(spacing: 22) {
                        scoreboard(state, arrangement, axis: .vertical)
                        companionPanel
                        Spacer(minLength: 0)
                    }
                    .padding(.top, 12)
                    .frame(width: 300)
                    VStack(spacing: 16) {
                        problemCard(state, arrangement)
                        BattleGrid(model: model, opponentIcon: opponentIcon)
                            .frame(maxHeight: .infinity)
                        gridNote(arrangement)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 16)
            .frame(maxWidth: 1180)
        case .stacked, .compact:
            let compact = arrangement.isCompact
            VStack(spacing: compact ? 12 : 16) {
                header(arrangement, showsCompanion: true)
                scoreboard(state, arrangement, axis: .horizontal)
                problemCard(state, arrangement)
                BattleGrid(model: model, opponentIcon: opponentIcon)
                    .frame(maxHeight: .infinity)
                gridNote(arrangement)
            }
            .padding(.horizontal, compact ? 12 : 24)
            .padding(.vertical, compact ? 8 : 16)
            .frame(maxWidth: 720)
        }
    }

    private func header(_ arrangement: BattleArrangement, showsCompanion: Bool) -> some View {
        HStack(spacing: 10) {
            Button(action: onBackToMap) {
                Text("⌂ map")
            }
            .buttonStyle(StampButtonStyle(kind: .secondary))
            .accessibilityLabel(Text("Return to the map"))
            .accessibilityIdentifier("battle.back")
            if showsCompanion {
                bondButton(side: arrangement.isCompact ? 44 : 52)
                companionTag(arrangement)
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                Text(verbatim: node.icon).accessibilityHidden(true)
                Text(node.localizedLabel)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .font(Typeface.display(arrangement.isCompact ? 22 : 26, relativeTo: .title2))
        }
        .foregroundStyle(Palette.charcoal)
    }

    /// The Bond Power button; VoiceOver hears what the power did.
    private func bondButton(side: CGFloat) -> some View {
        BondPowerButton(companion: model.companion, status: model.bondStatus, side: side) {
            model.useBondPower()
            if model.bondStatus.phase == .active {
                AccessibilityNotification.Announcement(
                    BondPowerButton.announcement(for: model.bondPower.kind)
                ).post()
            }
        }
    }

    /// Who came along, as a tag in the header of the one-column layouts, next
    /// to the Bond Power button (which shows the companion's icon).
    private func companionTag(_ arrangement: BattleArrangement) -> some View {
        let companion = model.companion
        return Text(verbatim: companion.name)
            .lineLimit(1)
        .font(Typeface.body(arrangement.isCompact ? 15 : 17, relativeTo: .callout))
        .foregroundStyle(Palette.charcoal)
        .padding(.horizontal, arrangement.isCompact ? 8 : 10)
        .padding(.vertical, 4)
        .background(Color(highlight: companion.bondPower.highlightColor).opacity(0.45))
        .rotationEffect(.degrees(-2))
        .modifier(CompanionAccessibility(companion: companion))
    }

    /// Who came along and their Bond Power button, as its own panel under the
    /// scoreboard when the layout is side by side (the web's companion dock).
    private var companionPanel: some View {
        let companion = model.companion
        return HStack(spacing: 12) {
            bondButton(side: 78)
            VStack(alignment: .leading, spacing: 2) {
                Text("your teammate")
                    .font(Typeface.body(15, relativeTo: .caption))
                    .foregroundStyle(Palette.kraftDark)
                Text(verbatim: companion.name)
                    .font(Typeface.display(24, relativeTo: .title3))
                    .foregroundStyle(Palette.charcoal)
                Text(verbatim: companion.bondPowerName)
                    .font(Typeface.body(15, relativeTo: .caption))
                    .foregroundStyle(Palette.pencil)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .modifier(CompanionAccessibility(companion: companion))
            Spacer(minLength: 0)
        }
        .padding(14)
        .paperCard(rotation: 0.8)
        .overlay(alignment: .topTrailing) {
            WashiTape(color: Palette.lavender, width: 50, rotation: 10).offset(x: 6, y: -8)
        }
        .accessibilityElement(children: .contain)
    }

    private func scoreboard(_ state: BattleState, _ arrangement: BattleArrangement, axis: Axis) -> some View {
        let compact = arrangement.isCompact
        let player = ScoreCard(
            icon: "⚔️", name: playerName, score: state.playerScore, target: state.target,
            rotation: -1, tape: Palette.sage, compact: compact)
            .accessibilityIdentifier("score.player")
        let versus = Text("vs.")
            .font(Typeface.display(compact ? 18 : 22, relativeTo: .title3))
            .foregroundStyle(Palette.kraftDark)
            .rotationEffect(.degrees(-6))
        // The web's `scoreCard_foe` (sky tape and bar) or `scoreCard_boss`
        // (rose, and the dragon tilted and a little sepia).
        let foe = model.opponent
        let opponent = ScoreCard(
            icon: foe.icon, art: foe.art, name: String(localized: foe.name), score: state.aiScore, target: state.target,
            rotation: 1, tape: foe.isBoss ? Palette.rose : Palette.sky, boss: foe.isBoss,
            grabbing: state.aiSolvedAnswer != nil, paused: state.aiLocked, compact: compact)
            .accessibilityIdentifier("score.opponent")
        return Group {
            if axis == .vertical {
                VStack(spacing: 6) { player; versus; opponent }
            } else {
                HStack(spacing: compact ? 6 : 10) { player; versus; opponent }
            }
        }
    }

    private func problemCard(_ state: BattleState, _ arrangement: BattleArrangement) -> some View {
        let compact = arrangement.isCompact
        return VStack(spacing: 4) {
            Text("tap the answer")
                .font(Typeface.body(compact ? 14 : 15, relativeTo: .caption))
                .foregroundStyle(Palette.kraftDark)
            HStack(spacing: 0) {
                Text(verbatim: "\(model.problemText) = ")
                if let answer = state.aiSolvedAnswer {
                    Text(verbatim: "\(answer)").foregroundStyle(Palette.roseInk)
                } else {
                    Text(verbatim: "?")
                }
            }
            .font(Typeface.display(compact ? 32 : 40, relativeTo: .largeTitle))
            .foregroundStyle(Palette.charcoal)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        }
        .padding(.horizontal, compact ? 20 : 28)
        .padding(.vertical, compact ? 8 : 12)
        .paperCard(rotation: -0.5)
        .overlay(alignment: .top) { WashiTape(color: Palette.mustard, rotation: -2).offset(y: -10) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(model.problemText) = \(state.aiSolvedAnswer.map(String.init) ?? "?")"))
        .accessibilityIdentifier("battle.problem")
    }

    /// The line under the grid: the wrong-tap pause, so the lock never relies
    /// on the dimming alone, or else the armed petal shield (the web's
    /// shield banner). Keeps its height so the grid doesn't jump.
    private func gridNote(_ arrangement: BattleArrangement) -> some View {
        let locked = model.gridMode == .locked
        let shielded = !locked && model.state.shieldActive && model.gridMode == .ready
        return ZStack {
            Text("Take a breath — the numbers wake up in a moment.")
                .font(Typeface.body(arrangement.isCompact ? 15 : 16, relativeTo: .callout))
                .foregroundStyle(Palette.pencil)
                .multilineTextAlignment(.center)
                .opacity(locked ? 1 : 0)
                .accessibilityHidden(!locked)
            Text("🌸 petal shield ready — one wrong tap forgiven")
                .bold()
                .font(Typeface.body(arrangement.isCompact ? 14 : 15, relativeTo: .callout))
                .foregroundStyle(Color(hex: 0x8A3D5C))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, 14)
                .padding(.vertical, 5)
                .background(
                    Capsule().fill(LinearGradient(
                        colors: [Color(hex: 0xFFE3EE), Color(hex: 0xFFC4DD)], startPoint: .top, endPoint: .bottom)))
                .overlay(Capsule().strokeBorder(Color(hex: 0xFFB0D0), lineWidth: 2))
                .shadow(color: Palette.charcoal.opacity(0.10), radius: 0, x: 2, y: 3)
                .scaleEffect(shielded ? 1 : 0.8)
                .opacity(shielded ? 1 : 0)
                .accessibilityHidden(!shielded)
                .accessibilityIdentifier("battle.shield")
        }
        .animation(.spring(duration: 0.4, bounce: 0.4), value: shielded)
    }
}

/// The companion's accessibility, shared by the header tag and the panel so
/// either reads the same (only one is on screen at a time).
private struct CompanionAccessibility: ViewModifier {
    let companion: Companion

    func body(content: Content) -> some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Your companion: \(companion.name)"))
            .accessibilityValue(Text(verbatim: companion.bondPowerName))
            .accessibilityIdentifier("battle.companion")
    }
}

/// One side of the scoreboard: icon, name, "3/10" and a progress bar.
private struct ScoreCard: View {
    let icon: String
    /// A boss's imageset, drawn in place of `icon`.
    var art: String? = nil
    let name: String
    let score: Int
    let target: Int
    let rotation: Double
    let tape: Color
    /// The boss variant: its icon rests tilted and a little faded.
    var boss = false
    var grabbing = false
    /// The opponent is held by Sunfire Hold.
    var paused = false
    /// iPhone portrait: smaller type and padding (the web's max-width 600px).
    var compact = false

    var body: some View {
        HStack(spacing: compact ? 6 : 10) {
            iconView
                .rotationEffect(.degrees(boss ? (grabbing ? -20 : -8) : (grabbing ? -12 : 0)), anchor: .init(x: 0.5, y: 0.7))
                .scaleEffect(grabbing ? 1.25 : 1, anchor: .init(x: 0.5, y: 0.7))
                .offset(y: grabbing ? -6 : 0)
                .motionSafeAnimation(.spring(duration: 0.35, bounce: 0.5), value: grabbing)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: name)
                    .font(Typeface.body(compact ? 14 : 16, relativeTo: .callout))
                    .foregroundStyle(Palette.pencil)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text(score, format: .number)
                        .font(Typeface.display(compact ? 22 : 28, relativeTo: .title))
                    Text(verbatim: "/\(target)")
                        .font(Typeface.display(compact ? 14 : 16, relativeTo: .callout))
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
        .padding(compact ? 8 : 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .paperCard(rotation: rotation)
        .grayscale(paused ? 0.55 : 0)
        .overlay {
            if paused {
                OpponentPausedOverlay()
                    .rotationEffect(.degrees(rotation))
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.3), value: paused)
        .overlay(alignment: .topLeading) { WashiTape(color: tape, width: 46, rotation: -8).offset(x: -6, y: -8) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(ScoreAccessibility.label(name: name, score: score, target: target, paused: paused)))
        .accessibilityValue(Text(verbatim: "\(score)"))
    }

    @ViewBuilder private var iconView: some View {
        let side: CGFloat = compact ? 30 : 40
        if let art {
            Image(art)
                .resizable()
                .scaledToFit()
                .frame(width: side, height: side)
                .saturation(0.8)
                .accessibilityHidden(true)
        } else {
            Text(verbatim: icon)
                .font(.system(size: compact ? 26 : 34))
                .saturation(boss ? 0.7 : 1)
                .accessibilityHidden(true)
        }
    }
}

/// The number grid. Spacers (nil) keep their place so the layout's shape
/// shows; cells hide their numbers while blanking and go inert while locked.
private struct BattleGrid: View {
    let model: BattleModel
    let opponentIcon: String

    var body: some View {
        let state = model.state
        let mode = model.gridMode
        let cols = max(state.layout.cols, 1)
        let rows = max(state.layout.rows, 1)
        GeometryReader { geo in
            let metrics = BattleGridMetrics(cols: cols, rows: rows, available: geo.size)
            let fits = metrics.size(cols: cols, rows: rows).height <= geo.size.height
            // Cells never go under the 44pt tap minimum; a grid too tall for
            // a short window scrolls instead.
            ScrollView(.vertical) {
                cells(state: state, mode: mode, cols: cols, rows: rows, metrics: metrics)
                    .background { shieldGlow(state.shieldActive && mode == .ready) }
                    .frame(width: geo.size.width, height: fits ? geo.size.height : nil)
            }
            .scrollDisabled(fits)
            .scrollBounceBehavior(.basedOnSize)
        }
        .opacity(mode == .locked ? 0.7 : 1)
        .saturation(mode == .locked ? 0.85 : 1)
        .animation(.easeOut(duration: 0.15), value: mode)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("battle.grid")
        .accessibilityValue(Text(verbatim: mode.rawValue))
    }

    private func cells(
        state: BattleState, mode: BattleModel.GridMode, cols: Int, rows: Int, metrics: BattleGridMetrics
    ) -> some View {
        VStack(spacing: metrics.gap) {
            ForEach(0..<rows, id: \.self) { r in
                HStack(spacing: metrics.gap) {
                    ForEach(0..<cols, id: \.self) { c in
                        let index = r * cols + c
                        if index < state.grid.count, let value = state.grid[index] {
                            BattleCell(
                                index: index, value: value, mode: mode,
                                wrong: state.wrongCellIndex == index,
                                eating: state.aiEatCellIndex == index,
                                opponentIcon: opponentIcon,
                                side: metrics.side,
                                bond: model.cellBond(index),
                                bondColor: Color(highlight: state.hintColor),
                                onTap: { model.tap(index) })
                        } else {
                            Color.clear.frame(width: metrics.side, height: metrics.side)
                        }
                    }
                }
            }
        }
    }

    /// The petal shield's pink halo round the cells (`.gridShielded`).
    private func shieldGlow(_ on: Bool) -> some View {
        RoundedRectangle(cornerRadius: 14)
            .stroke(Color(hex: 0xFFB0D0).opacity(0.55), lineWidth: 3)
            .shadow(color: Color(hex: 0xFFC4DD).opacity(0.8), radius: 12)
            .padding(-8)
            .opacity(on ? 1 : 0)
            .animation(.easeOut(duration: 0.2), value: on)
            .accessibilityHidden(true)
    }
}

/// One number cell. Shared with the Dragon's Trial grid (TrialScreen).
struct BattleCell: View {
    let index: Int
    let value: Int
    let mode: BattleModel.GridMode
    let wrong: Bool
    let eating: Bool
    let opponentIcon: String
    let side: CGFloat
    /// A Bond Power's mark on this cell (battle only).
    var bond: BattleModel.CellBond? = nil
    /// The hint/reveal highlight.
    var bondColor: Color = Palette.sky
    var onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The web's alternating tilts, so the grid looks hand-placed.
    private var tilt: Double { [-0.8, 0.6, -0.3][index % 3] }
    private var showsNumber: Bool { (mode != .blank || eating) && !inert }
    /// Mushroom-covered and zapped cells can't be tapped.
    private var inert: Bool { bond == .covered || bond == .zapped }
    private var glows: Bool { bond == .hinted || bond == .revealed }

    var body: some View {
        Button(action: onTap) {
            ZStack {
                Text(verbatim: showsNumber ? "\(value)" : "")
                    .font(Typeface.display(side * 0.4))
                    .minimumScaleFactor(0.5)
                    .foregroundStyle(wrong ? Color(hex: 0x8C2A2A) : Palette.charcoal)
                    .scaleEffect(eating ? 1.3 : 1)
                if bond == .covered {
                    Text(verbatim: "🍄")
                        .font(.system(size: side * 0.45))
                        .transition(.scale(scale: 0.5).combined(with: .opacity))
                }
                if eating {
                    Text(verbatim: opponentIcon)
                        .font(.system(size: side * 0.4))
                        .offset(x: side * 0.3, y: side * 0.3)
                }
            }
            .frame(width: side, height: side)
            .background(background)
            .overlay(border)
            // The rose flash plus a cross, so a wrong tap never shows by
            // colour alone (#169).
            .answerFeedback(wrong ? .tryAgain : nil, size: max(14, side * 0.26), inset: 3, announces: false)
            .opacity(bond == .zapped ? 0.55 : 1)
            .shadow(color: Palette.charcoal.opacity(0.10), radius: 0, x: 2, y: 3)
            // The hint's glow (`.cellHinted`, `.cellRevealed`): a white rim and
            // a halo of the power's colour; the revealed answer glows hardest.
            .shadow(color: glows ? bondColor : .clear, radius: bond == .revealed ? 10 : 7)
            .scaleEffect(bond == .revealed ? 1.06 : 1)
            .rotationEffect(.degrees(glows ? 0 : tilt))
            // Under Reduce Motion a wrong tap only turns the cell rose.
            .modifier(Shake(amount: wrong && !reduceMotion ? 1 : 0))
            .animation(.easeOut(duration: 0.35), value: wrong)
            .motionSafeAnimation(.spring(duration: 0.45, bounce: 0.45), fallback: .easeOut(duration: 0.2), value: bond)
        }
        .buttonStyle(CellPressStyle())
        .zIndex(glows ? 1 : 0)
        .disabled(mode != .ready || inert)
        .accessibilityIdentifier("cell.\(index)")
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityLabel: Text {
        switch bond {
        case .covered: Text("Covered by a mushroom")
        case .zapped: Text("Zapped by lightning")
        default: Text(verbatim: showsNumber ? "\(value)" : "")
        }
    }

    private var accessibilityValue: Text {
        switch bond {
        case .hinted: Text("hint")
        case .revealed: Text("the answer")
        default: wrong ? Text(AnswerFeedback.tryAgain.label) : Text(verbatim: "")
        }
    }

    @ViewBuilder private var background: some View {
        if wrong {
            Palette.rose.opacity(0.25)
        } else if eating {
            LinearGradient(colors: [Color(hex: 0xC3E8AC), Color(hex: 0x9FD47F)], startPoint: .top, endPoint: .bottom)
        } else if bond == .covered {
            LinearGradient(colors: [Color(hex: 0xD5E8C8), Color(hex: 0xB8D2A3)], startPoint: .top, endPoint: .bottom)
        } else if bond == .zapped {
            LinearGradient(colors: [Palette.charcoal, Palette.pencil], startPoint: .top, endPoint: .bottom)
        } else if glows {
            bondColor
        } else {
            Palette.card
        }
    }

    @ViewBuilder private var border: some View {
        if wrong {
            Rectangle().strokeBorder(Palette.rose, lineWidth: 2)
        } else if eating {
            Rectangle().strokeBorder(Palette.sage, lineWidth: 2)
        } else if bond == .covered {
            Rectangle().strokeBorder(Palette.sage, lineWidth: 1.5)
        } else if bond == .zapped {
            Rectangle().strokeBorder(Palette.charcoal, lineWidth: 1.5)
        } else if glows {
            Rectangle().strokeBorder(.white.opacity(0.9), lineWidth: bond == .revealed ? 3 : 2)
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
    /// A won boss: the crown and "The dragon bows to you!".
    var crowned = false
    let prize: PrizeState
    let target: Int
    let matchDurationMs: Double?
    var onRetry: () -> Void
    var onBackToMap: () -> Void

    var body: some View {
        ZStack {
            Palette.charcoal.opacity(0.35).ignoresSafeArea()
            // Scrolls when the prize and large type make the card taller than
            // the screen; centred otherwise.
            ScrollView {
                card.frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .defaultScrollAnchor(.center, for: .alignment)
        }
    }

    private var card: some View {
        VStack(spacing: 12) {
            Text(verbatim: won ? (crowned ? "👑" : "⭐") : "💔")
                .font(.system(size: 56))
                .accessibilityHidden(true)
            Text(won ? "Victory!" : "So close!")
                .font(Typeface.display(38, relativeTo: .largeTitle))
                .foregroundStyle(Palette.charcoal)
                .underline(color: Palette.rose)
                .accessibilityIdentifier("result.title")
            Group {
                if won && crowned {
                    Text("The dragon bows to you!")
                } else if won {
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
            if won {
                PrizeReveal(prize: prize)
            }
            // Side by side, or stacked when large text won't fit them.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 18) { resultButtons }
                VStack(spacing: 14) { resultButtons }
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

    /// The arrows are decoration; VoiceOver hears the words.
    @ViewBuilder private var resultButtons: some View {
        if won {
            Button(action: onRetry) { Text("↻ play again") }
                .buttonStyle(StampButtonStyle(kind: .secondary))
                .accessibilityLabel(Text("Play this battle again"))
                .accessibilityIdentifier("result.retry")
            Button(action: onBackToMap) { Text("→ back to map") }
                .buttonStyle(StampButtonStyle(kind: .primary))
                .accessibilityLabel(Text("Return to the map"))
                .accessibilityIdentifier("result.map")
        } else {
            Button(action: onBackToMap) { Text("→ back to map") }
                .buttonStyle(StampButtonStyle(kind: .secondary))
                .accessibilityLabel(Text("Return to the map"))
                .accessibilityIdentifier("result.map")
            Button(action: onRetry) { Text("↻ one more try") }
                .buttonStyle(StampButtonStyle(kind: .primary))
                .accessibilityLabel(Text("Try this battle again"))
                .accessibilityIdentifier("result.retry")
        }
    }
}
