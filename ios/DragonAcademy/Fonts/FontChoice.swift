import Store
import SwiftUI

/// Which font theme a profile reads in, and changing it. The choice is a
/// `FontChosen` event in the Store, so it is kept per profile, survives
/// relaunch and uploads with the rest of the queue (`font_chosen`, which sets
/// the child's font on the web too); the latest one recorded wins.
enum FontChoice {
    /// The theme for a profile with this progress: its latest choice, or the
    /// default.
    static func current(in progress: ProfileProgress) -> FontTheme {
        .named(progress.fontThemeID)
    }

    /// Records `theme` as the profile's choice and requests a sync. Nothing is
    /// recorded for the theme they already have.
    ///
    /// - Returns: whether a choice was recorded.
    @discardableResult
    static func choose(
        _ theme: FontTheme, in store: any Store, for profileID: Profile.ID,
        requestSync: @MainActor () -> Void
    ) async throws -> Bool {
        guard theme != current(in: try await store.progress(for: profileID)) else { return false }
        try await store.record(FontChosen(fontThemeID: theme.id), for: profileID)
        await requestSync()
        return true
    }
}

/// Sets `\.fontTheme` to the current profile's choice, following it as it
/// changes.
private struct ProfileFontTheme: ViewModifier {
    @Environment(\.store) private var store
    @Environment(\.currentProfile) private var profile
    @State private var theme = FontTheme.default

    func body(content: Content) -> some View {
        content
            .environment(\.fontTheme, theme)
            .task(id: profile?.id) {
                guard let store, let profile else { return }
                do {
                    for try await progress in store.observeProgress(for: profile.id) {
                        theme = FontChoice.current(in: progress)
                    }
                } catch {
                    // Keep the last theme; the Store logs its own failures.
                }
            }
    }
}

extension View {
    /// Draws `Typeface` text in the current profile's font theme.
    func profileFontTheme() -> some View {
        modifier(ProfileFontTheme())
    }
}
