// swift-tools-version: 6.0
import PackageDescription

// MetricKit crash and performance reports, queued on the device and uploaded to
// our own server (POST /api/diagnostics/metrickit). Apple-only crash reporting,
// no third-party SDK (ADR 0008).
let package = Package(
    name: "Diagnostics",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "Diagnostics", targets: ["Diagnostics"]),
    ],
    dependencies: [
        .package(path: "../API"),
        // Test-only, for a stub transport; the same exact versions API pins.
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.12.1"),
        .package(url: "https://github.com/apple/swift-http-types", exact: "1.8.0"),
        // Holds DequeModule below 1.7.0, as in API's Package.swift (Swift 6.4
        // builds of 1.7.0 need `swift_initBorrow`, missing on macOS 26).
        .package(url: "https://github.com/apple/swift-collections", exact: "1.6.0"),
    ],
    targets: [
        .target(name: "Diagnostics", dependencies: ["API"]),
        .testTarget(
            name: "DiagnosticsTests",
            dependencies: [
                "Diagnostics",
                "API",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "DequeModule", package: "swift-collections"),
            ],
            resources: [.copy("Fixtures")]
        ),
    ]
)
