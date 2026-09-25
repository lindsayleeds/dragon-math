import SwiftUI
import UIKit

/// The bundled dragon art: `dragon-<id>` in Assets.xcassets/Dragons, made from
/// the web's public/dragon_pngs by `npm run ios:dragon-art`
/// (scripts/ios-dragon-art/dragonArt.js holds the sizes).
enum DragonArt {
    /// The largest a dragon is drawn, in points. The bundled bitmaps are 3×
    /// this, so drawing one bigger would blur it; change DRAGON_ART_MAX_POINTS
    /// in the script with it.
    static let maxPoints: CGFloat = 120

    static func imageName(_ dragonID: Int) -> String { "dragon-\(dragonID)" }

    /// Whether the app has this dragon's art. A dragon added to the catalog
    /// after this build doesn't, until the next release.
    static func isBundled(_ dragonID: Int) -> Bool {
        UIImage(named: imageName(dragonID)) != nil
    }
}

/// A dragon's art, scaled to fit its frame (keep that frame within
/// `DragonArt.maxPoints`). A dragon without bundled art shows a dragon glyph.
/// Decorative: callers label the card it sits on.
struct DragonArtView: View {
    let dragonID: Int

    var body: some View {
        Group {
            if DragonArt.isBundled(dragonID) {
                Image(DragonArt.imageName(dragonID))
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
            } else {
                Text(verbatim: "🐉")
                    .font(.system(size: 200))
                    .minimumScaleFactor(0.05)
                    .lineLimit(1)
            }
        }
        .accessibilityHidden(true)
    }
}
