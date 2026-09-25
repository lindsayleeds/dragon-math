import Audio
import GameRules
import Store
import Sync
import SwiftUI

/// The lair's Dragon Munchers, for whoever is playing, launched as the web's
/// game-first campaign (LearningLairOperationPage: progression on, a random
/// fallback base). The kid's best score is read from the Store and the
/// settings from the synced rule settings, else the defaults.
struct MunchersEntry: View {
    let operation: BattleOp
    var backToLair: () -> Void

    @Environment(\.store) private var store
    @Environment(\.sync) private var sync
    @Environment(\.currentProfile) private var profile
    @Environment(\.audio) private var audio
    @State private var model: MunchersModel?

    var body: some View {
        Group {
            if let model {
                MunchersView(model: model, backToLair: backToLair)
            } else {
                ZStack {
                    PaperBackground()
                    ProgressView()
                }
            }
        }
        .task {
            guard model == nil else { return }
            let settings = await Self.settings(from: store)
            let best = await MunchersModel.highScore(store: store, profileID: profile?.id)
            let audio = audio
            model = MunchersModel(
                operation: operation, baseNumber: Lair.numbers.randomElement() ?? 1, progression: true,
                highScore: best, settings: settings, store: store, profileID: profile?.id, sync: sync,
                playSound: { audio?.play($0) })
        }
    }

    /// The synced settings, checked like the web's converter, or the defaults.
    static func settings(from store: (any Store)?) async -> MunchersSettings {
        guard let s = try? await store?.cachedContent(.ruleSettings)?.munchers else { return .defaults }
        return .served(
            startingLives: s.startingLives, easyMaxBase: s.easyMaxBase, easyPoints: s.easyPoints,
            hardPoints: s.hardPoints, enemyMoveIntervalMs: s.enemyMoveIntervalMs, enemyTelegraphMs: s.enemyTelegraphMs,
            spawnIntervalMs: s.spawnIntervalMs, caughtBeatMs: s.caughtBeatMs, chaseChance: s.chaseChance,
            progressionEasy: s.progressionEasy, progressionHard: s.progressionHard,
            enemySpeedupPerLevelMs: s.enemySpeedupPerLevelMs, minEnemyIntervalMs: s.minEnemyIntervalMs,
            levelsPerExtraEnemy: s.levelsPerExtraEnemy, maxEnemies: s.maxEnemies)
    }
}

enum MunchersStyle {
    static let board = Color(hex: 0xE9DDBF)
    static let cell = Color(hex: 0xFAF0D7)
    static let cellEaten = Color(hex: 0xEFE4C8)
    static let muncher = Color(hex: 0x9CC98A)
    static let monsterBody = Color(hex: 0xC79BB8)
    static let monsterBelly = Color(hex: 0xDCB8D2)
    static let monsterFeet = Color(hex: 0x7D9D6C)
    static let eye = Color(hex: 0xFDFAF2)
    static let mouth = Color(hex: 0x8A4A5C)
    /// A step glides over this long, so moves read as motion, not jumps.
    static let glide = Animation.easeInOut(duration: 0.22)
}

/// Dragon Munchers — the iOS twin of src/components/DragonMunchers.jsx: walk
/// the muncher around a 5 × 6 board and eat the numbers that fit the rule,
/// while monsters wander in, look where they're going, and step.
///
/// Drawn with plain SwiftUI. The reducer only changes the state on a timer or
/// an input (every ~0.75–4 s, or a tap), never per frame; between changes the
/// only work is Core Animation gliding the sprites, which is why no Canvas or
/// SpriteKit is needed for a steady 60 fps.
struct MunchersView: View {
    let model: MunchersModel
    var backToLair: () -> Void

    @State private var confirmingQuit = false
    @FocusState private var keyboardFocus: Bool

    var body: some View {
        let state = model.state
        ZStack {
            PaperBackground()
            if !state.started {
                ScrollView { startCard.padding(16).frame(maxWidth: 520).frame(maxWidth: .infinity) }
            } else if state.gameOver {
                ScrollView { gameOverCard.padding(16).frame(maxWidth: 520).frame(maxWidth: .infinity) }
            } else {
                play
                if let wrong = state.wrongAnswer {
                    MunchersNotice(
                        message: Text(verbatim: MunchersModel.message(for: wrong)),
                        button: Text("Tap to continue"), id: "munchers.wrong",
                        action: model.dismissWrongAnswer)
                } else if state.levelTransition, state.levels.indices.contains(state.level + 1) {
                    MunchersNotice(
                        message: Text("🎉 Level \(state.level + 1) cleared! Next: \(model.title(base: state.levels[state.level + 1]))"),
                        button: Text("→ keep going"), id: "munchers.level",
                        action: model.advanceLevel)
                }
            }
        }
        .animation(.snappy, value: state.wrongAnswer)
        .animation(.snappy, value: state.levelTransition)
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .alert("Are you sure you want to quit?", isPresented: $confirmingQuit) {
            Button("Yes, quit", role: .destructive, action: backToLair)
                .accessibilityIdentifier("munchers.quit.confirm")
            Button("Keep playing", role: .cancel) {}
        }
        .onDisappear { model.stop() }
    }

