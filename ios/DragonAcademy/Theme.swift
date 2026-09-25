import SwiftUI

/// The journal palette from docs/BRAND.md, the same values as the web's CSS
/// variables (`--paper`, `--charcoal`, …).
enum Palette {
    /// The palette's hex values, for the contrast checks in
    /// ThemeContrast.swift (the `Color`s below are drawn from these).
    enum Hex {
        static let paper: UInt32 = 0xF4EAD5
        static let paperDeep: UInt32 = 0xEDE0BF
        static let paperRule: UInt32 = 0xC4B290
        static let kraft: UInt32 = 0xA07859
        static let kraftDark: UInt32 = 0x7D5A3F
        static let charcoal: UInt32 = 0x3D3528
        static let pencil: UInt32 = 0x5A4A3A
        static let rose: UInt32 = 0xD97474
        static let sage: UInt32 = 0x7D9D6C
        static let sky: UInt32 = 0x8EB0CC
        static let mustard: UInt32 = 0xD4A957
        static let lavender: UInt32 = 0xC79BB8
        static let roseInk: UInt32 = 0xA3403D
        static let sageInk: UInt32 = 0x4A6B3C
        static let cardTop: UInt32 = 0xFAF0D7
        static let cardBottom: UInt32 = 0xF1E2BB
        static let white: UInt32 = 0xFFFFFF
    }

    static let paper = Color(hex: Hex.paper)
    static let paperDeep = Color(hex: Hex.paperDeep)
    static let paperRule = Color(hex: Hex.paperRule)
    static let kraft = Color(hex: Hex.kraft)
    static let kraftDark = Color(hex: Hex.kraftDark)
    static let charcoal = Color(hex: Hex.charcoal)
    static let pencil = Color(hex: Hex.pencil)
    static let rose = Color(hex: Hex.rose)
    static let sage = Color(hex: Hex.sage)
    static let sky = Color(hex: Hex.sky)
    static let mustard = Color(hex: Hex.mustard)
    static let lavender = Color(hex: Hex.lavender)

    /// Rose and sage deep enough to write with (BRAND.md "Accessible ink"):
    /// the crayon `rose`/`sage` are fills and borders, only 2.5:1 on paper.
    /// Text, icons and the "Try again"/"Correct" marks use these.
    static let roseInk = Color(hex: Hex.roseInk)
    static let sageInk = Color(hex: Hex.sageInk)

    /// The top and bottom of the web's cream card gradient
    /// (`#faf0d7 → #f1e2bb`).
    static let cardTop = Color(hex: Hex.cardTop)
    static let cardBottom = Color(hex: Hex.cardBottom)
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

/// The app's type, in the playing kid's font theme (`\.fontTheme`, chosen in
/// kid Settings; Clean & Clear by default, CLAUDE.md). Every screen goes
/// through here: `Text("…").font(Typeface.display(22))` draws in the theme's
/// display family, whichever theme the view is in.
enum Typeface {
    /// Headings, numbers, button labels (`--font-display`).
    static func display(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> ThemedFont {
        ThemedFont(role: .display, size: size, sizing: .relative(style))
    }

    /// Body copy and captions (`--font-body`).
    static func body(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> ThemedFont {
        ThemedFont(role: .body, size: size, sizing: .relative(style))
    }

    /// Display type that doesn't follow Dynamic Type: for text drawn on the
    /// map, which is sized to the art around it.
    static func display(fixedSize size: CGFloat) -> ThemedFont {
        ThemedFont(role: .display, size: size, sizing: .fixed)
    }

    /// Body type that doesn't follow Dynamic Type (see `display(fixedSize:)`).
    static func body(fixedSize size: CGFloat) -> ThemedFont {
        ThemedFont(role: .body, size: size, sizing: .fixed)
    }
}

/// A `Typeface` font before it knows its theme. `.font(_:)` with one reads
/// `\.fontTheme` from the environment; `font(in:)` resolves one by hand.
struct ThemedFont: Hashable {
    enum Role: Hashable {
        case display, body
    }

    enum Sizing: Hashable {
        /// Scales with Dynamic Type like this text style.
        case relative(Font.TextStyle)
        case fixed
    }

    let role: Role
    let size: CGFloat
    let sizing: Sizing

    /// The PostScript name drawn in `theme`: the theme's display family in
    /// bold or its body family in regular, or their built-in stand-ins while
    /// the family's files aren't bundled.
    func postScriptName(in theme: FontTheme, isAvailable: (String) -> Bool = FontFamily.isRegistered) -> String {
        switch role {
        case .display: theme.display.resolvedName(.bold, isAvailable: isAvailable)
        case .body: theme.body.resolvedName(.regular, isAvailable: isAvailable)
        }
    }

    func font(in theme: FontTheme) -> Font {
        let name = postScriptName(in: theme)
        return switch sizing {
        case .relative(let style): .custom(name, size: size, relativeTo: style)
        case .fixed: .custom(name, fixedSize: size)
        }
    }
}

private struct ThemedFontModifier: ViewModifier {
    let font: ThemedFont
    @Environment(\.fontTheme) private var theme

    func body(content: Content) -> some View {
        content.font(font.font(in: theme))
    }
}

extension View {
    /// Sets the font to a `Typeface` font in the environment's font theme.
    func font(_ font: ThemedFont) -> some View {
        modifier(ThemedFontModifier(font: font))
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
    /// `boss`: the primary stamp in rose with cream type, for "⚔ fight the
    /// dragon" (the web's `.modalButtonBoss`).
    enum Kind { case primary, secondary, boss }
    var kind: Kind = .primary

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        let label = configuration.label
            .padding(.horizontal, 22)
            .padding(.vertical, 10)
            .foregroundStyle(kind == .boss ? Color(hex: 0xF7EEDB) : Palette.charcoal)
        switch kind {
        case .primary, .boss:
            label
                .font(Typeface.display(22, relativeTo: .title3))
                .background(kind == .boss ? Palette.rose : Palette.sage)
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
