import Testing
@testable import DragonAcademy

@MainActor @Test func homeLinksEveryLocalPackage() {
    #expect(HomeView.linkedModules == ["GameRules", "Store", "API", "Sync", "Audio"])
}
