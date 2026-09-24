// swift-tools-version: 6.0
import PackageDescription

// The server client is generated at build time from the repo's
// server/openapi.json (symlinked into Sources/API) by swift-openapi-generator's
// build plugin, so a contract change that breaks a call site breaks the build.
// Versions are pinned exactly; bump them deliberately, together.
let package = Package(
    name: "API",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "API", targets: ["API"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.13.1"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.12.1"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", exact: "1.3.1"),
        // HTTPRequest/HTTPResponse in middleware signatures; already a runtime dependency.
        .package(url: "https://github.com/apple/swift-http-types", exact: "1.8.0"),
        // Only here to hold swift-openapi-urlsession's DequeModule below 1.7.0:
        // built by Swift 6.4, 1.7.0 strong-links `swift_initBorrow`, which the
        // macOS 26 runtime lacks, so `swift test` crashes loading the bundle.
        .package(url: "https://github.com/apple/swift-collections", exact: "1.6.0"),
    ],
    targets: [
        .target(
            name: "API",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator"),
            ]
        ),
        .testTarget(
            name: "APITests",
            dependencies: [
                "API",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ]
        ),
    ]
)
