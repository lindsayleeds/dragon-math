# Dragon Academy — iOS

Native SwiftUI app for iPhone and iPad. The plan and decisions are in
[docs/IOS_PLAN.md](../docs/IOS_PLAN.md) and [docs/adr/](../docs/adr/).

- Minimum iOS/iPadOS 18.0. iPhone is portrait only; iPad supports every
  orientation plus Split View, Slide Over and Stage Manager.
- Bundle ID `dev.placeholder.dragonacademy` until the real name is decided.
- English only, every user-facing string in
  [Localizable.xcstrings](DragonAcademy/Localizable.xcstrings).
- Third-party dependencies, each pinned to an exact version in its package's
  `Package.swift`: [GRDB](https://github.com/groue/GRDB.swift) (SQLite) in
  `Store`; Apple's swift-openapi-generator, -runtime and -urlsession (plus what
  they pull in) in `API`.

## Layout

```
ios/
  project.yml                 XcodeGen spec — the source of truth for the project
  DragonAcademy.xcodeproj/    generated from project.yml, committed
  DragonAcademy.xctestplan    test plan: which test targets the scheme runs
  DragonAcademy/              app target: features, assets, string catalog
  DragonAcademyTests/         app unit tests
  DragonAcademyUITests/       XCUITests (the guest battle end to end)
  Packages/                   local Swift packages, one per module
    GameRules/                pure rules: no UI, no I/O, no imports at all
    Store/                    local persistence: profiles, event queue (GRDB)
    API/                      generated server client
    Sync/                     event-queue upload + content pull (uses Store, API)
    Audio/                    sound effects and spoken clips
```

`GameRules` is kept pure by a test (`PurityTests`) that fails if any of its
source files imports anything. Its tests find the repo-root `golden/` JSON via
`RepoPaths` in `Tests/GameRulesTests`, so golden files are read in place, never
copied.

`Store` is the only module that imports GRDB. Callers use the `Store` protocol
(`SQLiteStore` implements it): `record(_:for:)` appends an event — a `Codable`
payload with a string `EventKind`, so adding an event kind needs no migration —
and progress such as nodes won is derived from events, never stored
separately. `observeProgress(for:)` is an `AsyncThrowingStream` for SwiftUI.
Schema changes are new migrations appended in `Schema.swift`; never edit a
shipped one. Tests use `SQLiteStore.inMemory()`; the app opens
`SQLiteStore.applicationDefault()` (Application Support) at launch and puts it
in the environment as `\.store`.

`Sync`'s `SyncEngine` (an actor, in the environment as `\.sync`) uploads the
queue to `POST /api/sync/events`. The UI calls `sync.requestSync()`, which
returns at once — at the end of a battle, say; the app also asks on every
return to the foreground, and the engine asks itself when the network comes
back (`NWPathReachability`). Only child profiles with a server id upload, and
only while there's a session token; the guest's events stay on the device.
An event is marked uploaded only when the server acknowledges it (`failed`
ones stay pending and are retried with exponential backoff and jitter), and
one sync runs at a time. Which Store kinds upload, and as which server kind
and payload, is the table in `SyncKinds.swift`: a new kind is one
`.map(Payload.self, to: "server_kind") { … }` line, and a kind not in it
stays pending until it is. Tests use an in-memory store and a fake server
behind a stub `ClientTransport`, with injected sleep and jitter.

After a profile's queue is empty, Sync pulls `GET /api/sync/progress` — what
the server has for that child from all of their devices — and saves it with
`saveServerProgress(_:for:covering:)`, so a win on the child's iPad shows up on
their iPhone. Derived progress is local events merged with that: wins and
stars by union and best, the frontier by max. Counts that add up (dragons) are
the server's total plus only the local events it doesn't include yet — the
`covering` list is the uploaded events noted *before* the fetch, which the
server had acknowledged, so an event is never counted from both. A new
additive kind must follow the same rule (`inServerProgress` in
`SQLiteStore.fetchProgress`). `TwoDeviceTests` plays one child on two devices
offline, then online in several orders, against one fake server.

## API client

`API` builds a Swift client from the checked-in
[server/openapi.json](../server/openapi.json) (written by `npm run openapi` from
the zod contracts; see CLAUDE.md "API contract (iOS)"). The
swift-openapi-generator build plugin runs on every build and generates
`Client`, `Operations` and `Components` into the build folder; nothing
generated is committed. Other code talks to the server through
`DragonAPIClient`:

```swift
let client = DragonAPIClient(baseURL: serverURL) { try await keychain.token() }
let me = try await client.api.getCurrentUser()
if case .child(let child) = try me.ok.body.json.user { … }
```

The token provider runs on every request and a nil token sends no
`Authorization` header. `api` is `any APIProtocol`, so tests can stub it (or pass
a stub `transport:`). Generated names follow the contract: a component `id` is
a type under `Components.Schemas`, an `operationId` is a method, and fields are
camel-cased (`namingStrategy: idiomatic` in `openapi-generator-config.yaml`).

