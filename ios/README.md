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

App tests plus every package's tests, on a simulator:

```sh
cd ios
xcodebuild -scheme DragonAcademy \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath build/DerivedData test
```

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
`packages:` in `project.yml`, in the app target's `dependencies`, and in the
scheme's `test` targets.
