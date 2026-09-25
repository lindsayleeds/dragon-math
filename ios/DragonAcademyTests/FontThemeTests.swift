import Foundation
import Store
import Testing
import UIKit
@testable import DragonAcademy

/// The themes generated from src/data/fontThemes.js (the JavaScript side's
/// staleness test keeps FontThemeCatalog.swift current) and how each draws.
struct FontThemeTests {
    @Test func theThemesAreTheWebsInPickerOrder() {
        #expect(FontTheme.all.map(\.id) == ["handwritten", "bubbly", "storybook", "clean"])
        #expect(FontTheme.all.map(\.label) == ["Handwritten ✍️", "Bold & Bubbly 🫧", "Storybook 📖", "Clean & Clear 🔤"])
        let families = FontTheme.all.map { [$0.display.name, $0.body.name] }
        #expect(families == [
            ["Caveat", "Patrick Hand"], ["Fredoka", "Nunito"], ["Baloo 2", "Quicksand"], ["Comic Neue", "Comic Neue"],
        ])
    }

    @Test func cleanAndClearIsTheDefaultForAnythingElse() {
        #expect(FontTheme.defaultID == "clean")
        #expect(FontTheme.default.id == "clean")
        #expect(FontTheme.named(nil).id == "clean")
        #expect(FontTheme.named("papyrus").id == "clean")
        #expect(FontTheme.named("storybook").id == "storybook")
    }

    @Test func everyThemesFamiliesAreKnown() {
        let used = Set(FontTheme.all.flatMap { [$0.display, $0.body] })
        #expect(used == Set(FontFamily.all))
        #expect(FontFamily.all.count == 7)
    }

    @Test func displayIsBoldAndBodyRegularWithStandInsWhileUnbundled() {
        let storybook = FontTheme.named("storybook")
        let heading = Typeface.display(22)
        let copy = Typeface.body(fixedSize: 14)
        #expect(heading.postScriptName(in: storybook, isAvailable: { _ in true }) == "Baloo2-Bold")
        #expect(copy.postScriptName(in: storybook, isAvailable: { _ in true }) == "Quicksand-Regular")
        #expect(heading.postScriptName(in: storybook, isAvailable: { _ in false }) == "ArialRoundedMTBold")
        #expect(copy.postScriptName(in: storybook, isAvailable: { _ in false }) == "Avenir-Book")
        #expect(Typeface.display(fixedSize: 14).sizing == .fixed)
        #expect(Typeface.body(18, relativeTo: .caption).sizing == .relative(.caption))
    }
}

/// The bundled fonts: every family's files are registered under UIAppFonts,
/// and each bundled family's PostScript names resolve. A family whose files
/// aren't in the bundle yet (Fonts/README.md) is skipped, and its built-in
/// stand-ins must resolve instead.
struct FontRegistrationTests {
    static func isBundled(_ family: FontFamily) -> Bool {
        family.files.allSatisfy { Bundle.main.url(forResource: $0, withExtension: nil) != nil }
    }

    @Test func everyFileIsListedInUIAppFonts() throws {
        let listed = try #require(Bundle.main.object(forInfoDictionaryKey: "UIAppFonts") as? [String])
        #expect(Set(listed) == Set(FontFamily.all.flatMap(\.files)))
    }

    @Test(arguments: FontFamily.all.filter(isBundled))
    func aBundledFamilysNamesResolve(_ family: FontFamily) {
        for name in [family.regular, family.bold] {
            #expect(UIFont(name: name, size: 12) != nil, "\(family.name): \(name)")
            #expect(FontFamily.isRegistered(name))
        }
        #expect(family.resolvedName(.bold) == family.bold)
    }

    @Test(arguments: FontFamily.all)
    func theStandInsShipWithIOS(_ family: FontFamily) {
        for name in [family.fallbackRegular, family.fallbackBold] {
            #expect(UIFont(name: name, size: 12) != nil, "\(family.name): \(name)")
        }
        if !Self.isBundled(family) {
            #expect(family.resolvedName(.regular) == family.fallbackRegular)
        }
    }
}

/// Choosing a font: kept per profile in the Store, queued for upload.
@MainActor
struct FontChoiceTests {
    let store: SQLiteStore
    let guest: Profile.ID

    @MainActor final class SyncCounter {
        var count = 0
    }

    init() throws {
        store = try SQLiteStore.inMemory()
        guest = store.guestProfile.id
    }

    @Test func theDefaultUntilOneIsChosen() async throws {
        #expect(FontChoice.current(in: try await store.progress(for: guest)).id == "clean")
    }

    @Test func aChoicePersistsPerProfileAsAQueuedEventAndRequestsASync() async throws {
        let sibling = try await store.addChildProfile(remoteID: 4, displayName: "Bo")
        let counter = SyncCounter()

        let recorded = try await FontChoice.choose(
            .named("handwritten"), in: store, for: guest, requestSync: { counter.count += 1 })

        #expect(recorded)
        #expect(counter.count == 1)
        #expect(FontChoice.current(in: try await store.progress(for: guest)).id == "handwritten")
        #expect(FontChoice.current(in: try await store.progress(for: sibling.id)).id == "clean")
        let event = try #require(try await store.events(for: guest).last)
        #expect(event.uploadState == .pending)
        #expect(try event.decode(FontChosen.self) == FontChosen(fontThemeID: "handwritten"))
    }

    @Test func choosingTheCurrentThemeRecordsNothing() async throws {
        let counter = SyncCounter()
        let recorded = try await FontChoice.choose(
            .default, in: store, for: guest, requestSync: { counter.count += 1 })
        #expect(!recorded)
        #expect(counter.count == 0)
        #expect(try await store.events(for: guest).isEmpty)
    }

    @Test func anUnknownStoredThemeFallsBackToTheDefault() {
        #expect(FontChoice.current(in: ProfileProgress(fontThemeID: "future_font")).id == "clean")
        #expect(FontChoice.current(in: ProfileProgress(fontThemeID: "bubbly")).id == "bubbly")
    }
}