**Why a symlink.** The generator only reads a document inside the target's
sources, so `Packages/API/Sources/API/openapi.json` is a symlink to
`../../../../../server/openapi.json` rather than a copy. With a symlink there is
nothing to keep in sync: a changed contract is what the next build generates
from, in SwiftPM and in Xcode alike (both follow it, and both regenerate when
the target file changes), so a removed or renamed field is a compile error at
every Swift call site that uses it. A synced copy plus a staleness test would
only fail in the test run, and a stale copy would still build green.
`ContractSourceTests` fails if the symlink is replaced with a regular file or
repointed. (Windows checkouts without symlink support can't build the iOS app
anyway.)

**Verified by hand** (not automatable, since the test would have to not
compile): rename `current_node_id` to `current_node` in the `ChildUser` schema
of `server/openapi.json`, run `swift build --build-tests` in `Packages/API` (or
the `xcodebuild … build test` below) and see
`value of type 'Components.Schemas.ChildUser' has no member 'currentNodeId'`
from `GeneratedTypesTests.swift`; then `git checkout server/openapi.json`. The
break lands wherever a changed field or operation is used, so `APITests`
decoding the shapes the app relies on is what makes the `test` action catch
drift before any feature code uses them.

**Plugin trust.** Xcode asks to trust build plugins once: the first time you
open the project it shows "OpenAPIGenerator must be enabled" — click it and
choose Trust & Enable. On the command line, pass
`-skipPackagePluginValidation` to `xcodebuild` (as below). `swift build`/`swift
test` need nothing extra.

`swift-collections` is pinned to 1.6.0 in `Package.swift` though nothing
imports it directly: 1.7.0 built with Swift 6.4 references
`swift_initBorrow`, missing from the macOS 26 runtime, so `swift test` crashes
loading the test bundle. Drop the pin once that is fixed.

## Guest battle

