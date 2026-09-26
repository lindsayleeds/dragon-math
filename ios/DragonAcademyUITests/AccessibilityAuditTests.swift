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
///
/// Also ignored, as false positives: contrast, Dynamic Type and clipping on
/// text that is only emoji or symbols (the 🐉 on the trial invitation, a
/// kid's avatar on the family picker, the lair's subject icons, ✎ among
/// them). These glyphs are pictures, not words: decorative, hidden from
/// VoiceOver, sized to fit their card or circle, and the words beside them
/// carry the meaning (and are checked). The audit still sees them as text
/// even when hidden: it samples a colour emoji's pixels against the paper as
/// if it had one ink colour, and wants it to grow with the text size. Real
/// text stays covered by `ThemeContrast.pairs` and this audit.
///
/// Contrast on text whose own pixels pass: the contrast check misjudges some
/// thin body text (the lair's pencil blurbs, 6.6:1 and up in ThemeContrast)
/// and the glass toolbar buttons (the parent area's sageInk "Cancel", 5.9:1),
/// so a flagged text or button gets a second opinion from its screenshot,
/// which must measure 4.5:1 between its ink and its background
/// (`measuresAsPassing`).
/// Faded text still fails it: the map's locked labels at 55% charcoal
/// measured about 3:1.
///
/// Contrast on disabled controls (the gate's "Continue" before an answer):
/// WCAG exempts inactive controls, and dimmed is how they say so.
///
/// "Dynamic Type partially unsupported" on the lair's subject cards: the
/// audit flags text on the right-hand cards (Spelling, Memorize) as the grid
/// reflows from two columns to one, but not the same text on the left-hand
/// cards, nor any of it when the grid is one column throughout; screenshots
/// at XXL and AX-XL text show every card's text growing.
///
/// Likewise on navigation bar buttons (the parent area's "Cancel"), which
/// the system caps and shows in the large content viewer instead; and on the
/// prize card's "NEW!" ribbon, which a screenshot at XXXL
/// text shows grown with the rest.
///
/// Deliberate too: "Text clipped" on the battle header's place name, which
/// keeps to one line beside the map button and the companion on a phone,
/// shrinking to 70% before it truncates at the larger sizes, as the rest of
/// the capped board does. VoiceOver reads it whole.
///
/// "Text clipped" ("may be clipped at larger Dynamic Type sizes") on the
/// result screen: the card scrolls, is drawn at its full height
/// (`.fixedSize`) and none of its text has a line limit, so nothing on it can
/// be cut off at any size. The audit still flags it in about one run in four,
/// a different line each time, sometimes with no element at all; it seems to
/// catch the card's animations (the gift's wiggle, the dragons popping in).
/// Screenshots at XXXL show every line whole.
///
/// And contrast on map text under the "Take the Dragon's Trial" banner, which
/// floats over the bottom of the map: the audit samples the banner's pixels as
/// the text's. Scrolled clear of it, the same labels are checked.
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
        XCTAssertTrue(any["trial.invitation"].waitForExistence(timeout: 10))
        try audit(app, "map")

        any["home.learningLair"].tap()
        XCTAssertTrue(any["lair.back"].waitForExistence(timeout: 10))
        // The trial card fades in once the Store's progress arrives, pushing
        // the subjects down: audit the settled screen.
        XCTAssertTrue(any["trial.invitation"].waitForExistence(timeout: 10))
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
        try audit(app, "battle", textCapped: true)

        try GuestBattleUITests.winBattle(in: app)
        XCTAssertTrue(any["result.title"].waitForExistence(timeout: 10))
        XCTAssertTrue(any["prize.card.0"].waitForExistence(timeout: 10))
        // The cards pop in one after another (scaling up from 60%); audited
        // mid-pop, their text reads as too small.
        let cards = any.matching(NSPredicate(format: "identifier BEGINSWITH 'prize.card.'"))
        XCTAssertTrue(waitUntilStill(cards.element(boundBy: cards.count - 1)))
        try audit(app, "prize reveal", card: "battle.result")
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
        FamilyPickerUITests.skipContactEmail(in: app)
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
    /// purpose and the false positives in the type's comment.
    /// `textCapped`: the screen's text stops growing at a set size on purpose,
    /// which the audit reports as "partially unsupported". `card`: a card
    /// over the screen; what isn't on it is the dimmed screen behind, audited
    /// on its own already.
    @MainActor
    private func audit(
        _ app: XCUIApplication, _ screen: String, textCapped: Bool = false, card: String? = nil
    ) throws {
        try XCTContext.runActivity(named: "Audit: \(screen)") { _ in
            try app.performAccessibilityAudit { issue in
                let partly = issue.compactDescription.contains("partially")
                if issue.auditType == .dynamicType && partly && textCapped { return true }
                if issue.auditType == .textClipped && card != nil { return true }
                guard let element = issue.element else { return false }
                // Read once: live text (the battle's scores) can change while
                // the audit runs, and a query for a replaced element fails.
                // Text that's gone by then can't be looked at, so isn't judged.
                guard let found = try? element.snapshot() else { return true }
                if let card, !Self.is(found, on: card, in: app) { return true }
                let id = found.identifier
                let picture = found.elementType == .staticText && Self.isPictograph(found.label)
                switch issue.auditType {
                case .dynamicType:
                    return picture || id.hasPrefix("map.") || id.hasPrefix("cell.") || id.hasPrefix("battle.")
                        || id.hasPrefix("score.") || (partly && id == "prize.new")
                        || (partly && Self.isInANavigationBar(found, in: app))
                        || (partly && Self.isOnALairSubjectCard(found, in: app))
                case .contrast:
                    return picture || !found.isEnabled || Self.isUnderTheTrialBanner(found, in: app)
                        || Self.measuresAsPassing(element, found, in: app)
                case .textClipped:
                    return picture || id == "battle.place"
                default:
                    return false
                }
            }
        }
    }

    /// Whether the element's screenshot has 4.5:1 between its background (the
    /// median pixel) and its ink (the pixel furthest from it in luminance).
    /// Only for text wholly on screen, which is what the screenshot shows.
    @MainActor
    private static func measuresAsPassing(
        _ element: XCUIElement, _ found: any XCUIElementSnapshot, in app: XCUIApplication
    ) -> Bool {
        guard [.staticText, .button].contains(found.elementType), !found.frame.isEmpty,
              app.windows.firstMatch.frame.contains(found.frame),
              let image = element.screenshot().image.cgImage,
              let luminances = relativeLuminances(image), !luminances.isEmpty
        else { return false }
        let sorted = luminances.sorted()
        let background = sorted[sorted.count / 2]
        let ink = background - sorted[0] > sorted[sorted.count - 1] - background
            ? sorted[0] : sorted[sorted.count - 1]
        let ratio = (max(ink, background) + 0.05) / (min(ink, background) + 0.05)
        return ratio >= 4.5
    }

    /// WCAG relative luminance of every pixel, in sRGB.
    private static func relativeLuminances(_ image: CGImage) -> [Double]? {
        let width = image.width, height = image.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                data: &bytes, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return nil }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        func linear(_ byte: UInt8) -> Double {
            let c = Double(byte) / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return stride(from: 0, to: bytes.count, by: 4).map { i in
            0.2126 * linear(bytes[i]) + 0.7152 * linear(bytes[i + 1]) + 0.0722 * linear(bytes[i + 2])
        }
    }

    /// Whether the element is text on one of the lair's subject cards.
    @MainActor
    private static func isOnALairSubjectCard(_ element: any XCUIElementSnapshot, in app: XCUIApplication) -> Bool {
        let cards = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'lair.subject.'"))
        return cards.allElementsBoundByIndex.contains { $0.frame.contains(element.frame) }
    }

    /// Waits for the element to stop moving: the same frame twice, half a
    /// second apart.
    @MainActor
    private func waitUntilStill(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let deadline = Date.now.addingTimeInterval(timeout)
        var last = element.frame
        while Date.now < deadline {
            Thread.sleep(forTimeInterval: 0.5)
            let now = element.frame
            if now == last { return true }
            last = now
        }
        return false
    }

    /// Whether the element is in a navigation bar.
    @MainActor
    private static func isInANavigationBar(_ element: any XCUIElementSnapshot, in app: XCUIApplication) -> Bool {
        app.navigationBars.allElementsBoundByIndex.contains { $0.frame.contains(element.frame) }
    }

    /// Whether the element is part of the card with this identifier.
    @MainActor
    private static func `is`(_ element: any XCUIElementSnapshot, on card: String, in app: XCUIApplication) -> Bool {
        app.descendants(matching: .any)[card].descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", element.label))
            .allElementsBoundByIndex.contains { $0.frame == element.frame }
    }

    /// Whether the element is map text drawn behind the trial banner.
    @MainActor
    private static func isUnderTheTrialBanner(_ element: any XCUIElementSnapshot, in app: XCUIApplication) -> Bool {
        guard element.identifier.hasPrefix("map.") else { return false }
        let banner = app.descendants(matching: .any)["trial.invitation"]
        return banner.exists && banner.frame.contains(element.frame)
    }

    /// "🐉", "⚔️", "✎": every character a picture, drawn as a colour emoji or
    /// a symbol glyph. Digits and "#" have the Unicode emoji property too, so
    /// it goes by emoji presentation (by default, or asked for with U+FE0F)
    /// and the "other symbol" category.
    static func isPictograph(_ text: String) -> Bool {
        !text.isEmpty && text.allSatisfy { character in
            character.unicodeScalars.contains {
                $0.properties.isEmojiPresentation || $0.value == 0xFE0F || $0.properties.generalCategory == .otherSymbol
            }
        }
    }
}
