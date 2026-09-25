import Foundation
import SwiftUI
import Testing
import UIKit
@testable import DragonAcademy

/// WCAG contrast (#169): the helper against known values, then every pair
/// the theme draws.
struct ContrastTests {
    @Test func blackOnWhiteIsTwentyOneToOne() {
        #expect(abs(WCAG.contrastRatio(0x000000, 0xFFFFFF) - 21) < 0.0001)
        #expect(WCAG.contrastRatio(0xFFFFFF, 0x000000) == WCAG.contrastRatio(0x000000, 0xFFFFFF))
        #expect(WCAG.contrastRatio(0x777777, 0x777777) == 1)
    }

    @Test func matchesPublishedRatios() {
        // #767676 is the classic lightest grey that passes 4.5:1 on white.
        #expect(abs(WCAG.contrastRatio(0x767676, 0xFFFFFF) - 4.54) < 0.01)
        #expect(abs(WCAG.contrastRatio(0x777777, 0xFFFFFF) - 4.48) < 0.01)
        #expect(abs(WCAG.luminance(0xFFFFFF) - 1) < 0.0001)
        #expect(WCAG.luminance(0x000000) == 0)
    }

    @Test func compositesAnOpacityOverItsBackground() {
        #expect(WCAG.composite(0x000000, opacity: 0.5, over: 0xFFFFFF) == 0x808080)
        #expect(WCAG.composite(0xD97474, opacity: 1, over: 0xFFFFFF) == 0xD97474)
        #expect(WCAG.composite(0xD97474, opacity: 0, over: 0xF4EAD5) == 0xF4EAD5)
    }

    @Test func levelsAreWCAGAA() {
        #expect(WCAG.Level.text.minimum == 4.5)
        #expect(WCAG.Level.large.minimum == 3)
    }

    @Test(arguments: ThemeContrast.pairs)
    func everyThemePairMeetsItsLevel(_ pair: ContrastPair) {
        #expect(
            pair.passes,
            "\(pair.name): \(String(format: "%.2f", pair.ratio)):1, needs \(pair.level.minimum):1")
    }

    @Test func thePairsListIsNotEmptyAndNamesAreUnique() {
        #expect(ThemeContrast.pairs.count > 40)
        #expect(Set(ThemeContrast.pairs.map(\.name)).count == ThemeContrast.pairs.count)
    }

    /// The crayon fills are why the ink tokens exist: if a fill ever became
    /// dark enough to write with, the ink split would be worth revisiting.
    @Test func crayonFillsFailAsBodyTextOnPaper() {
        for fill in [Palette.Hex.rose, Palette.Hex.sage] {
            #expect(WCAG.contrastRatio(fill, Palette.Hex.paper) < WCAG.Level.large.minimum)
        }
    }

    @Test func paletteColorsAreDrawnFromTheirHex() {
        let checks: [(Color, UInt32)] = [
            (Palette.paper, Palette.Hex.paper), (Palette.charcoal, Palette.Hex.charcoal),
            (Palette.roseInk, Palette.Hex.roseInk), (Palette.sageInk, Palette.Hex.sageInk),
            (Palette.cardBottom, Palette.Hex.cardBottom),
        ]
        for (color, hex) in checks {
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
            let drawn = UInt32((r * 255).rounded()) << 16 | UInt32((g * 255).rounded()) << 8 | UInt32((b * 255).rounded())
            #expect(drawn == hex)
        }
    }
}

/// Right and wrong never by colour alone (#169): both states carry a symbol
/// and a spoken label, and the two differ in shape, not just tint.
struct AnswerFeedbackTests {
    @Test(arguments: AnswerFeedback.allCases)
    func eachStateHasASymbolAndALabel(_ feedback: AnswerFeedback) {
        #expect(!feedback.symbolName.isEmpty)
        #expect(UIImage(systemName: feedback.symbolName) != nil, "\(feedback.symbolName) is not an SF Symbol")
        #expect(!String(localized: feedback.label).isEmpty)
    }

    @Test func coversRightAndWrong() {
        #expect(AnswerFeedback.allCases == [.correct, .tryAgain])
    }

    @Test func theStatesDifferInShapeAndLabel() {
        #expect(AnswerFeedback.correct.symbolName != AnswerFeedback.tryAgain.symbolName)
        #expect(String(localized: AnswerFeedback.correct.label) == "Correct")
        #expect(String(localized: AnswerFeedback.tryAgain.label) == "Try again")
    }

    @Test func theMarksReadOnPaperAndWhite() {
        for feedback in AnswerFeedback.allCases {
            for bg in [Palette.Hex.paper, Palette.Hex.paperDeep, Palette.Hex.cardBottom, Palette.Hex.white] {
                #expect(WCAG.contrastRatio(feedback.tintHex, bg) >= WCAG.Level.large.minimum)
            }
        }
    }
}
