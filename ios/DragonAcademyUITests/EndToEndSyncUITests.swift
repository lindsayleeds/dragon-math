import XCTest

/// End to end against a real local server (#128): a signed-in parent's
/// family device opens on the picker, the kid picks themselves, wins node 1,
/// and the win reaches the server and shows in the parent's stats API.
///
/// Needs the scratch server `npm run ios:e2e` starts; that script passes its
/// URL, the parent's session and the child's id in through the test runner's
/// environment (`TEST_RUNNER_DA_E2E_*`). Run any other way, it skips.
///
/// Sign in with Apple can't be driven from a test, so the parent's session
/// (made by the script with the server's email sign-up) goes in as
/// `-DAParentToken`, standing in for the one the Keychain would hold. Every
/// request after that is the app's own: the family list, the sync upload.
final class EndToEndSyncUITests: XCTestCase {
    private struct Server: Sendable {
        let baseURL: URL
        let parentToken: String
        let childID: Int
    }

    override func setUp() {
        continueAfterFailure = false
    }

    private func server() throws -> Server {
        let env = ProcessInfo.processInfo.environment
        guard let url = env["DA_E2E_API"].flatMap(URL.init(string:)),
              let token = env["DA_E2E_PARENT_TOKEN"], !token.isEmpty,
              let child = env["DA_E2E_CHILD_ID"].flatMap(Int.init)
        else { throw XCTSkip("No end-to-end server; run `npm run ios:e2e`.") }
        return Server(baseURL: url, parentToken: token, childID: child)
    }

    @MainActor
    func testKidWinsABattleAndTheWinReachesTheServer() async throws {
        let server = try server()
        // Nothing on the server yet.
        let before = try await Self.nodesWon(on: server)
        XCTAssertEqual(before, 0)

        let app = XCUIApplication()
        app.launchArguments = [
            "-DAAPIBaseURL", server.baseURL.absoluteString,
            "-DAParentToken", server.parentToken,
            "-DAResetStore", "YES",
            "-DABattleSeed", "117",
        ]
        app.launch()
        let any = app.descendants(matching: .any)

        // The family comes from the server: the kid's tile is on the picker.
        let tile = any["picker.kid.\(server.childID)"]
        XCTAssertTrue(tile.waitForExistence(timeout: 60), "the server's child never reached the picker")
        tile.tap()

        let node = any["map.node.1"]
        XCTAssertTrue(node.waitForExistence(timeout: 30))
        node.tap()
        try GuestBattleUITests.winBattle(in: app)

        let title = any["result.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertEqual(title.label, "Victory!")

        // The win syncs in the background; the parent's stats show it once
        // the upload lands.
        let deadline = Date.now.addingTimeInterval(60)
        var won = 0
        while Date.now < deadline {
            won = try await Self.nodesWon(on: server)
            if won >= 1 { break }
            try await Task.sleep(for: .seconds(1))
        }
        XCTAssertEqual(won, 1, "the win never reached the server")
    }

    /// `GET /api/parent/children/{id}/summary` with the parent's session:
    /// the parent's stats API, as the parent view reads it.
    private nonisolated static func nodesWon(on server: Server) async throws -> Int {
        var request = URLRequest(
            url: server.baseURL.appending(path: "api/parent/children/\(server.childID)/summary"))
        request.setValue("Bearer \(server.parentToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let summary = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let progress = try XCTUnwrap(summary?["progress"] as? [String: Any])
        return try XCTUnwrap(progress["nodes_won"] as? Int)
    }
}
