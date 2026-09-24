import Foundation

/// Values baked into Info.plist at build time.
enum AppConfiguration {
    /// Server origin, from the `DragonAPIBaseURL` Info.plist key, which is the
    /// `DRAGON_API_BASE_URL` build setting (project.yml): the local dev server
    /// (`npm run server`, port 3001) in Debug, which the simulator reaches on
    /// the Mac's localhost, and production in Release. A missing or broken
    /// value falls back to the dev server.
    static let apiBaseURL: URL = baseURL(from: Bundle.main.object(forInfoDictionaryKey: "DragonAPIBaseURL"))

    static let fallbackBaseURL = URL(string: "http://localhost:3001")!

    static func baseURL(from value: Any?) -> URL {
        guard let string = value as? String,
              let url = URL(string: string.trimmingCharacters(in: .whitespaces)),
              url.scheme == "http" || url.scheme == "https", url.host() != nil
        else { return fallbackBaseURL }
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