A new install plays as the Store's guest profile. `RootView` is a
`NavigationStack` over typed `Route`s: the map (`Map/MapScreen.swift`, a
placeholder with node 1 until #134) pushes `.battle(nodeID:)`.
`BattleModel` (`Battle/`) is `@Observable` and drives GameRules'
`BattleSession` with the node's `BattleConfig.defaultConfig(forNode:)` and one
cancellable sleep until `nextTimerAt`, re-armed after every event. Time and
sleeping come in as a `BattleClock` (tests pass one they move by hand), and
randomness as a `RandomSource` (`SystemRandomSource` in live play). A win
records `NodeWon` (with the web's stars) for the guest and calls
`sync.requestSync()`, which sends nothing for a guest; the map reads
`observeProgress`. Nothing on this path touches the network.

Colors and type go through `Theme.swift` (`Palette`, `Typeface`). Clean &
Clear (Comic Neue) isn't bundled yet (#166), so `Typeface` uses Chalkboard SE
for now. The battle wallpapers in `Assets.xcassets/Battle` are copies of
`ArtExports/Battle`; `iosArtExport.test.js` fails if they drift, so copy the
folder again after `npm run ios:export-art`.

Debug-only launch arguments for UI tests: `-DABattleSeed <UInt64>` deals
every battle from `SeededRandom(seed)`, and `-DAResetStore YES` deletes the
on-disk store before it opens.

## Parent access

The **Grown-ups** button on the map opens `ParentAccessView`
(`DragonAcademy/ParentAccess/`). `ParentAccessModel` walks three steps, and the
first two run on every entry, signed in or not (ADR 0007):

1. **Parental gate** (`ParentalGate`): a teen number times a single digit,
   written out in words ("What is thirteen times seven?"), answered by typing
   the product. Three wrong answers in a row close the flow.
2. **Device owner check** (`LocalDeviceAuthenticator`):
   `LAPolicy.deviceOwnerAuthentication`, so Face ID or Touch ID with the passcode
   as fallback. A device with no passcode can't open the parent area.
3. **Sign in with Apple**, skipped when a session is stored. `Nonce.random()`
   makes the raw nonce, the Apple request carries `Nonce.sha256Hex(raw)`, and
   the raw nonce plus identity token go to `POST /api/auth/apple`
   (`APIParentSignInService`). The returned JWT is saved by
   `KeychainParentSessionStore`, so parents stay signed in across launches until
   it expires (30 days) or they sign out.

Every outside dependency sits behind a protocol in `ParentAccessDependencies`
(`DeviceAuthenticator`, `AppleCredentialProvider`, `ParentSignInService`,
`ParentSessionStore`), with fakes for tests and previews. Real Apple sign-in
needs a paid team with the Sign in with Apple capability (#171); until then,
launch a Debug build with `-ParentAccessFakes YES` to walk the whole flow in a
simulator:

```sh
xcrun simctl launch booted dev.placeholder.dragonacademy -ParentAccessFakes YES
```

**Server URL.** The `DRAGON_API_BASE_URL` build setting (project.yml, per
configuration) becomes the `DragonAPIBaseURL` Info.plist key, read by
`AppConfiguration.apiBaseURL`. Debug uses `http://localhost:3001`, the local
`npm run server`, which the simulator reaches on the Mac; Release uses
production. ATS allows plain HTTP only to local hosts
(`NSAllowsLocalNetworking`). The server needs `APPLE_CLIENT_IDS` to include
the app's bundle id.

**Session.** The JWT lives in the Keychain; at launch the app seeds the shared
`SessionTokens` (read by `DragonAPIClient` and `SyncEngine`) from it, and
sign-in/sign-out update both through `ParentAccessDependencies.sessionChanged`,
so Sync starts uploading as soon as a parent signs in.

## Build and run

Needs Xcode (with an iOS simulator runtime). Open `DragonAcademy.xcodeproj` and
run the `DragonAcademy` scheme, or from the command line:

```sh
cd ios
xcodebuild -scheme DragonAcademy \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath build/DerivedData -skipPackagePluginValidation build

# install and launch on a booted simulator
xcrun simctl install booted build/DerivedData/Build/Products/Debug-iphonesimulator/DragonAcademy.app
xcrun simctl launch booted dev.placeholder.dragonacademy
```

Swap the destination for any simulator you have, e.g.
`name=iPad Pro 11-inch (M5)`; `xcrun simctl list devices available` lists them.

## Test

App tests plus every package's tests, on a simulator. What runs is set by the
`DragonAcademy` test plan ([DragonAcademy.xctestplan](DragonAcademy.xctestplan)),
the scheme's default plan:

```sh
cd ios
xcodebuild -scheme DragonAcademy \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath build/DerivedData -skipPackagePluginValidation test
```

A new test target (e.g. a new package's tests) goes in both the scheme's `test`
targets in `project.yml` and the test plan's `testTargets`; package targets use
`"containerPath": "container:Packages/<Name>"` with the target name as
`identifier`.

### Both supported OS versions

The app supports iOS 18.0 and up, so tests run on the oldest supported OS
(iOS 18) and the current one (iOS 27.0). `xcodebuild` takes several
`-destination` flags and runs the plan on each:

```sh
cd ios
xcodebuild -scheme DragonAcademy -testPlan DragonAcademy \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro (iOS 18),OS=18.6' \
  -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M4) (iOS 18),OS=18.6' \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' \
  -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M5),OS=27.0' \
  -derivedDataPath build/DerivedData test
```

Add `-parallel-testing-enabled NO` or `-disable-concurrent-destination-testing`
if the Mac struggles with four simulators at once. Use `OS=27.0`, not 27.1: the
27.1 beta runtime only offers the iPhone Duo.

#### Installing the iOS 18 simulator runtime

Xcode 27 ships with the iOS 27 runtime only. Download the iOS 18 one (about
8 GB) once:

```sh
xcodebuild -downloadPlatform iOS -buildVersion 18.6
xcrun simctl runtime list          # should now show iOS 18.6 ... (Ready)
```

If that fails (with the Xcode 27.1 beta it currently prints
`Unable to connect to simulator.` for every 18.x version), use either:

- Xcode > Settings > Components > Other Installed Platforms > **+** >
  iOS 18.6 Simulator, or
- download "iOS 18.6 Simulator Runtime" from
  <https://developer.apple.com/download/all/> (needs an Apple Developer
  sign-in), then `xcrun simctl runtime add ~/Downloads/iOS_18.6_Simulator_Runtime.dmg`.

Then create the iOS 18 simulators the command above uses:

```sh
xcrun simctl create 'iPhone 16 Pro (iOS 18)' \
  com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro \
  com.apple.CoreSimulator.SimRuntime.iOS-18-6
xcrun simctl create 'iPad Pro 11-inch (M4) (iOS 18)' \
  com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-M4-8GB \
  com.apple.CoreSimulator.SimRuntime.iOS-18-6
```

Any 18.x works; swap `18.6`/`iOS-18-6` in both places for the version you
installed.

One package on the Mac, no simulator (faster while working on a package):

```sh
cd ios/Packages/GameRules && swift test
# or all of them
for p in ios/Packages/*/; do (cd "$p" && swift test) || break; done
```

Tests use Swift Testing (`import Testing`, `@Test`, `#expect`).

## Changing the project

Don't edit `DragonAcademy.xcodeproj` by hand or through Xcode's target
settings — the next regeneration would drop the change. Edit `project.yml`, then:

```sh
brew install xcodegen   # once
cd ios && xcodegen generate
```

and commit `project.yml` together with the regenerated `.xcodeproj`. Adding a
file under an existing source folder needs a regeneration too, since the
project lists files explicitly. A new local package goes in `Packages/`, under
`packages:` in `project.yml`, in the app target's `dependencies`, in the
scheme's `test` targets, and in `DragonAcademy.xctestplan`.
