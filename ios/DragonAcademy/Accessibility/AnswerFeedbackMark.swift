import SwiftUI

/// Right or wrong, shown so it never depends on colour alone (#169): every
/// place a game tints an answer sage or rose also draws this mark — a tick
/// or a cross in a disc — and says "Correct" or "Try again" to VoiceOver.
enum AnswerFeedback: CaseIterable, Hashable {
    case correct
    case tryAgain

    /// The SF Symbol: the shape carries the meaning, the tint only adds to it.
    var symbolName: String {
        switch self {
        case .correct: "checkmark.circle.fill"
        case .tryAgain: "xmark.circle.fill"
        }
    }

    /// What VoiceOver says for the mark. ("Correct" has a key of its own:
    /// the catalog's "✓ Correct!" would generate the same string symbol.)
    var label: LocalizedStringResource {
        switch self {
        case .correct: LocalizedStringResource(
            "feedback.correct", defaultValue: "Correct", comment: "VoiceOver: the mark on a right answer")
        case .tryAgain: LocalizedStringResource("Try again")
        }
    }

    /// The disc's colour, from the ink palette (3:1 or more on paper and
    /// cards; ThemeContrast checks it).
    var tintHex: UInt32 {
        switch self {
        case .correct: Palette.Hex.sageInk
        case .tryAgain: Palette.Hex.roseInk
        }
    }

    var tint: Color { Color(hex: tintHex) }
}

/// The tick or cross in its disc, with a white rim so it reads on any fill
/// (a rose cell, a rose banner, cream paper).
struct AnswerFeedbackMark: View {
    let feedback: AnswerFeedback
    var size: CGFloat = 24

    var body: some View {
        Image(systemName: feedback.symbolName)
            .symbolRenderingMode(.palette)
            .foregroundStyle(.white, feedback.tint)
            .font(.system(size: size, weight: .bold))
            .background(Circle().fill(.white).padding(-size * 0.08))
            .accessibilityLabel(Text(feedback.label))
            .accessibilityIdentifier("feedback.\(feedback == .correct ? "correct" : "tryAgain")")
    }
}

private struct AnswerFeedbackOverlay: ViewModifier {
    let feedback: AnswerFeedback?
    let alignment: Alignment
    let size: CGFloat
    let inset: CGFloat
    let announces: Bool

    @ViewBuilder func body(content: Content) -> some View {
        let marked = content.overlay(alignment: alignment) {
            if let feedback {
                AnswerFeedbackMark(feedback: feedback, size: size)
                    .padding(inset)
                    .transition(.scale(scale: 0.4).combined(with: .opacity))
                    .accessibilityHidden(true)
            }
        }
        // `announces` is fixed per call site, so this doesn't swap the
        // view's identity as the feedback changes.
        if announces {
            marked.accessibilityValue(feedback.map { Text($0.label) } ?? Text(verbatim: ""))
        } else {
            marked
        }
    }
}

extension View {
    /// Pins an `AnswerFeedbackMark` to a corner while `feedback` is set, and
    /// reads it out as the view's accessibility value. Pass
    /// `announces: false` where the view already sets its own value and
    /// folds the feedback's `label` into it.
    func answerFeedback(
        _ feedback: AnswerFeedback?, alignment: Alignment = .topTrailing, size: CGFloat = 22,
        inset: CGFloat = 4, announces: Bool = true
    ) -> some View {
        modifier(AnswerFeedbackOverlay(
            feedback: feedback, alignment: alignment, size: size, inset: inset, announces: announces))
    }
}
