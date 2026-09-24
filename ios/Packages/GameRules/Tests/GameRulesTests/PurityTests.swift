import Foundation
import Testing

/// GameRules must stay pure Swift: no UI, no I/O, no platform frameworks
/// (docs/IOS_PLAN.md, ADR 0005). This fails the moment a source file imports
/// anything, so a stray `import Foundation` or `import SwiftUI` can't slip in.
@Test func sourcesImportNothing() throws {
    let sources = RepoPaths.gameRulesSources
    let files = try #require(FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil))
        .compactMap { $0 as? URL }
        .filter { $0.pathExtension == "swift" }
    #expect(!files.isEmpty)
    for file in files {
        let imports = try String(contentsOf: file, encoding: .utf8)
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.hasPrefix("import ") || ($0.hasPrefix("@") && $0.contains(" import ")) }
        #expect(imports.isEmpty, "\(file.lastPathComponent) imports \(imports)")
    }
}
