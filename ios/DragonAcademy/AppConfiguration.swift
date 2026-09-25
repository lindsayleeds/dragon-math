import Foundation

/// Values baked into Info.plist at build time.
enum AppConfiguration {
    /// Server origin, from the `DragonAPIBaseURL` Info.plist key, which is the
    /// `DRAGON_API_BASE_URL` build setting (project.yml): the local dev server
    /// (`npm run server`, port 3001) in Debug, which the simulator reaches on
    /// the Mac's localhost, and production in Release. A missing or broken
    /// value falls back to the dev server. In a Debug build the
    /// `-DAAPIBaseURL <url>` launch argument overrides it, so the end-to-end
    /// UI tests (`npm run ios:e2e`) reach the scratch server they start.
    static let apiBaseURL: URL = baseURL(from: debugAPIBaseURL ?? Bundle.main.object(forInfoDictionaryKey: "DragonAPIBaseURL"))

    private static var debugAPIBaseURL: String? {
        #if DEBUG
        UserDefaults.standard.string(forKey: "DAAPIBaseURL")
        #else
        nil
        #endif
    }

    static let fallbackBaseURL = URL(string: "http://localhost:3001")!

    /// Web app origin, from the `DragonWebBaseURL` Info.plist key (the
    /// `DRAGON_WEB_BASE_URL` build setting): Vite's dev server in Debug,
    /// production in Release. A missing or broken value falls back to Vite.
    static let webBaseURL: URL = baseURL(from: Bundle.main.object(forInfoDictionaryKey: "DragonWebBaseURL"), fallback: fallbackWebBaseURL)

    static let fallbackWebBaseURL = URL(string: "http://localhost:5173")!

    /// The full parent dashboard on the web, for what the app's slim parent
    /// view leaves out (ADR 0002).
    static var webDashboardURL: URL { dashboardURL(for: webBaseURL) }

    static func dashboardURL(for base: URL) -> URL {
        base.appending(path: "parent")
    }

    static func baseURL(from value: Any?, fallback: URL = fallbackBaseURL) -> URL {
        guard let string = value as? String,
              let url = URL(string: string.trimmingCharacters(in: .whitespaces)),
              url.scheme == "http" || url.scheme == "https", url.host() != nil
        else { return fallback }
        return url
    }

    /// `-ParentAccessFakes YES` on launch swaps Face ID, Apple and the server
    /// for fakes, to walk the parent flow in a simulator without a paid team.
    /// Debug builds only.
    static var usesParentAccessFakes: Bool {
        #if DEBUG
        UserDefaults.standard.bool(forKey: "ParentAccessFakes")
        #else
        false
        #endif
    }
}
