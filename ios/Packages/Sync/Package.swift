// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Sync",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "Sync", targets: ["Sync"]),
    ],
    dependencies: [
        .package(path: "../Store"),
        .package(path: "../API"),
    ],
    targets: [
        .target(name: "Sync", dependencies: ["Store", "API"]),
        .testTarget(name: "SyncTests", dependencies: ["Sync"]),
    ]
)
