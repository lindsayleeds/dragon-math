import GameRules
import SwiftUI

/// A boss node's intro, over the battle before the clocks start: the web's
/// node card on the map for a boss (MapPagePaper.jsx) — the dragon, its name,
/// "↯ boss battle ↯", the storyteller's warning and "⚔ fight the dragon".
/// (iOS starts a regular node's battle straight from the map, so only a boss
/// gets this card.)
struct BossIntroCard: View {
    let node: MapNode
    var onFight: () -> Void
    var onBackToMap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Palette.charcoal.opacity(0.35).ignoresSafeArea()
            ScrollView {
                card.frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .defaultScrollAnchor(.center, for: .alignment)
        }
    }

    private var card: some View {
        VStack(spacing: 10) {
            BossPortrait(art: node.bossArt, icon: node.icon, side: 120)
                .mapBossIdle(!reduceMotion)
                .accessibilityHidden(true)
            Text(node.localizedLabel)
                .font(Typeface.display(36, relativeTo: .largeTitle))
                .foregroundStyle(Palette.charcoal)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("boss.title")
            Text("↯ boss battle ↯")
                .font(Typeface.display(22, relativeTo: .title3))
                .foregroundStyle(Palette.rose)
                .accessibilityLabel(Text("Boss battle ahead"))
            Text("\"A fearsome dragon guards this pass. Be brave, traveler — sharpen your sums and steady your hand.\"")
                .font(Typeface.body(18, relativeTo: .body))
                .italic()
                .foregroundStyle(Palette.pencil)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Text("— ✎ the storyteller")
                .font(Typeface.display(18, relativeTo: .callout))
                .foregroundStyle(Palette.kraftDark)
                .frame(maxWidth: .infinity, alignment: .trailing)
            HStack(spacing: 18) {
                Button(action: onBackToMap) { Text("⌂ map") }
                    .buttonStyle(StampButtonStyle(kind: .secondary))
                    .accessibilityLabel(Text("Return to the map"))
                    .accessibilityIdentifier("boss.back")
                Button(action: onFight) { Text("⚔ fight the dragon") }
                    .buttonStyle(StampButtonStyle(kind: .boss))
                    .accessibilityIdentifier("boss.fight")
            }
            .padding(.top, 8)
        }
        .padding(.horizontal, 30)
        .padding(.vertical, 28)
        .frame(maxWidth: 440)
        .paperCard(rotation: -1)
        .overlay(alignment: .topLeading) { WashiTape(color: Palette.rose, width: 96, rotation: -10).offset(x: -20, y: -10) }
        .overlay(alignment: .topTrailing) { WashiTape(color: Palette.mustard, width: 70, rotation: 8).offset(x: 14, y: -8) }
        .padding(24)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("battle.bossIntro")
    }
}

/// The first win over a boss befriends its dragon: BattlePage.jsx's
/// CaptureOverlay, a golden-hour card with the new friend, its tagline and
/// the Bond Power it brings. Continue goes on to the result.
struct BefriendedCard: View {
    let companion: Companion
    var onContinue: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.fontTheme) private var fontTheme
    @State private var floating = false

    /// The boss's art for the companion it befriends, where the map has it.
    private var art: String? {
        companion.capturedAtNodeID.flatMap { GameMap.node($0)?.bossArt }
    }

    /// The power's name, set as the web's `<strong>`: display type in rose.
    private var powerName: Text {
        Text(verbatim: companion.bondPowerName)
            .font(Typeface.display(20, relativeTo: .title3).font(in: fontTheme))
            .italic(false)
            .foregroundStyle(Palette.rose)
    }

    var body: some View {
        ZStack {
            Palette.charcoal.opacity(0.35).ignoresSafeArea()
            ScrollView {
                card.frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .defaultScrollAnchor(.center, for: .alignment)
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) { floating = true }
        }
    }

    private var card: some View {
        VStack(spacing: 10) {
            Text(verbatim: "✨")
                .font(.system(size: 26))
                .foregroundStyle(Palette.mustard)
                .offset(y: floating ? -4 : 2)
                .accessibilityHidden(true)
            BossPortrait(art: art, icon: companion.icon, side: 110)
                .rotationEffect(.degrees(-3))
                .shadow(color: Color(hex: 0x7D5A3F).opacity(0.3), radius: 6, y: 3)
                .offset(y: floating ? -6 : 0)
                .accessibilityHidden(true)
            Text("You befriended \(companion.name)!")
                .font(Typeface.display(34, relativeTo: .largeTitle))
                .foregroundStyle(Palette.charcoal)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("befriended.title")
            Text(verbatim: companion.tagline)
                .font(Typeface.body(18, relativeTo: .body))
                .italic()
                .foregroundStyle(Palette.pencil)
                .multilineTextAlignment(.center)
            Text("New Bond Power unlocked: \(powerName)")
                .font(Typeface.body(16, relativeTo: .callout))
                .italic()
                .foregroundStyle(Palette.pencil)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.55))
                .overlay(Rectangle().strokeBorder(Palette.kraft, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                .rotationEffect(.degrees(-0.4))
            Button(action: onContinue) { Text("→ keep going") }
                .buttonStyle(StampButtonStyle(kind: .primary))
                .accessibilityIdentifier("befriended.continue")
                .padding(.top, 10)
        }
        .padding(.horizontal, 30)
        .padding(.vertical, 28)
        .frame(maxWidth: 440)
        // The web's `.captureModal`: golden-hour paper.
        .background(LinearGradient(
            colors: [Color(hex: 0xFBF0C8), Color(hex: 0xF4E3A8)], startPoint: .top, endPoint: .bottom))
        .overlay(Rectangle().strokeBorder(Palette.kraft.opacity(0.5), lineWidth: 1))
        .shadow(color: Palette.charcoal.opacity(0.18), radius: 0, x: 3, y: 4)
        .rotationEffect(.degrees(-1))
        .overlay(alignment: .topLeading) { WashiTape(color: Palette.mustard, width: 96, rotation: -10).offset(x: -20, y: -10) }
        .overlay(alignment: .topTrailing) { WashiTape(color: Palette.rose, width: 70, rotation: 8).offset(x: 14, y: -8) }
        .padding(24)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("battle.befriended")
    }
}

/// A boss dragon: its vector art, or its emoji where there's none.
struct BossPortrait: View {
    let art: String?
    let icon: String
    let side: CGFloat

    var body: some View {
        if let art {
            Image(art)
                .resizable()
                .scaledToFit()
                .frame(width: side, height: side)
        } else {
            Text(verbatim: icon)
                .font(.system(size: side * 0.6))
                .frame(width: side, height: side)
        }
    }
}
