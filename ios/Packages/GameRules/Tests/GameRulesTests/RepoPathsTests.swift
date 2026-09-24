import Foundation
import Testing

@Test func goldenDirectoryIsReachable() throws {
    let data = try RepoPaths.goldenData("prng")
    let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(object["fixture"] as? String == "prng")
}
