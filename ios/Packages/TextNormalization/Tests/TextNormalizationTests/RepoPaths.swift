import Foundation

/// The dragon-math checkout, found by walking up from this file, so the tests
/// read golden/ in place (ADR 0005).
enum RepoPaths {
    /// ios/Packages/TextNormalization/Tests/TextNormalizationTests/RepoPaths.swift → repo root.
    static let root: URL = {
        var url = URL(filePath: #filePath)
        for _ in 0..<6 { url.deleteLastPathComponent() }
        return url
    }()

    static func goldenData(_ name: String) throws -> Data {
        try Data(contentsOf: root.appending(path: "golden/\(name).json"))
    }
}
