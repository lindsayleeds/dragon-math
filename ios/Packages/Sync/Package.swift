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
        // HTTPBody for spelling clips and dragon art downloads, and a stub
        // transport in the tests; the same exact versions API pins.
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.12.1"),
        .package(url: "https://github.com/apple/swift-http-types", exact: "1.8.0"),
        // Holds DequeModule below 1.7.0, as in API's Package.swift (Swift 6.4
        // builds of 1.7.0 need `swift_initBorrow`, missing on macOS 26). A pin
        // in a dependency that no target uses doesn't reach this package.
        .package(url: "https://github.com/apple/swift-collections", exact: "1.6.0"),
    ],
    targets: [
        .target(
            name: "Sync",
            dependencies: [
                "Store",
                "API",
                // HTTPBody, to collect a spelling clip's or dragon art's bytes.
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ]
        ),
        .testTarget(
            name: "SyncTests",
            dependencies: [
                "Sync",
                "Store",
                "API",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "DequeModule", package: "swift-collections"),
            ]
        ),
    ]
)
