import XCTest

/// A family device (#124), with the fake parent flow (`-ParentAccessFakes`):
/// a parent signs in and adds a child, the kid screens then start at the
/// family picker, which shows the kid-facing name (not the name the parent
/// typed), and the kid plays and switches back without a parental gate.
final class FamilyPickerUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testAParentAddsAChildAndTheKidPicksThemselves() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-ParentAccessFakes", "YES", "-DAResetStore", "YES"]
        app.launch()
        let any = app.descendants(matching: .any)

        // Guest mode: no parent yet, straight to the map.
        XCTAssertTrue(any["map.node.1"].waitForExistence(timeout: 60))
        XCTAssertFalse(any["map.switchKid"].exists)

        // The parent signs in. The parent area stays open while the kid
        // screens underneath switch to the picker.
        any["home.grownUps"].tap()
        let question = any["parentalGate.question"]
        XCTAssertTrue(question.waitForExistence(timeout: 10))
        let answer = try XCTUnwrap(Self.product(in: question.label), "can't read \(question.label)")
        any["parentalGate.answer"].tap()
        any["parentalGate.answer"].typeText("\(answer)")
        let continueButton = any["parentalGate.continue"]
        // Enabled once the typed answer reaches the model.
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"), object: continueButton)
        XCTAssertEqual(XCTWaiter().wait(for: [enabled], timeout: 10), .completed)
        continueButton.tap()
        let apple = any["parentSignIn.apple"]
        XCTAssertTrue(apple.waitForExistence(timeout: 10))
        apple.tap()
        XCTAssertTrue(any["parentHome"].waitForExistence(timeout: 10))

        // The parent view's identifier covers its children's, so these go
        // by label.
        let addChild = app.buttons["Add a child"]
        XCTAssertTrue(addChild.waitForExistence(timeout: 10))
        addChild.tap()
        let name = any["addChild.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.typeText("Ada Lovelace")
        any["addChild.submit"].tap()
        // The parent view shows the name the parent typed.
        XCTAssertTrue(app.staticTexts["Ada Lovelace"].waitForExistence(timeout: 10))
        any["parentAccess.close"].tap()

        // The picker: the kid's own (placeholder) name, never the real one.
        let tile = any["picker.kid.1000"]
        XCTAssertTrue(tile.waitForExistence(timeout: 10))
        XCTAssertEqual(tile.label, "New adventurer")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Ada'")).firstMatch.exists)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "family-picker"
        shot.lifetime = .keepAlways
        add(shot)

        // Tap the avatar to play; switch back with no gate.
        tile.tap()
        XCTAssertTrue(any["map.node.1"].waitForExistence(timeout: 10))
        let switchKid = any["map.switchKid"]
        XCTAssertTrue(switchKid.exists)
        switchKid.tap()
        XCTAssertTrue(tile.waitForExistence(timeout: 10))
        XCTAssertFalse(any["parentalGate.question"].exists)
    }

    /// "What is fourteen times six?" → 84 (the gate writes numbers in words).
    static func product(in question: String) -> Int? {
        let words = [
            "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
            "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
            "seventeen": 17, "eighteen": 18, "nineteen": 19,
        ]
        let numbers = question.lowercased()
            .split(whereSeparator: { !$0.isLetter })
            .compactMap { words[String($0)] }
        guard numbers.count == 2 else { return nil }
        return numbers[0] * numbers[1]
    }
}
