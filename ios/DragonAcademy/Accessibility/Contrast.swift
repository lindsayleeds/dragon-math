import Foundation

/// WCAG 2.2 contrast, on 24-bit sRGB hex colours (`0xF4EAD5`). Pure Swift, so
/// the theme's pairs can be checked in a unit test (ThemeContrast.swift).
enum WCAG {
    /// How much contrast a pair needs (success criteria 1.4.3 and 1.4.11).
    enum Level: Hashable {
        /// Body copy: 4.5:1.
        case text
        /// Large text (18pt, or 14pt bold, and up), icons, and the parts of
        /// a control you need to see to use it: 3:1.
        case large

        var minimum: Double {
            switch self {
            case .text: 4.5
            case .large: 3
            }
        }
    }

    /// Relative luminance, 0 (black) to 1 (white).
    static func luminance(_ hex: UInt32) -> Double {
        func channel(_ shift: UInt32) -> Double {
            let c = Double((hex >> shift) & 0xFF) / 255
            return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    }

    /// The contrast ratio of two colours, 1 to 21, whichever is lighter.
    static func contrastRatio(_ a: UInt32, _ b: UInt32) -> Double {
        let (la, lb) = (luminance(a), luminance(b))
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    /// `foreground` at `opacity` over an opaque `background`: what a
    /// `.opacity(_:)` fill actually shows.
    static func composite(_ foreground: UInt32, opacity: Double, over background: UInt32) -> UInt32 {
        func channel(_ shift: UInt32) -> UInt32 {
            let f = Double((foreground >> shift) & 0xFF)
            let b = Double((background >> shift) & 0xFF)
            return UInt32((f * opacity + b * (1 - opacity)).rounded()) << shift
        }
        return channel(16) | channel(8) | channel(0)
    }
}

/// One foreground drawn on one background somewhere in the app.
struct ContrastPair: Hashable {
    let name: String
    let foreground: UInt32
    let background: UInt32
    let level: WCAG.Level

    var ratio: Double { WCAG.contrastRatio(foreground, background) }
    var passes: Bool { ratio >= level.minimum }
}
