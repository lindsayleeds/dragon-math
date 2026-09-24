import SwiftUI

/// The journal palette from docs/BRAND.md, the same values as the web's CSS
/// variables (`--paper`, `--charcoal`, …).
enum Palette {
    static let paper = Color(hex: 0xF4EAD5)
    static let paperDeep = Color(hex: 0xEDE0BF)
    static let paperRule = Color(hex: 0xC4B290)
    static let kraft = Color(hex: 0xA07859)
    static let kraftDark = Color(hex: 0x7D5A3F)
    static let charcoal = Color(hex: 0x3D3528)
    static let pencil = Color(hex: 0x5A4A3A)
    static let rose = Color(hex: 0xD97474)
    static let sage = Color(hex: 0x7D9D6C)
    static let sky = Color(hex: 0x8EB0CC)
    static let mustard = Color(hex: 0xD4A957)
    static let lavender = Color(hex: 0xC79BB8)

    /// The top and bottom of the web's cream card gradient
    /// (`#faf0d7 → #f1e2bb`).
    static let cardTop = Color(hex: 0xFAF0D7)
    static let cardBottom = Color(hex: 0xF1E2BB)
    static let card = LinearGradient(colors: [cardTop, cardBottom], startPoint: .top, endPoint: .bottom)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

/// The app's type. The default theme is Clean & Clear (Comic Neue on the web,
/// CLAUDE.md), which isn't bundled yet (#166), so this uses Chalkboard SE, the
/// closest font iOS ships. Every screen goes through here so bundling the real
/// fonts is a change in one place.
enum Typeface {
    /// Headings, numbers, button labels (`--font-display`).
    static func display(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("ChalkboardSE-Bold", size: size, relativeTo: style)
    }

    /// Body copy and captions (`--font-body`).
    static func body(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("ChalkboardSE-Regular", size: size, relativeTo: style)
    }
}

/// Cream notebook paper with the faint kraft dot grid (BRAND.md "Texture &
/// paper").
struct PaperBackground: View {
    var body: some View {
        Canvas { context, size in
            let spacing: CGFloat = 22
            let dot = Palette.kraft.opacity(0.22 * 0.55)
            var y: CGFloat = spacing / 2
            while y < size.height {
                var x: CGFloat = spacing / 2
                while x < size.width {
                    context.fill(Path(ellipseIn: CGRect(x: x - 1, y: y - 1, width: 2, height: 2)), with: .color(dot))
                    x += spacing
                }
                y += spacing
            }
        }
        .background(Palette.paper)
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// A cream paper card: a thin kraft edge and the stacked-paper shadow.
struct PaperCard: ViewModifier {
    var rotation: Double = 0

    func body(content: Content) -> some View {
        content
            .background(Palette.card)
            .overlay(Rectangle().strokeBorder(Palette.kraftDark.opacity(0.55), lineWidth: 1.5))
            .compositingGroup()
            .shadow(color: Palette.charcoal.opacity(0.10), radius: 0, x: 2, y: 3)
            .shadow(color: Palette.charcoal.opacity(0.07), radius: 0, x: 5, y: 7)
            .rotationEffect(.degrees(rotation))
    }
}

/// A strip of washi tape, the brand's "pinned to the page" motif.
struct WashiTape: View {
    var color: Color
    var width: CGFloat = 70
    var rotation: Double = -3

    var body: some View {
        Rectangle()
            .fill(color.opacity(0.7))
            .frame(width: width, height: 18)
            .rotationEffect(.degrees(rotation))
            .accessibilityHidden(true)
    }
}

extension View {
    func paperCard(rotation: Double = 0) -> some View {
        modifier(PaperCard(rotation: rotation))
    }
}

/// Primary (sage tab) and secondary (kraft tab) buttons from BRAND.md: a hard
/// offset shadow that shrinks as the button is pressed.
struct StampButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary }
    var kind: Kind = .primary

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        let label = configuration.label
            .padding(.horizontal, 22)
            .padding(.vertical, 10)
            .foregroundStyle(Palette.charcoal)
        switch kind {
        case .primary:
            label
                .font(Typeface.display(22, relativeTo: .title3))
                .background(Palette.sage)
                .overlay(Rectangle().strokeBorder(Palette.charcoal, lineWidth: 2))
                .background(Palette.charcoal.offset(x: pressed ? 1 : 3, y: pressed ? 1 : 3))
                .offset(x: pressed ? 2 : 0, y: pressed ? 2 : 0)
                .rotationEffect(.degrees(-1.5))
        case .secondary:
            label
                .font(Typeface.body(18, relativeTo: .body))
                .background(Palette.cardTop)
                .overlay(Rectangle().strokeBorder(Palette.kraft, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                .shadow(color: Palette.charcoal.opacity(0.12), radius: 0, x: 2, y: pressed ? 1 : 3)
                .rotationEffect(.degrees(2))
        }
    }
}
