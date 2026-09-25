import Foundation
import Testing
@testable import DragonAcademy

private let token = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a9b"

@Suite struct KidLinkTests {
    @Test(arguments: [
        "https://mydragonmath.com/k/\(token)",
        "https://www.mydragonmath.com/k/\(token)",
        // The test site's QR codes, and the dev server's.
        "https://test.example.dev/k/\(token)",
        "http://localhost:5173/k/\(token)",
        "https://mydragonmath.com/k/\(token)/",
        "https://mydragonmath.com/k/\(token)?utm_source=qr",
        "https://mydragonmath.com/k/\(token.uppercased())",
    ])
    func readsKidLinks(_ string: String) throws {
        let link = KidLink(url: try #require(URL(string: string)))
        #expect(link == .kid(token: String(string.split(separator: "/")[3].prefix(36))))
    }

    @Test func readsFamilyLinks() throws {
        #expect(KidLink(url: try #require(URL(string: "https://mydragonmath.com/family/\(token)")))
            == .family(token: token))
    }

    @Test(arguments: [
        "https://mydragonmath.com/",
        "https://mydragonmath.com/k/",
        "https://mydragonmath.com/k/not-a-token",
        "https://mydragonmath.com/k/\(token)/extra",
        "https://mydragonmath.com/parent/\(token)",
        "https://mydragonmath.com/home?k=\(token)",
        "https://mydragonmath.com/k/3f2b8c1e9a4d4e7f8b210c5d6e7f8a9b",
        "https://mydragonmath.com/k/zf2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a9b",
        "dragonacademy://k/\(token)",
        "mailto:k@\(token)",
    ])
    func ignoresOtherURLs(_ string: String) throws {
        #expect(KidLink(url: try #require(URL(string: string))) == nil)
    }

    @Test func readsScannedText() {
        #expect(KidLink(scanned: "  https://mydragonmath.com/k/\(token)\n") == .kid(token: token))
        #expect(KidLink(scanned: "WIFI:S:Classroom;T:WPA;P:secret;;") == nil)
        #expect(KidLink(scanned: token) == nil)
        #expect(KidLink(scanned: "") == nil)
    }
}
