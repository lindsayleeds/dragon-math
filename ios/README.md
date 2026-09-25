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
  StoreKit/                   StoreKit configuration for local purchase testing
  Packages/                   local Swift packages, one per module
    GameRules/                pure rules: no UI, no I/O, no imports at all
    Store/                    local persistence: profiles, event queue (GRDB)
    API/                      generated server client
    Sync/                     event-queue upload + content pull (uses Store, API)
    Audio/                    sound effects and spoken clips
    Diagnostics/              MetricKit reports: queued on the device, uploaded best effort

    TextNormalization/        Unicode normalization (NFKD) GameRules can't do
```

`GameRules` is kept pure by a test (`PurityTests`) that fails if any of its
source files imports anything. Its tests find the repo-root `golden/` JSON via
`RepoPaths` in `Tests/GameRulesTests`, so golden files are read in place, never
copied.

A rule that needs Unicode normalization can't compute it in GameRules (the
standard library has no public NFKD; Foundation does), so it takes the
decomposition as a `CompatibilityDecomposition` argument. `TextNormalization`
supplies Foundation's, plus overloads that pass it for you
(`Memorize.firstLetter(_:)`, `MemorizePractice(body:difficulty:rng:)`), and its
tests check the result against golden/memorize.json's `normalize` table. The
app calls those overloads; GameRules' own tests pass Foundation's NFKD directly.

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

`Diagnostics` is the app's crash reporting, and the only one: Apple's MetricKit,
no third-party SDK (ADR 0008). `MetricKitSubscriber` (started at launch) hands
each `MXMetricPayload`/`MXDiagnosticPayload`'s `jsonRepresentation()` to
`DiagnosticsUploader`, which writes it to a small on-disk queue
(`DiagnosticsQueue`, Application Support, excluded from backups; at most 20
reports, none older than 30 days) and uploads it to
`POST /api/diagnostics/metrickit` — on delivery and on every return to the
foreground, never blocking anything. A report leaves the queue once the server
accepts it (202) or refuses it for good (400/413); 429, 5xx and no network leave
it for next time. The upload's client has no token provider, so a report never
carries a session: the privacy label declares diagnostics not linked
(docs/IOS_PRIVACY_LABEL.md). Tests feed the subscriber fixture JSON
(`Tests/DiagnosticsTests/Fixtures/`, which the server's contract test posts
too), since MetricKit's payload types can't be built outside MetricKit.

`DragonAcademy/PrivacyInfo.xcprivacy` is the privacy manifest.
`PrivacyManifestTests` fails if it disagrees with the label table in
docs/IOS_PRIVACY_LABEL.md, or if the app's or a package's Swift calls a
required-reason API (UserDefaults, file timestamps, boot time, disk space,
active keyboards) the manifest has no reason for — so a new `UserDefaults` or
`attributesOfItem` call needs a manifest entry in the same change.

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

## Premium (StoreKit 2)

The parent view's **Premium** row opens `PremiumView` (`DragonAcademy/Premium/`),
so buying is always behind the parental gate and device check (ADR 0008).
`PremiumModel` drives it through two protocols in `PremiumDependencies`:

- `PremiumStore`: StoreKit 2. `StoreKitPremiumStore` loads the products in
  `PremiumProducts`, buys with `.appAccountToken(uuid)`, finishes verified
  transactions, restores with `AppStore.sync()` and reads
  `Transaction.currentEntitlements`. The app creates it at launch and calls
  `start()`, which listens to `Transaction.updates` for the whole run (Ask to
  Buy approvals, renewals, refunds, purchases on other devices).
- `PlanStatusService`: `GET /api/plan/status`, for the plan and the parent's
  `app_account_token`. With no token the app refuses to buy, since the server
  couldn't credit the purchase to anyone.

Premium shows as unlocked if the server says so **or** StoreKit has a current
entitlement. The server only learns of a purchase from Apple's App Store
Server Notification (docs/APP_STORE.md), so after a purchase or restore the
model asks it again a few times (`serverRetryDelays`).

**Premium on the kid screens** is `PremiumAccess` (`\.premiumAccess`), with the
same rule per kid: that kid's server plan
(`GET /api/plan/status?child_id=`, so classroom kids are premium through their
teacher) **or** the device's StoreKit entitlement. Each kid's last plan is
cached in `UserDefaults` (`PlanStatusCache`) with its read time and trusted for
`PremiumAccess.offlineGrace` (7 days) with no newer read; past that only the
local entitlement unlocks. It is re-read after each sync run
(`SyncEngine.reports()`), when the parent area closes, and on StoreKit
transaction updates; the cache is dropped when the parent signs out. The guest
has only the local entitlement. Premium-only Lair games show a lock for free
kids, and tapping one opens an "Ask a grown-up" sheet whose button opens the
parent area through `\.openParentAccess`. The debug launch argument
`-DAPremium YES` unlocks everything, for UI tests and screenshots.

**Product ids are placeholders** (`dev.placeholder.dragonacademy.premium.monthly`
and `.yearly`). Once the paid developer account exists, a human creates both
auto-renewable subscriptions in one subscription group in App Store Connect,
then puts the real ids in `PremiumProducts.swift`,
[StoreKit/DragonAcademy.storekit](StoreKit/DragonAcademy.storekit) and the
server's `APPSTORE_PREMIUM_PRODUCT_IDS`, all three together.

**Local testing.** The scheme's Run action uses
`StoreKit/DragonAcademy.storekit` (`storeKitConfiguration` in project.yml), so
running from Xcode sells the two products from that file, with no App Store
account; Xcode's Debug → StoreKit → Manage Transactions shows and edits them.
Those purchases are signed by Xcode, so no notification reaches the server;
with `-ParentAccessFakes YES` the plan status is faked and StoreKit is real.
`StoreKitPremiumStoreTests` runs the real store against the same file with
`SKTestSession` (purchase, restore, Ask to Buy, expiry, refund);
`PremiumModelTests` covers the model with a scripted store.

**Practice reminders** (`DragonAcademy/Reminders/`). Parents set weekly local
notifications — some weekdays at one time, for the whole family or one child
profile — from the parent view. They're device settings, not play history, so
they live as JSON in `UserDefaults` (`PracticeReminderStorage`) rather than the
Store. Each enabled reminder is one repeating `UNCalendarNotificationTrigger`
per weekday, with ids `practice-reminder.<uuid>.<weekday>`.
`PracticeRemindersModel` asks for notification permission only when a
reminder is saved or switched on, never on launch or on opening the screen; if
it's denied the reminder is kept, nothing is scheduled, and the screen links to
the app's notification settings. `refresh()` (on appear and on returning to the
foreground) replaces every pending `practice-reminder.` request with the
enabled reminders'. `UNUserNotificationCenter` sits behind
`NotificationScheduler` (`SystemNotificationScheduler`); tests use a fake.
## Who's playing (family picker)

`CurrentPlayer` (`DragonAcademy/Player/`) is the app state for who is
playing. Kid screens (map, battle, proving grounds, …) read the profile from
`@Environment(\.currentProfile)` and record events and read progress for it;
never use `store.guestProfile` directly.
- **No parent signed in:** guest mode, the guest profile plays.
- **Parent signed in:** the kid screens start at `FamilyPickerView`. A kid taps
  their avatar to play as themselves; on the map, the kid's own avatar/name button ("Switch player") goes back to the picker.
  Switching is local: no parental gate, and it never changes `SessionTokens`.
- **Uploads on a family iPad use the parent's session** for every kid's queue.
  `SessionTokens.syncSession()` reads the token's claims and tells `SyncEngine`
  whose session it is (`SyncSession.parent` / `.child(id)` / `.none`); a kid's
  own session only ever sends that kid's queue, so a sibling's events wait
  instead of being dropped by the server as `not_your_child`.
- **Privacy:** the Store keeps only kid-facing fields for a child (handle as
  `displayName`, `avatar`). The name a parent entered (`real_name`) is held in
  memory by `FamilyModel` and shown only in the parent view.

### Kid sign-in by link or QR code (#132)

`KidSignInModel` (`DragonAcademy/KidSignIn/`) handles a kid's login link
`/k/<token>` and a family-device link `/family/<token>`, whether tapped
elsewhere (universal links, `onOpenURL` / `onContinueUserActivity` on
`RootView`) or scanned with "I have a login code" (family picker, guest map,
kid landing). `KidLink` parses both.
- **No parent signed in:** `POST /api/auth/child-login` (or, for a family
  link, `GET /api/auth/family/<token>` then `family-login`) gives the kid's own
  session. It goes in the Keychain (`KeychainKidSessionStore`, one kid at a
  time) and `SessionTokens`, and `CurrentPlayer` enters `.kid` mode. The next
  kid's code replaces it; earlier kids' events stay queued until their own
  session is back. Tapping the avatar on the map opens `KidLandingView`
  (carry on, someone else, or back to guest).
- **Parent signed in:** the kid's token is thrown away (the parent's uploads
  for the family). A kid in the family is picked; anyone else is refused,
  and gets no Store profile.
- **Sync's client uses `SessionTokens.syncProvider`**, which hands out the
  token only while it is still the session Sync last checked, so a token
  swapped mid-upload gets a 401 instead of sending one kid's events as another.
- The scanner is `CodeScanner` (`CameraCodeScanner`: `AVCaptureMetadataOutput`;
  `FakeCodeScanner` for tests), via `@Environment(\.makeCodeScanner)`.
- Universal links need `APPLE_TEAM_ID` on the server and the Associated
  Domains capability on the App ID (docs/APPLE_SIGN_IN.md, "Universal links").

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
