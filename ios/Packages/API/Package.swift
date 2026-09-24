// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "API",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "API", targets: ["API"]),
    ],
    dependencies: [],
    targets: [
        .target(name: "API", dependencies: []),
        .testTarget(name: "APITests", dependencies: ["API"]),
    ]
)
