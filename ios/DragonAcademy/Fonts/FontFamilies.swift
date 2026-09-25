import UIKit

/// A font family the themes (`FontTheme`) draw with: the files bundled for
/// it, the PostScript names of the two weights the app uses, and the closest
/// font iOS ships, used for any family whose files aren't in the bundle.
///
/// The files come from github.com/google/fonts (README.md in this folder
/// lists each one and where it comes from; LICENSES.md has the licenses).
/// Every file here must also be listed under `UIAppFonts` in Info.plist.
/// Variable fonts (`Caveat[wght].ttf`) register every named instance, so
/// `bold` is the instance's own PostScript name.
struct FontFamily: Hashable, Sendable {
    enum Weight: Sendable {
        /// Body copy (`--font-body`, weight 400).
        case regular
        /// Display type (`--font-display`, weight 700 as the web's headings).
        case bold
    }

    /// The CSS family name, as src/data/fontThemes.js has it.
    let name: String
    /// The font files for it in the app bundle.
    let files: [String]
    let regular: String
    let bold: String
    /// Built-in iOS fonts (PostScript names) standing in while the family's
    /// files aren't bundled.
    let fallbackRegular: String
    let fallbackBold: String

    /// The bundled font's PostScript name for `weight`.
    func postScriptName(_ weight: Weight) -> String {
        weight == .bold ? bold : regular
    }

    /// The built-in stand-in's PostScript name for `weight`.
    func fallbackName(_ weight: Weight) -> String {
        weight == .bold ? fallbackBold : fallbackRegular
    }

    /// The font to draw `weight` with: the bundled one when it's registered,
    /// else the built-in stand-in. `isAvailable` says whether a PostScript
    /// name resolves; the default asks UIKit, once per name.
    func resolvedName(_ weight: Weight, isAvailable: (String) -> Bool = FontFamily.isRegistered) -> String {
        let name = postScriptName(weight)
        return isAvailable(name) ? name : fallbackName(weight)
    }

    /// Every family a theme uses.
    static let all: [FontFamily] = [.caveat, .patrickHand, .fredoka, .nunito, .baloo2, .quicksand, .comicNeue]

    /// Whether a PostScript name resolves to a font in this process. Fonts in
    /// `UIAppFonts` are registered before launch, so the answer never
    /// changes; it's worked out once for every family's names.
    static func isRegistered(_ postScriptName: String) -> Bool {
        registered.contains(postScriptName)
    }

    private static let registered: Set<String> = Set(
        all.flatMap { [$0.regular, $0.bold] }.filter { UIFont(name: $0, size: 12) != nil })
}

extension FontFamily {
    // Stand-ins: Noteworthy for the handwriting faces, Arial Rounded for the
    // round display faces, Avenir for the rounded sans bodies, and Chalkboard
    // SE for Comic Neue (the app's stand-in before #166).

    static let caveat = FontFamily(
        name: "Caveat", files: ["Caveat[wght].ttf"],
        regular: "Caveat-Regular", bold: "Caveat-Bold",
        fallbackRegular: "Noteworthy-Light", fallbackBold: "Noteworthy-Bold")

    /// Only a regular weight exists; the themes use it for body copy.
    static let patrickHand = FontFamily(
        name: "Patrick Hand", files: ["PatrickHand-Regular.ttf"],
        regular: "PatrickHand-Regular", bold: "PatrickHand-Regular",
        fallbackRegular: "Noteworthy-Light", fallbackBold: "Noteworthy-Bold")

    static let fredoka = FontFamily(
        name: "Fredoka", files: ["Fredoka[wdth,wght].ttf"],
        regular: "Fredoka-Regular", bold: "Fredoka-Bold",
        fallbackRegular: "ArialRoundedMTBold", fallbackBold: "ArialRoundedMTBold")

    static let nunito = FontFamily(
        name: "Nunito", files: ["Nunito[wght].ttf"],
        regular: "Nunito-Regular", bold: "Nunito-Bold",
        fallbackRegular: "AvenirNext-Regular", fallbackBold: "AvenirNext-Bold")

    static let baloo2 = FontFamily(
        name: "Baloo 2", files: ["Baloo2[wght].ttf"],
        regular: "Baloo2-Regular", bold: "Baloo2-Bold",
        fallbackRegular: "ArialRoundedMTBold", fallbackBold: "ArialRoundedMTBold")

    static let quicksand = FontFamily(
        name: "Quicksand", files: ["Quicksand[wght].ttf"],
        regular: "Quicksand-Regular", bold: "Quicksand-Bold",
        fallbackRegular: "Avenir-Book", fallbackBold: "Avenir-Heavy")

    static let comicNeue = FontFamily(
        name: "Comic Neue", files: ["ComicNeue-Regular.ttf", "ComicNeue-Bold.ttf"],
        regular: "ComicNeue-Regular", bold: "ComicNeue-Bold",
        fallbackRegular: "ChalkboardSE-Regular", fallbackBold: "ChalkboardSE-Bold")
}
