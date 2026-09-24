// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Store",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "Store", targets: ["Store"]),
    ],
    dependencies: [
        // Pinned to an exact release; bump deliberately (ADR 0003).
        .package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.11.1"),
    ],
    targets: [
        .target(name: "Store", dependencies: [.product(name: "GRDB", package: "GRDB.swift")]),
        .testTarget(name: "StoreTests", dependencies: ["Store"]),
    ]
)