    // MARK: - Start

    private var startCard: some View {
        VStack(spacing: 16) {
            Text(verbatim: "🐉").font(.system(size: 64)).accessibilityHidden(true)
            Text("Dragon Munchers")
                .font(Typeface.display(36, relativeTo: .largeTitle))
                .foregroundStyle(Palette.charcoal)
                .accessibilityAddTraits(.isHeader)
            Text("Walk your dragon around the board and munch the right answers. Watch the monsters — they look where they're going before they step!")
                .font(Typeface.body(18))
                .foregroundStyle(Palette.pencil)
                .multilineTextAlignment(.center)
            Button("Let's go! →") {
                model.start()
                keyboardFocus = true
            }
            .buttonStyle(StampButtonStyle())
            .accessibilityIdentifier("munchers.start")
            Button(action: backToLair) { Text(verbatim: "← ") + Text("Back to the Lair") }
                .buttonStyle(StampButtonStyle(kind: .secondary))
                .accessibilityIdentifier("munchers.back")
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .paperCard(rotation: -0.5)
    }

    // MARK: - Game over

    private var gameOverCard: some View {
        let state = model.state
        return VStack(spacing: 14) {
            Text(verbatim: model.won ? "🎉" : "🐉").font(.system(size: 64)).accessibilityHidden(true)
            Group {
                if model.won {
                    state.progression ? Text("You cleared every level!") : Text("You won the round!")
                } else {
                    Text("You've been caught!")
                }
            }
            .font(Typeface.display(32, relativeTo: .largeTitle))
            .foregroundStyle(Palette.charcoal)
            .multilineTextAlignment(.center)
            .accessibilityAddTraits(.isHeader)
            Text("🏆 \(state.score) points")
                .font(Typeface.display(26, relativeTo: .title2))
                .foregroundStyle(Palette.charcoal)
                .accessibilityIdentifier("munchers.finalScore")
            Group {
                if state.isNewHighScore {
                    Text("✨ New high score! ✨").foregroundStyle(Palette.rose)
                } else {
                    Text("Best: \(state.highScore) points").foregroundStyle(Palette.pencil)
                }
            }
            .font(Typeface.body(18, relativeTo: .headline))
            .accessibilityIdentifier("munchers.best")
            Button("Back to the Lair", action: backToLair)
                .buttonStyle(StampButtonStyle())
                .accessibilityIdentifier("munchers.done")
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .paperCard(rotation: -0.5)
    }

    // MARK: - Play

    private var play: some View {
        let state = model.state
        return VStack(spacing: 10) {
            header
            Group {
                if state.progression {
                    Text("Level \(state.level + 1)/\(state.levels.count) · \(model.title(base: state.currentBase))")
                } else {
                    Text(verbatim: model.title(base: state.currentBase))
                }
            }
            .font(Typeface.display(24, relativeTo: .title2))
            .foregroundStyle(Palette.charcoal)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("munchers.title")
            MunchersCollection(
                dragons: state.babyDragons, eaten: state.correctEaten, total: state.totalCorrect)
            MunchersBoard(model: model)
                .frame(maxWidth: 560)
                .layoutPriority(1)
            MunchersArrows(move: model.move)
            Text("Tap a square next to your dragon to walk there, or swipe. Tap your own square to munch its number. Avoid the monsters!")
                .font(Typeface.body(14, relativeTo: .footnote))
                .foregroundStyle(Palette.pencil)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // A hardware keyboard (iPad): arrows or WASD walk, space munches.
        .focusable()
        .focused($keyboardFocus)
        .focusEffectDisabled()
        .onKeyPress(keys: [.upArrow, .downArrow, .leftArrow, .rightArrow, .space, "w", "a", "s", "d"]) { press in
            switch press.key {
            case .upArrow, "w": model.steer(.up)
            case .downArrow, "s": model.steer(.down)
            case .leftArrow, "a": model.steer(.left)
            case .rightArrow, "d": model.steer(.right)
            default: if !model.state.isFrozen { model.eat() }
            }
            return .handled
        }
        .onAppear { keyboardFocus = true }
    }

    private var header: some View {
        let state = model.state
        return HStack(spacing: 12) {
            HStack(spacing: 2) {
                ForEach(0..<max(0, state.lives), id: \.self) { _ in Text(verbatim: "❤️") }
            }
            .font(.system(size: 20))
            .accessibilityElement()
            .accessibilityLabel(Text("Lives: \(state.lives)"))
            .accessibilityIdentifier("munchers.lives")
            Spacer(minLength: 4)
            Text("Score: \(state.score)")
                .font(Typeface.display(22, relativeTo: .title3))
                .foregroundStyle(Palette.charcoal)
                .contentTransition(.numericText())
                .animation(.snappy, value: state.score)
                .accessibilityIdentifier("munchers.score")
            Spacer(minLength: 4)
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
            .accessibilityIdentifier("munchers.quit")
        }
    }
}

// MARK: - Baby dragons

private struct MunchersCollection: View {
    let dragons: [MunchersBabyDragon]
    let eaten: Int
    let total: Int

    var body: some View {
        HStack(spacing: 8) {
            Text(verbatim: "\(eaten)/\(total)")
                .font(Typeface.body(15, relativeTo: .subheadline))
                .foregroundStyle(Palette.charcoal)
            HStack(spacing: 3) {
                ForEach(dragons) { dragon in
                    Text(verbatim: dragon.emoji).font(.system(size: 18)).transition(.scale)
                }
                ForEach(0..<max(0, total - dragons.count), id: \.self) { _ in
                    Circle().strokeBorder(Palette.kraft, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2]))
                        .frame(width: 18, height: 18)
                }
            }
            .animation(.spring(duration: 0.3), value: dragons)
        }
        .accessibilityElement()
        .accessibilityLabel(Text("\(eaten) of \(total) right answers munched"))
        .accessibilityIdentifier("munchers.collection")
    }
}

// MARK: - The board

/// The 5 × 6 grid of numbers with the muncher and the monsters on top. The
/// cells are a plain grid that only re-renders when a number is eaten or the
/// level changes; the sprites sit in one overlay, keyed by id, so a step is
/// an animated offset rather than a view moving between cells.
private struct MunchersBoard: View {
    let model: MunchersModel

