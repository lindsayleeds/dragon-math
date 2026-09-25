import GameRules
import SwiftUI

/// The companion's Bond Power button: its icon in a dashed ring of the power's
/// colour, a cooldown sector and seconds count while it recharges, and a glow
/// while its effect is on the board. BattlePage.jsx's `.bondButton` in
/// BattlePage.module.css.
struct BondPowerButton: View {
    let companion: Companion
    let status: BattleModel.BondStatus
    /// The button's diameter: 78 in the side-by-side panel (the web's size),
    /// smaller in the one-column headers — never under the 44pt tap minimum.
    var side: CGFloat = 78
    var action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    private var color: Color { Color(highlight: companion.bondPower.highlightColor) }
    private var coolingDown: Bool { status.cooldownFraction > 0 }
    private var active: Bool { status.phase == .active }

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().fill(Palette.cardTop)
                Text(verbatim: companion.icon)
                    .font(.system(size: side * 0.5))
                    .saturation(status.isEnabled || active ? 1 : 0.6)
                if coolingDown {
                    CooldownSector(fraction: status.cooldownFraction)
                        .fill(Palette.kraft.opacity(0.45))
                    // The charge filling back up, in the power's colour.
                    Circle()
                        .trim(from: 0, to: 1 - status.cooldownFraction)
                        .stroke(color, style: StrokeStyle(lineWidth: max(3, side * 0.06), lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .padding(side * 0.04)
                    if !active {
                        Text(verbatim: "\(status.secondsLeft)")
                            .font(Typeface.display(side * 0.3))
                            .foregroundStyle(Palette.charcoal)
                            .frame(width: side * 0.62, height: side * 0.62)
                            .background(Circle().fill(Palette.cardTop.opacity(0.78)))
                            .monospacedDigit()
                    }
                }
            }
            .frame(width: side, height: side)
            .clipShape(Circle())
            .overlay {
                Circle().strokeBorder(
                    color,
                    style: active
                        ? StrokeStyle(lineWidth: 3)
                        : StrokeStyle(lineWidth: 2.5, dash: [side * 0.08, side * 0.06]))
            }
            .shadow(color: Palette.charcoal.opacity(0.18), radius: 0, x: 2, y: 3)
            .shadow(color: active ? color.opacity(pulsing ? 0.95 : 0.55) : .clear, radius: active ? side * 0.18 : 0)
            .scaleEffect(active && pulsing ? 1.05 : 1)
        }
        .buttonStyle(BondPressStyle())
        .disabled(!status.isEnabled)
        .frame(minWidth: 44, minHeight: 44)
        .onChange(of: active, initial: true) { _, isActive in
            if isActive && !reduceMotion {
                withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulsing = true }
            } else {
                withAnimation(.easeOut(duration: 0.2)) { pulsing = false }
            }
        }
        .animation(.linear(duration: 0.1), value: status.cooldownFraction)
        .accessibilityLabel(Text("Ask \(companion.name) to help: \(companion.bondPowerName)"))
        .accessibilityValue(accessibilityValue)
        .accessibilityAddTraits(coolingDown ? .updatesFrequently : [])
        .accessibilityIdentifier("battle.bondPower")
    }

    private var accessibilityValue: Text {
        switch status.phase {
        case .ready: Text("ready")
        case .active: Text("working now")
        case .coolingDown: Text("ready in \(status.secondsLeft) seconds")
        case .unavailable: Text(verbatim: "")
        }
    }

    /// What VoiceOver announces when the power goes off: what it just did.
    static func announcement(for kind: BondPowerKind) -> String {
        switch kind {
        case .hint2x2: String(localized: "The answer is in one of the glowing numbers.")
        case .revealAnswer: String(localized: "The answer is glowing.")
        case .mushroomGrove: String(localized: "Mushrooms cover some wrong numbers.")
        case .lightningStrike: String(localized: "Lightning zapped some wrong numbers.")
        case .aiLockout: String(localized: "Your foe is paused.")
        case .petalShield: String(localized: "Petal shield ready — one wrong tap forgiven.")
        }
    }
}

/// The part of the cooldown still to run, as a pie slice clockwise from the
/// top — the web's conic-gradient.
private struct CooldownSector: Shape {
    var fraction: Double

    var animatableData: Double {
        get { fraction }
        set { fraction = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2
        var path = Path()
        guard fraction > 0 else { return path }
        path.move(to: center)
        path.addArc(
            center: center, radius: radius,
            startAngle: .degrees(-90), endAngle: .degrees(-90 + 360 * min(1, fraction)), clockwise: false)
        path.closeSubpath()
        return path
    }
}

private struct BondPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .rotationEffect(.degrees(configuration.isPressed ? -3 : 0))
            .offset(x: configuration.isPressed ? 2 : 0, y: configuration.isPressed ? 2 : 0)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// The opponent's score card while Sunfire Hold pauses it: greyed, with the
/// web's slow-moving honey stripes (`.scoreCardLocked`).
struct OpponentPausedOverlay: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            let phase = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.8) / 1.8
            Canvas { context, size in
                context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Palette.mustard.opacity(0.22)))
                // -45° stripes, 2pt of every 10, drifting one period per 1.8s.
                let period: CGFloat = 10
                let shift = CGFloat(phase) * period
                var x = -size.height - period + shift
                while x < size.width + period {
                    var stripe = Path()
                    stripe.move(to: CGPoint(x: x, y: size.height))
                    stripe.addLine(to: CGPoint(x: x + size.height, y: 0))
                    context.stroke(stripe, with: .color(Palette.mustard.opacity(0.35)), lineWidth: 2)
                    x += period
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
