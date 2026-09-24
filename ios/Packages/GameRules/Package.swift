// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "GameRules",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "GameRules", targets: ["GameRules"]),
    ],
    dependencies: [],
    targets: [
        .target(name: "GameRules", dependencies: []),
        .testTarget(name: "GameRulesTests", dependencies: ["GameRules"]),
    ]
)