    private static let gap: CGFloat = 6
    private static let padding: CGFloat = 8

    var body: some View {
        let state = model.state
        let cols = Munchers.gridCols, rows = Munchers.gridRows
        GeometryReader { geo in
            // The board's own padding comes off before the cells are sized.
            let side = max(1, min(
                (geo.size.width - 2 * Self.padding - Self.gap * CGFloat(cols - 1)) / CGFloat(cols),
                (geo.size.height - 2 * Self.padding - Self.gap * CGFloat(rows - 1)) / CGFloat(rows)))
            let width = side * CGFloat(cols) + Self.gap * CGFloat(cols - 1)
            let height = side * CGFloat(rows) + Self.gap * CGFloat(rows - 1)
            ZStack(alignment: .topLeading) {
                MunchersCells(
                    board: state.board, eaten: state.eaten, hidden: Set(state.enemies.map(\.position)),
                    side: side, gap: Self.gap, tap: model.tap)
                .equatable()
                ForEach(state.enemies) { enemy in
                    MonsterMuncher(facing: enemy.facing, chomping: state.caughtAt == enemy.position)
                        .frame(width: side * 0.86, height: side * 0.86)
                        .offset(offset(enemy.position, side: side, inset: side * 0.07))
                        .transition(.scale.combined(with: .opacity))
                        .allowsHitTesting(false)
                }
                MuncherSprite(caught: state.caughtAt != nil)
                    .frame(width: side * 0.8, height: side * 0.8)
                    .offset(offset(state.muncher, side: side, inset: side * 0.1))
                    .allowsHitTesting(false)
                if let caught = state.caughtAt {
                    Text(verbatim: "💥")
                        .font(.system(size: side * 0.5))
                        .frame(width: side, height: side)
                        .offset(offset(caught, side: side, inset: 0))
                        .transition(.scale(scale: 0.3).combined(with: .opacity))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .animation(MunchersStyle.glide, value: state.muncher)
            .animation(MunchersStyle.glide, value: state.enemies)
            .animation(.spring(duration: 0.3), value: state.caughtAt)
            .frame(width: width, height: height)
            .padding(Self.padding)
            .background(MunchersStyle.board, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.kraftDark, lineWidth: 2))
            .contentShape(Rectangle())
            .simultaneousGesture(swipe)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(CGFloat(cols) / CGFloat(rows), contentMode: .fit)
    }

    private func offset(_ cell: Int, side: CGFloat, inset: CGFloat) -> CGSize {
        CGSize(
            width: CGFloat(Munchers.col(cell)) * (side + Self.gap) + inset,
            height: CGFloat(Munchers.row(cell)) * (side + Self.gap) + inset)
    }

    /// A swipe steers (not while frozen, as on the web); below 30 pt of travel
    /// it's a tap, which the cell handles.
    private var swipe: some Gesture {
        DragGesture(minimumDistance: 30).onEnded { value in
            let dx = value.translation.width, dy = value.translation.height
            if abs(dx) > abs(dy) {
                model.steer(dx > 0 ? .right : .left)
            } else {
                model.steer(dy > 0 ? .down : .up)
            }
        }
    }
}

/// The numbers. Equatable on its data, so a monster's step or the muncher's
/// move (which only hides or shows a number) doesn't rebuild more than it must.
private struct MunchersCells: View, Equatable {
    let board: [Int?]
    let eaten: [Int]
    /// Cells a monster stands on: its number is hidden under it.
    let hidden: Set<Int>
    let side: CGFloat
    let gap: CGFloat
    var tap: (Int) -> Void

    nonisolated static func == (a: Self, b: Self) -> Bool {
        a.board == b.board && a.eaten == b.eaten && a.hidden == b.hidden && a.side == b.side && a.gap == b.gap
    }

    var body: some View {
        VStack(spacing: gap) {
            ForEach(0..<Munchers.gridRows, id: \.self) { row in
                HStack(spacing: gap) {
                    ForEach(0..<Munchers.gridCols, id: \.self) { col in
                        cell(row * Munchers.gridCols + col)
                    }
                }
            }
        }
    }

    private func cell(_ i: Int) -> some View {
        let isEaten = eaten.contains(i)
        let value = board.indices.contains(i) ? board[i] : nil
        return RoundedRectangle(cornerRadius: 8)
            .fill(isEaten ? MunchersStyle.cellEaten : MunchersStyle.cell)
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.kraft.opacity(0.6), lineWidth: 1))
            .overlay {
                if let value, !isEaten, !hidden.contains(i) {
                    Text(verbatim: "\(value)")
                        .font(Typeface.display(fixedSize: side * 0.42))
                        .foregroundStyle(Palette.charcoal)
                        .minimumScaleFactor(0.5)
                }
            }
            .frame(width: side, height: side)
            .contentShape(Rectangle())
            .onTapGesture { tap(i) }
            .accessibilityElement()
            .accessibilityLabel(cellLabel(i, value: value, isEaten: isEaten))
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("munchers.cell.\(i)")
    }

