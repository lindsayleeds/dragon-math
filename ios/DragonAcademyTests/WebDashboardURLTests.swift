@testable import DragonAcademy
import Foundation
import Testing

struct WebDashboardURLTests {
    @Test func theDashboardIsTheParentPageOnTheWebOrigin() {
        let base = URL(string: "https://mydragonmath.com")!
        #expect(AppConfiguration.dashboardURL(for: base).absoluteString == "https://mydragonmath.com/parent")
    }

    @Test func aTrailingSlashOnTheOriginDoesNotDoubleUp() {
        let base = URL(string: "http://localhost:5173/")!
        #expect(AppConfiguration.dashboardURL(for: base).absoluteString == "http://localhost:5173/parent")
    }

    @Test func aMissingOrBrokenWebSettingFallsBackToTheDevServer() {
        let fallback = AppConfiguration.fallbackWebBaseURL
        #expect(AppConfiguration.baseURL(from: nil, fallback: fallback) == fallback)
        #expect(AppConfiguration.baseURL(from: "$(DRAGON_WEB_BASE_URL)", fallback: fallback) == fallback)
        #expect(AppConfiguration.baseURL(from: "ftp://example.com", fallback: fallback) == fallback)
        #expect(AppConfiguration.baseURL(from: " https://mydragonmath.com ", fallback: fallback)
            == URL(string: "https://mydragonmath.com")!)
    }

    @Test func theApiSettingStillFallsBackToTheApiServer() {
        #expect(AppConfiguration.baseURL(from: nil) == AppConfiguration.fallbackBaseURL)
    }
}
