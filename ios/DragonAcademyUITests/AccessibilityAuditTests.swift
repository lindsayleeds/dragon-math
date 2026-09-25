import XCTest

/// Xcode's accessibility audit on the main kid screens and the way into the
/// parent area (#168): the map, the Learning Lair hub, the Dragon Den, a
/// battle and its result card with the dragon prize, the parental gate, and
/// the family picker.
///
/// Run on a simulator (`-only-testing:DragonAcademyUITests/AccessibilityAuditTests`).
/// UI tests on the full map hang under the current Xcode beta, so the CI
/// lane runs unit tests only; run this by hand before a release.
///
/// Deliberately ignored: Dynamic Type on the map's node labels and chapter
/// headings, which are drawn at the art's scale (`Typeface.display(fixedSize:)`)
/// and read by VoiceOver instead, and on the battle board, which caps its
/// text at the second accessibility size to keep the grid on screen.
final class AccessibilityAuditTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testTheGuestScreensPassTheAudit() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-DABattleSeed", "117", "-DAResetStore", "YES"]
        app.launch()
        let any = app.descendants(matching: .any)

        let node = any["map.node.1"]
        XCTAssertTrue(node.waitForExistence(timeout: 60))
        try audit(app, "map")

        any["home.learningLair"].tap()
        XCTAssertTrue(any["lair.back"].waitForExistence(timeout: 10))
        try audit(app, "learning lair")
        any["lair.back"].tap()

        XCTAssertTrue(any["home.dragonDen"].waitForExistence(timeout: 10))
        any["home.dragonDen"].tap()
        XCTAssertTrue(any["den.back"].waitForExistence(timeout: 10))
        try audit(app, "dragon den")
        any["den.back"].tap()

        XCTAssertTrue(node.waitForExistence(timeout: 30))
        node.tap()
        let grid = any["battle.grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 30))
        try audit(app, "battle")

        try winTheBattle(app)
        XCTAssertTrue(any["prize.card.0"].waitForExistence(timeout: 10))
        try audit(app, "prize reveal")
        any["result.map"].tap()

        XCTAssertTrue(any["home.grownUps"].waitForExistence(timeout: 30))
        any["home.grownUps"].tap()
        XCTAssertTrue(any["parentalGate.question"].waitForExistence(timeout: 10))
        try audit(app, "parental gate")
    }

    @MainActor
    func testTheFamilyPickerPassesTheAudit() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-ParentAccessFakes", "YES", "-DAResetStore", "YES"]
        app.launch()
        let any = app.descendants(matching: .any)

        // A parent signs in and adds a child, so the picker has a kid on it.
        XCTAssertTrue(any["home.grownUps"].waitForExistence(timeout: 60))
        any["home.grownUps"].tap()
        let question = any["parentalGate.question"]
        XCTAssertTrue(question.waitForExistence(timeout: 10))
        let answer = try XCTUnwrap(FamilyPickerUITests.product(in: question.label))
        any["parentalGate.answer"].tap()
        any["parentalGate.answer"].typeText("\(answer)")
        let continueButton = any["parentalGate.continue"]
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"), object: continueButton)
        XCTAssertEqual(XCTWaiter().wait(for: [enabled], timeout: 10), .completed)
        continueButton.tap()
        let apple = any["parentSignIn.apple"]
        XCTAssertTrue(apple.waitForExistence(timeout: 10))
        apple.tap()
        let addChild = app.buttons["Add a child"]
        XCTAssertTrue(addChild.waitForExistence(timeout: 10))
        addChild.tap()
        let name = any["addChild.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.typeText("Ada Lovelace")
        any["addChild.submit"].tap()
        XCTAssertTrue(app.staticTexts["Ada Lovelace"].waitForExistence(timeout: 10))
        any["parentAccess.close"].tap()

        XCTAssertTrue(any["picker.kid.1000"].waitForExistence(timeout: 10))
        try audit(app, "family picker")
    }

    /// Audits what's on screen, skipping the text that is fixed-size on
    /// purpose (see the type's comment).
    @MainActor
    private func audit(_ app: XCUIApplication, _ screen: String) throws {
        try XCTContext.runActivity(named: "Audit: \(screen)") { _ in
            try app.performAccessibilityAudit { issue in
                guard issue.auditType == .dynamicType, let element = issue.element else { return false }
                let id = element.identifier
                return id.hasPrefix("map.") || id.hasPrefix("cell.") || id.hasPrefix("battle.") || id.hasPrefix("score.")
            }
        }
    }

    /// Answers until the player reaches the target, as GuestBattleUITests.
    @MainActor
    private func winTheBattle(_ app: XCUIApplication) throws {
        let any = app.descendants(matching: .any)
        let grid = any["battle.grid"]
        let problem = any["battle.problem"]
        let playerScore = any["score.player"]
        var solved = 0
        while solved < 10 {
            XCTAssertTrue(wait(for: grid, value: "ready", timeout: 10), "grid never became ready")
            let answer = try XCTUnwrap(GuestBattleUITests.answer(to: problem.label), "can't read \(problem.label)")
            app.buttons.matching(
                NSPredicate(format: "identifier BEGINSWITH 'cell.' AND label == %@", "\(answer)")
            ).firstMatch.tap()
            if wait(for: playerScore, value: "\(solved + 1)", timeout: 3) { solved += 1 }
        }
        XCTAssertTrue(any["result.title"].waitForExistence(timeout: 10))
    }

    private func wait(for element: XCUIElement, value: String, timeout: TimeInterval) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", value), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }
}
