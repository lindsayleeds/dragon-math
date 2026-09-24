import Foundation

/// Locations in the dragon-math checkout, found by walking up from this file.
/// GameRules tests read the golden JSON the JavaScript rules write to the
/// repo-root `golden/` directory (ADR 0005) in place, never from a copy.
enum RepoPaths {
    /// ios/Packages/GameRules/Tests/GameRulesTests/RepoPaths.swift → repo root.
    static let root: URL = {
        var url = URL(filePath: #filePath)
        for _ in 0..<6 { url.deleteLastPathComponent() }
        return url
    }()

    static let golden = root.appending(path: "golden", directoryHint: .isDirectory)

    /// The package's own `Sources/GameRules` directory.
    static let gameRulesSources = root.appending(path: "ios/Packages/GameRules/Sources/GameRules")

    /// Decoded contents of `golden/<name>.json`.
    static func goldenData(_ name: String) throws -> Data {
        try Data(contentsOf: golden.appending(path: "\(name).json"))
    }
}
