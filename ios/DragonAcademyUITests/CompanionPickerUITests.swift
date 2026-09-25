import XCTest

/// The companion picker from the map, and the chosen companion in battle. A
/// fresh install has only Pip; the boss companions show locked.
final class CompanionPickerUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testAFreshInstallBringsPipAndTheOthersAreLocked() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-DABattleSeed", "138", "-DAResetStore", "YES"]
        app.launch()
        let any = app.descendants(matching: .any)

        let open = any["home.companion"]
        XCTAssertTrue(open.waitForExistence(timeout: 60))
        XCTAssertEqual(open.label, "Companion: Pip")
        open.tap()

        let pip = any["companion.pip"]
        XCTAssertTrue(pip.waitForExistence(timeout: 10))
        XCTAssertTrue(pip.isSelected)
        XCTAssertEqual(pip.value as? String, "Pip's Peek")
        let storm = any["companion.storm_dragon"]
        XCTAssertEqual(storm.label, "Not befriended yet")
        XCTAssertFalse(storm.isEnabled)
        any["companions.done"].tap()

        any["map.node.1"].tap()
        let companion = any["battle.companion"]
        XCTAssertTrue(companion.waitForExistence(timeout: 30))
        XCTAssertEqual(companion.label, "Your companion: Pip")
        XCTAssertEqual(companion.value as? String, "Pip's Peek")
    }
}
