import SwiftUI

/// A font combo from the kid's Settings: a display family for headings,
/// numbers and buttons, and a body family for everything else — the web's
/// `--font-display` / `--font-body` (src/data/fontThemes.js). The list is
/// generated into FontThemeCatalog.swift; the ids are what the server stores
/// in `users.font`.
struct FontTheme: Identifiable, Hashable, Sendable {
    let id: String
    /// English catalog text from fontThemes.js, with its emoji.
    let label: String
    let display: FontFamily
    let body: FontFamily

    /// Clean & Clear, everyone's default (CLAUDE.md).
    static var `default`: FontTheme { named(defaultID) }

    /// The theme with this id; the default for nil or an id this app doesn't
    /// know (as the web's `getFontTheme`).
    static func named(_ id: String?) -> FontTheme {
        all.first { $0.id == id } ?? all.first { $0.id == defaultID }!
    }
}

extension EnvironmentValues {
    /// The playing kid's font theme; every `Typeface` font reads it. Set for
    /// the kid screens by `profileFontTheme()`.
    @Entry var fontTheme: FontTheme = .default
}
