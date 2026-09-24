// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Audio",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "Audio", targets: ["Audio"]),
    ],
    dependencies: [],
    targets: [
        .target(name: "Audio", dependencies: []),
        .testTarget(name: "AudioTests", dependencies: ["Audio"]),
    ]
)