    private func cellLabel(_ i: Int, value: Int?, isEaten: Bool) -> Text {
        let row = Munchers.row(i) + 1, col = Munchers.col(i) + 1
        if isEaten { return Text("Row \(row), column \(col): munched") }
        if hidden.contains(i) { return Text("Row \(row), column \(col): a monster") }
        guard let value else { return Text("Row \(row), column \(col)") }
        return Text("Row \(row), column \(col): \(value)")
    }
}

// MARK: - Sprites

/// The player's dragon. The dragon picker and its art aren't on iOS yet, so
/// it's the game's dragon glyph on a leafy disc.
private struct MuncherSprite: View {
    let caught: Bool

    var body: some View {
        Circle()
            .fill(MunchersStyle.muncher)
            .overlay(Circle().strokeBorder(Palette.charcoal, lineWidth: 2))
            .overlay {
                GeometryReader { geo in
                    Text(verbatim: "🐲")
                        .font(.system(size: geo.size.width * 0.62))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .rotationEffect(.degrees(caught ? -18 : 0))
            .scaleEffect(caught ? 0.75 : 1)
            .opacity(caught ? 0.7 : 1)
            .accessibilityHidden(true)
    }
}

/// The friendly "number gobbler" (src/components/MonsterMuncher.jsx): a round
/// critter whose pupils shift, and whose body leans, the way it's about to
/// step — the telegraph a kid watches for.
private struct MonsterMuncher: View {
    let facing: MunchersFacing
    let chomping: Bool

    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height)
            let pupil = pupilOffset(s)
            ZStack {
                // Feet
                HStack(spacing: s * 0.18) {
                    Ellipse().fill(MunchersStyle.monsterFeet).frame(width: s * 0.2, height: s * 0.13)
                    Ellipse().fill(MunchersStyle.monsterFeet).frame(width: s * 0.2, height: s * 0.13)
                }
                .offset(y: s * 0.42)
                // Body and belly
                Circle().fill(MunchersStyle.monsterBody)
                    .overlay(Circle().strokeBorder(Palette.charcoal, lineWidth: max(1.5, s * 0.03)))
                    .frame(width: s * 0.8, height: s * 0.8)
                    .offset(y: s * 0.04)
                Ellipse().fill(MunchersStyle.monsterBelly.opacity(0.6))
                    .frame(width: s * 0.38, height: s * 0.3)
                    .offset(x: -s * 0.06, y: -s * 0.04)
                // Eyes
                HStack(spacing: s * 0.06) {
                    eye(s, pupil: pupil)
                    eye(s, pupil: pupil)
                }
                .offset(y: -s * 0.12)
                // Grin
                Capsule().fill(MunchersStyle.mouth)
                    .frame(width: s * 0.28, height: chomping ? s * 0.16 : s * 0.07)
                    .offset(y: s * 0.2)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .rotationEffect(.degrees(lean))
        .offset(leanShift)
        .scaleEffect(chomping ? 1.15 : 1)
        .animation(.easeOut(duration: 0.18), value: facing)
        .animation(.spring(duration: 0.25), value: chomping)
        .accessibilityHidden(true)
    }

    private func eye(_ s: CGFloat, pupil: CGSize) -> some View {
        Circle().fill(MunchersStyle.eye)
            .overlay(Circle().strokeBorder(Palette.charcoal, lineWidth: max(1, s * 0.02)))
            .frame(width: s * 0.22, height: s * 0.22)
            .overlay {
                Circle().fill(Palette.charcoal).frame(width: s * 0.09, height: s * 0.09).offset(pupil)
            }
    }

    private func pupilOffset(_ s: CGFloat) -> CGSize {
        let d = s * 0.04
        switch facing {
        case .center: return .zero
        case .left: return CGSize(width: -d, height: 0)
        case .right: return CGSize(width: d, height: 0)
        case .up: return CGSize(width: 0, height: -d)
        case .down: return CGSize(width: 0, height: d)
        }
    }

    private var lean: Double {
        switch facing {
        case .left: -10
        case .right: 10
        default: 0
        }
    }

    private var leanShift: CGSize {
        switch facing {
        case .up: CGSize(width: 0, height: -3)
        case .down: CGSize(width: 0, height: 3)
        default: .zero
        }
    }
}

// MARK: - Controls and notices

private struct MunchersArrows: View {
    var move: (MunchersDirection) -> Void

