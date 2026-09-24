import Foundation
import Testing

/// The generator must read the checked-in server/openapi.json itself, not a
/// copy that could go stale — otherwise a contract change would stop breaking
/// the iOS build. Sources/API/openapi.json is a symlink to it.
@Test func generatorInputIsTheServerContract() throws {
    var packageRoot = URL(filePath: #filePath)
    for _ in 0..<3 { packageRoot.deleteLastPathComponent() }  // Tests/APITests/<file>
    let input = packageRoot.appending(path: "Sources/API/openapi.json")
    let repoContract = packageRoot.appending(path: "../../../server/openapi.json").standardizedFileURL

    let destination = try FileManager.default.destinationOfSymbolicLink(atPath: input.path)
    #expect(destination == "../../../../../server/openapi.json")
    #expect(input.resolvingSymlinksInPath() == repoContract.resolvingSymlinksInPath())
}
