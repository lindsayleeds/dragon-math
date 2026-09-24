import XCTest

/// The first path through the app: a fresh install opens on the map as the
/// guest, plays node 1 to a win, and the win is still there after a relaunch.
/// The battle is seeded (`-DABattleSeed`) so every run deals the same
/// problems and the opponent keeps the same pace.
final class GuestBattleUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testGuestWinsNodeOneAndTheWinSurvivesRelaunch() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-DABattleSeed", "117", "-DAResetStore", "YES"]
        app.launch()

        let node = app.descendants(matching: .any)["map.node.1"]
        XCTAssertTrue(node.waitForExistence(timeout: 60))
        XCTAssertEqual(node.value as? String, "not won yet")
        node.tap()

        let any = app.descendants(matching: .any)
        let grid = any["battle.grid"]
        let problem = any["battle.problem"]
        let playerScore = any["score.player"]
        XCTAssertTrue(grid.waitForExistence(timeout: 30))

        var solved = 0
        while solved < 10 {
            XCTAssertTrue(wait(for: grid, value: "ready", timeout: 10), "grid never became ready")
            let answer = try XCTUnwrap(Self.answer(to: problem.label), "can't read \(problem.label)")
            let cell = app.buttons.matching(
                NSPredicate(format: "identifier BEGINSWITH 'cell.' AND label == %@", "\(answer)")
            ).firstMatch
            cell.tap()
            // The score moves on a right answer; if the opponent took this one
            // first, the loop just reads the next problem.
            if wait(for: playerScore, value: "\(solved + 1)", timeout: 3) { solved += 1 }
        }

        let title = any["result.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertEqual(title.label, "Victory!")
        any["result.map"].tap()

        XCTAssertTrue(node.waitForExistence(timeout: 60))
        XCTAssertTrue(wait(for: node, value: "won", timeout: 5))

        // Relaunch without the reset: the NodeWon event is still in the store.
        app.terminate()
        app.launchArguments = ["-DABattleSeed", "117"]
        app.launch()
        XCTAssertTrue(node.waitForExistence(timeout: 60))
        XCTAssertTrue(wait(for: node, value: "won", timeout: 5))
    }

    /// "3 + 4 = ?" → 7.
    static func answer(to text: String) -> Int? {
        let parts = text.split(separator: " ")
        guard parts.count >= 3, let a = Int(parts[0]), let b = Int(parts[2]) else { return nil }
        switch parts[1] {
        case "+": return a + b
        case "−": return a - b
        case "×": return a * b
        case "÷": return b == 0 ? nil : a / b
        default: return nil
        }
    }

    private func wait(for element: XCUIElement, value: String, timeout: TimeInterval) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", value), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }
}
