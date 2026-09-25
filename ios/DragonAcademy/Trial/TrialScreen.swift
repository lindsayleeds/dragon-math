import GameRules
import Store
import SwiftUI

/// The Dragon's Trial route: loads the trial settings, builds the model from
/// the environment (Store, Sync, the random source) and hands it to
/// `TrialView`. Visuals follow src/pages/DragonTrialPage.jsx.
struct TrialScreen: View {
    /// Back to the map (after the results, or leaving early).
    var onBackToMap: () -> Void

    @Environment(\.store) private var store
    /// Who is taking it: the guest, or the kid picked on the family picker.
    @Environment(\.currentProfile) private var profile
    @Environment(\.sync) private var sync
    @Environment(\.makeBattleRandomSource) private var makeRandomSource
    @State private var model: TrialModel?

    var body: some View {
        Group {
            if let model {
                TrialView(model: model, avatar: profile?.avatar, onBackToMap: onBackToMap)
            } else {
                PaperBackground()
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .task {
            if let model {
                model.resume()
                return
            }
            let settings = await TrialSettings.synced(from: store)
            let sync = sync
            let model = TrialModel(
                settings: settings,
                rng: makeRandomSource(),
                onComplete: TrialModel.recordingPlacement(
                    in: store, for: profile?.id, requestSync: { sync?.requestSync() }))
            self.model = model
            model.start()
        }
        .onDisappear { model?.stop() }
    }
}

/// The trial board, then the results card.
struct TrialView: View {
    let model: TrialModel
    let avatar: String?
    var onBackToMap: () -> Void

    var body: some View {
        ZStack {
            PaperBackground()
            Color.clear
                .overlay {
                    Image("BattleWallpaperWorld\(trialWorldID)")
                        .resizable()
                        .scaledToFill()
                }
                .clipped()
                .ignoresSafeArea()
                .accessibilityHidden(true)

            VStack(spacing: 14) {
                header
                if let outcome = model.outcome {
                    ScrollView {
                        TrialResults(outcome: outcome, onContinue: onBackToMap)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                } else {
                    board
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: 720)
        }
        .animation(.easeOut(duration: 0.25), value: model.outcome != nil)
    }

    private var header: some View {
        HStack {
            Button(action: onBackToMap) {
                Text("⌂ map")
            }
            .buttonStyle(StampButtonStyle(kind: .secondary))
            .accessibilityLabel(Text("Return to the map"))
            .accessibilityIdentifier("trial.back")
            Spacer()
            HStack(spacing: 6) {
                Text(verbatim: "🐉").accessibilityHidden(true)
                Text("Dragon's Trial")
            }
            .font(Typeface.display(24, relativeTo: .title2))
        }
        .foregroundStyle(Palette.charcoal)
    }

    @ViewBuilder private var board: some View {
        let trial = model.trial
        let progress = model.progressText
        HStack {
            Text("problem \(progress.number) of \(progress.total)")
                .accessibilityIdentifier("trial.progress")
            Spacer()
            Text("testing \(trial.problem.op.trialName) \(trial.problem.op.symbol)")
        }
        .font(Typeface.body(16, relativeTo: .callout))
        .foregroundStyle(Palette.pencil)

        VStack(spacing: 4) {
            Text("tap the answer")
                .font(Typeface.body(15, relativeTo: .caption))
                .foregroundStyle(Palette.kraftDark)
            Text(verbatim: "\(trial.problem.text) = ?")
                .font(Typeface.display(40, relativeTo: .largeTitle))
                .foregroundStyle(Palette.charcoal)
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 12)
        .paperCard(rotation: -0.5)
        .overlay(alignment: .top) { WashiTape(color: Palette.mustard, rotation: -2).offset(y: -10) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(trial.problem.text) = ?"))
        .accessibilityIdentifier("trial.problem")

        TrialGrid(model: model)
            .frame(maxHeight: .infinity)

        Button(action: model.skip) {
            Text("too hard for me →")
        }
        .buttonStyle(StampButtonStyle(kind: .secondary))
        .disabled(model.gridMode != .ready)
        .accessibilityIdentifier("trial.skip")

        HStack {
            AvatarView(avatar: avatar).font(.system(size: 34))
            Spacer()
            Text(verbatim: "🐉")
                .font(.system(size: 34))
                .scaleEffect(model.session.growls % 2 == 1 ? 1.15 : 1)
                .animation(.spring(duration: 0.4), value: model.session.growls)
        }
        .accessibilityHidden(true)
    }
}

/// The number grid, World 5's layout, built from the battle's cells.
private struct TrialGrid: View {
    let model: TrialModel

    private let gap: CGFloat = 8

    var body: some View {
        let session = model.session
        let mode = model.gridMode
        let cols = max(session.layout.cols, 1)
        let rows = max(session.layout.rows, 1)
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
                            if index < session.grid.count, let value = session.grid[index] {
                                BattleCell(
                                    index: index, value: value, mode: mode,
                                    wrong: session.wrongCellIndex == index,
                                    eating: false,
                                    opponentIcon: "🐉",
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
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("trial.grid")
        .accessibilityValue(Text(verbatim: mode.rawValue))
    }
}

/// "The dragon nods approvingly": per-op scores and stars, and where the road
/// carries the kid.
private struct TrialResults: View {
    let outcome: TrialOutcome
    var onContinue: () -> Void

    var body: some View {
        let node = GameMap.node(outcome.targetNodeID)
        let world = node.flatMap { GameMap.world($0.worldID) }
        VStack(spacing: 14) {
            Text("The dragon nods approvingly.")
                .font(Typeface.display(30, relativeTo: .title))
                .foregroundStyle(Palette.charcoal)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("trial.results.title")
            Text("Here is what the trial revealed about your skills:")
                .font(Typeface.body(17, relativeTo: .body))
                .italic()
                .foregroundStyle(Palette.pencil)
                .multilineTextAlignment(.center)

            VStack(spacing: 8) {
                ForEach(trialOps, id: \.self) { op in
                    let r = outcome[op]
                    HStack(spacing: 10) {
                        Text(verbatim: op.symbol)
                            .font(Typeface.display(22, relativeTo: .title3))
                            .frame(width: 24)
                        Text(verbatim: op.trialName)
                            .font(Typeface.body(17, relativeTo: .body))
                        Spacer()
                        Text("\(r.score) / 1000")
                            .font(Typeface.body(15, relativeTo: .subheadline))
                            .foregroundStyle(Palette.kraftDark)
                        TrialStars(filled: r.stars)
                    }
                    .foregroundStyle(Palette.charcoal)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("trial.results.\(op.rawValue)")
                }
            }

            let place = node.map { "\($0.icon) \(String(localized: $0.localizedLabel))" } ?? ""
            let worldName = world.map { String(localized: $0.localizedName).lowercased() } ?? ""
            Group {
                if let op = outcome.placementOp {
                    Text("Your next challenge is **\(op.trialName)** — the road carries you to **\(place)** in *\(worldName)*.")
                } else {
                    Text("You've mastered the core operations. The road carries you to **\(place)** in *\(worldName)*.")
                }
            }
            .font(Typeface.body(18, relativeTo: .body))
            .foregroundStyle(Palette.pencil)
            .multilineTextAlignment(.center)
            .accessibilityIdentifier("trial.results.target")

            Button(action: onContinue) {
                Text("→ continue to the map")
            }
            .buttonStyle(StampButtonStyle(kind: .primary))
            .accessibilityIdentifier("trial.results.continue")
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 28)
        .paperCard(rotation: -0.8)
        .overlay(alignment: .topLeading) { WashiTape(color: Palette.sage, width: 96, rotation: -10).offset(x: -16, y: -10) }
        .padding(.vertical, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("trial.results")
    }
}

/// 1–5 stars, the rest dimmed.
private struct TrialStars: View {
    let filled: Int

    var body: some View {
        HStack(spacing: 1) {
            ForEach(1...5, id: \.self) { i in
                Text(verbatim: "★")
                    .foregroundStyle(i <= filled ? Palette.mustard : Palette.paperRule)
            }
        }
        .font(.system(size: 16))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(filled) out of 5 stars"))
    }
}

extension BattleOp {
    /// The op's name on the trial screens, lower case as the web shows it
    /// ("addition"). The catalog keys are the capitalized names the Proving
    /// Grounds and parent stats already use.
    var trialName: String {
        let name: String
        switch self {
        case .add: name = String(localized: "Addition")
        case .sub: name = String(localized: "Subtraction")
        case .mul: name = String(localized: "Multiplication")
        case .div: name = String(localized: "Division")
        }
        return name.lowercased()
    }
}
