# iOS code lives in this repo under `ios/`

The iOS app lives in `dragon-math/ios/`, not in a separate repo. One developer, working with AI, can then change a rule in JavaScript and Swift, the golden files, the OpenAPI spec and the server together in one PR, and agents can read the original code right next to the port. iOS CI only runs when files under `ios/` or the golden files change, to keep Mac runner costs down.

The Swift contract with the server is an OpenAPI spec generated from zod schemas on the iOS-used routes only. The Swift client is generated from it with `swift-openapi-generator`. The admin, teacher and school routes stay without schemas.
