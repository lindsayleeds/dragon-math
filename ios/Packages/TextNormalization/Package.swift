// swift-tools-version: 6.0
import PackageDescription

// The Unicode normalization GameRules can't do itself: GameRules imports
// nothing, not even Foundation, and NFKD needs Foundation. This thin layer
// supplies it (see Sources/TextNormalization/TextNormalization.swift).
let package = Package(
    name: "TextNormalization",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "TextNormalization", targets: ["TextNormalization"]),
    ],
    dependencies: [
        .package(path: "../GameRules"),
    ],
    targets: [
        .target(name: "TextNormalization", dependencies: ["GameRules"]),
        .testTarget(name: "TextNormalizationTests", dependencies: ["TextNormalization", "GameRules"]),
    ]
)
