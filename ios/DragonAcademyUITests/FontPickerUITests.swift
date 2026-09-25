import XCTest

/// The font picker in kid Settings: Clean & Clear on a fresh install, and a
/// kid's choice is kept across relaunch.
final class FontPickerUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testAChosenFontIsKeptAcrossRelaunch() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-DAResetStore", "YES"]
        app.launch()
        var any = app.descendants(matching: .any)

        let settings = any["map.settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 60))
        settings.tap()
        let clean = any["settings.font.clean"]
        XCTAssertTrue(clean.waitForExistence(timeout: 10))
        XCTAssertTrue(clean.isSelected)
        let storybook = any["settings.font.storybook"]
        XCTAssertFalse(storybook.isSelected)
        storybook.tap()
        XCTAssertTrue(storybook.waitForSelected(timeout: 10))
        XCTAssertFalse(clean.isSelected)
        any["settings.done"].tap()

        app.terminate()
        app.launchArguments = []
        app.launch()
        any = app.descendants(matching: .any)
        XCTAssertTrue(any["map.settings"].waitForExistence(timeout: 60))
        any["map.settings"].tap()
        let kept = any["settings.font.storybook"]
        XCTAssertTrue(kept.waitForExistence(timeout: 10))
        XCTAssertTrue(kept.waitForSelected(timeout: 10))
    }
}

private extension XCUIElement {
    /// Waits for the element to report `isSelected` (the store round trip
    /// updates it a moment after the tap).
    func waitForSelected(timeout: TimeInterval) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isSelected == true"), object: self)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }
}
