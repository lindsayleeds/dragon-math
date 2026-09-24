# Dragon Academy — iOS

Native SwiftUI app for iPhone and iPad. The plan and decisions are in
[docs/IOS_PLAN.md](../docs/IOS_PLAN.md) and [docs/adr/](../docs/adr/).

- Minimum iOS/iPadOS 18.0. iPhone is portrait only; iPad supports every
  orientation plus Split View, Slide Over and Stage Manager.
- Bundle ID `dev.placeholder.dragonacademy` until the real name is decided.
- English only, every user-facing string in
  [Localizable.xcstrings](DragonAcademy/Localizable.xcstrings).
- One third-party dependency: [GRDB](https://github.com/groue/GRDB.swift)
  (SQLite) in `Store`, pinned to an exact version in `Packages/Store/Package.swift`.

## Layout

```
ios/
  project.yml                 XcodeGen spec — the source of truth for the project
  DragonAcademy.xcodeproj/    generated from project.yml, committed
  DragonAcademy.xctestplan    test plan: which test targets the scheme runs
  DragonAcademy/              app target: features, assets, string catalog
  DragonAcademyTests/         app unit tests
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

## Build and run

Needs Xcode (with an iOS simulator runtime). Open `DragonAcademy.xcodeproj` and
run the `DragonAcademy` scheme, or from the command line:

```sh
cd ios
xcodebuild -scheme DragonAcademy \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath build/DerivedData build

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
  -derivedDataPath build/DerivedData test
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
