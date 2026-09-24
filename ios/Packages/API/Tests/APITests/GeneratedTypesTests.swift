import Foundation
import Testing
import API

// Decoding real response shapes with the generated types. The JSON mirrors what
// the server sends (server/routes/auth.contract.test.js checks the same shapes
// against the zod contract on the other side).

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
}

@Test func decodesAChildUserResponse() throws {
    let response = try decode(Components.Schemas.UserResponse.self, """
    {"user": {
      "id": 7, "username": "ember", "account_type": "child", "current_node_id": 3,
      "avatar": "dragon-red", "font": "default", "dragon_trial_completed": true,
      "needs_handle": false, "effective_plan": "premium",
      "entitlements": {"games_locked": ["lava-leap"]}
    }}
    """)
    guard case .child(let child) = response.user else {
        Issue.record("expected a child user, got \(response.user)")
        return
    }
    #expect(child.id == 7)
    #expect(child.username == "ember")
    #expect(child.currentNodeId == 3)
    #expect(child.entitlements.gamesLocked == ["lava-leap"])
    #expect(child.familyMode == nil)
}

@Test func decodesAnAdultWithANullEmail() throws {
    let user = try decode(Components.Schemas.User.self, """
    {"id": 1, "username": "mum", "account_type": "parent", "email": null,
     "email_verified": false, "adult_role": "parent", "plan": "free"}
    """)
    guard case .parent(let adult) = user else {
        Issue.record("expected a parent, got \(user)")
        return
    }
    #expect(adult.email == nil)
    #expect(adult.plan == "free")
}

/// Response schemas are open (CLAUDE.md, API contract), so a field added on the
/// server must not break an app built against the older contract.
@Test func toleratesFieldsTheContractDoesNotKnow() throws {
    let response = try decode(Components.Schemas.AuthSession.self, """
    {"token": "t", "added_later": 1, "user": {
      "id": 1, "username": "mum", "account_type": "admin", "email": "a@b.c",
      "email_verified": true, "adult_role": "parent", "plan": "classroom",
      "also_new": {"nested": true}
    }}
    """)
    #expect(response.token == "t")
    guard case .admin = response.user else {
        Issue.record("expected an admin, got \(response.user)")
        return
    }
}

@Test func rejectsAnUnknownAccountType() {
    #expect(throws: DecodingError.self) {
        try decode(Components.Schemas.User.self, #"{"id": 1, "account_type": "dragon"}"#)
    }
}
