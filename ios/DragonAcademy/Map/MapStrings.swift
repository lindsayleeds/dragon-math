import Foundation
import GameRules

// The map data holds English source text; these look it up in the String
// Catalog, where `npm run ios:map-data` keeps an entry for each.

extension MapNode {
    var localizedLabel: LocalizedStringResource {
        LocalizedStringResource(String.LocalizationValue(label))
    }
}

extension MapWorld {
    var localizedName: LocalizedStringResource {
        LocalizedStringResource(String.LocalizationValue(name))
    }

    var localizedChapterHeading: LocalizedStringResource {
        LocalizedStringResource(String.LocalizationValue(chapterHeading))
    }
}
