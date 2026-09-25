import SwiftUI

/// A row of stars, filled up to `filled` and outlined after: filled and
/// empty differ by shape as well as colour (#169). Mustard alone is too
/// light to see on cream, so each star has an ink edge.
struct StarRating: View {
    let filled: Int
    var total = 5
    var size: CGFloat = 16

    var body: some View {
        HStack(spacing: size * 0.08) {
            ForEach(1...max(total, 1), id: \.self) { i in
                ZStack {
                    if i <= filled { Image(systemName: "star.fill").foregroundStyle(Palette.mustard) }
                    Image(systemName: "star").foregroundStyle(i <= filled ? Palette.kraftDark : Palette.kraft)
                }
            }
        }
        .font(.system(size: size))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(StarRatingAccessibility.label(filled: filled, total: total)))
    }
}