    var body: some View {
        VStack(spacing: 6) {
            arrow(.up, "↑", Text("Move up"))
            HStack(spacing: 6) {
                arrow(.left, "←", Text("Move left"))
                arrow(.down, "↓", Text("Move down"))
                arrow(.right, "→", Text("Move right"))
            }
        }
    }

    private func arrow(_ direction: MunchersDirection, _ glyph: String, _ label: Text) -> some View {
        Button {
            move(direction)
        } label: {
            Text(verbatim: glyph)
                .font(Typeface.display(fixedSize: 26))
                .foregroundStyle(Palette.charcoal)
                .frame(width: 58, height: 48)
                .background(Palette.cardTop, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.kraftDark, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityIdentifier("munchers.arrow.\(direction.rawValue)")
    }
}

/// The wrong-answer message and the level splash: a card over the board.
private struct MunchersNotice: View {
    let message: Text
    let button: Text
    let id: String
    var action: () -> Void

    var body: some View {
        ZStack {
            Palette.charcoal.opacity(0.45).ignoresSafeArea()
            VStack(spacing: 16) {
                message
                    .font(Typeface.display(24, relativeTo: .title2))
                    .foregroundStyle(Palette.charcoal)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("\(id).message")
                Button(action: action) { button }
                    .buttonStyle(StampButtonStyle())
                    .accessibilityIdentifier("\(id).continue")
            }
            .padding(24)
            .frame(maxWidth: 380)
            .paperCard(rotation: -0.5)
            .padding(24)
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
        }
        .transition(.opacity)
    }
}
