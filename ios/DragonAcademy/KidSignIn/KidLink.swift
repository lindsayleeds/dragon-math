import Foundation

/// A sign-in link the app understands, from a universal link or a scanned QR
/// code. The web makes both: a kid's permanent login link `/k/<token>` (their
/// QR code holds the same URL) and a parent's family-device link
/// `/family/<token>`. The server's apple-app-site-association file opens
/// exactly these paths in the app (server/routes/appleAppSiteAssociation.js).
enum KidLink: Equatable, Sendable {
    /// `/k/<token>`: signs in as one kid (`POST /api/auth/child-login`).
    case kid(token: String)
    /// `/family/<token>`: lists a family's kids to pick from
    /// (`GET /api/auth/family/<token>`, then `POST /api/auth/family-login`).
    case family(token: String)

    /// The link in `url`, or nil for any other URL. Any http(s) host is
    /// accepted: a QR code printed from the test site holds that host, and
    /// the token only ever goes to this app's own server
    /// (`AppConfiguration.apiBaseURL`), never to the host in the link. Tokens
    /// are UUIDs, as the server requires.
    init?(url: URL) {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.host() != nil
        else { return nil }
        // Tolerates a trailing slash ("/k/<token>/"), as the web router does.
        let parts = url.path(percentEncoded: false).split(separator: "/")
        guard parts.count == 2 else { return nil }
        let token = String(parts[1])
        guard Self.isToken(token) else { return nil }
        switch parts[0] {
        case "k": self = .kid(token: token)
        case "family": self = .family(token: token)
        default: return nil
        }
    }

    /// The link in a scanned code's text: a URL, possibly with whitespace
    /// around it. Nil for anything else (someone's Wi-Fi code, a shop's QR).
    init?(scanned text: String) {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        self.init(url: url)
    }

    /// A UUID in its 8-4-4-4-12 hex form, either case (server/contracts/auth.js UUID_RE).
    static func isToken(_ string: String) -> Bool {
        let groups = string.split(separator: "-", omittingEmptySubsequences: false)
        guard groups.map(\.count) == [8, 4, 4, 4, 12] else { return false }
        return groups.allSatisfy { $0.allSatisfy(\.isHexDigit) }
    }
}
