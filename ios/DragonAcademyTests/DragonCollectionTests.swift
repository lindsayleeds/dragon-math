import Foundation
import GameRules
import Store
import Sync
import Testing
@testable import DragonAcademy

private let catalog = [
    PrizeDragon(dragonID: 12, name: "Ember", rarity: "mythic"),
    PrizeDragon(dragonID: 3, name: nil, rarity: "common"),
    PrizeDragon(dragonID: 7, name: "Moss", rarity: "rare"),
    PrizeDragon(dragonID: 1, name: nil, rarity: "common"),
    PrizeDragon(dragonID: 9, name: nil, rarity: "sparkly"),  // unknown → common
    PrizeDragon(dragonID: 20, name: "Tide", rarity: "rare"),
]

@Test func dragonsGroupByRarityRarestFirstNumberedInIDOrder() {
    let collection = DragonCollection(catalog: catalog, owned: [:])
    #expect(collection.sections.map(\.rarity.key) == ["mythic", "rare", "common"])
    #expect(collection.sections.map { $0.slots.map(\.dragonID) } == [[12], [7, 20], [1, 3, 9]])
    #expect(collection.sections[2].slots.map(\.numberInRarity) == [1, 2, 3])
    #expect(collection.total == 6)
}

@Test func ownedDragonsCarryTheirCountsAndTheRestAreMissing() {
    // 99 was retired from the catalog: not shown, as on the web.
    let collection = DragonCollection(catalog: catalog, owned: [7: 3, 1: 1, 99: 2])
    #expect(collection.owned.map(\.dragonID) == [7, 1])
    #expect(collection.owned.map(\.count) == [3, 1])
    #expect(collection.missing.map(\.dragonID) == [12, 20, 3, 9])
    #expect(collection.ownedCount == 2)
    #expect(collection.sections.map(\.ownedCount) == [0, 1, 1])
    let moss = collection.sections[1].slots[0]
    #expect(moss.isOwned && moss.name == "Moss")
}

@Test func beforeTheCatalogSyncsTheAlbumIsTheFallbackArtRangeAllCommon() {
    let collection = DragonCollection(catalog: [], owned: [5: 2])
    #expect(collection.sections.map(\.rarity.key) == ["common"])
    #expect(collection.total == fallbackDragonCount)
    #expect(collection.owned.map(\.dragonID) == [5])
}

@Test func theCollectionLoadsTheSyncedCatalogAndTheProfilesDragons() async throws {
    let store = try SQLiteStore.inMemory()
    let guest = store.guestProfile
    try await store.saveContent(
        ContentDocument.dragonCatalog.name, version: "c1",
        json: Data(#"{"dragons":[{"dragon_id":300,"name":"Ember","rarity":"mythic"},{"dragon_id":301,"name":null,"rarity":"common"}],"total":2}"#.utf8))
    _ = try await store.record(DragonsCollected(dragonIDs: [300, 300]), for: guest.id)
    let other = try await store.saveChildProfile(remoteID: 7, displayName: "blaze", avatar: "🦊")
    _ = try await store.record(DragonsCollected(dragonIDs: [301]), for: other.id)

    let collection = await DragonCollection.load(from: store, for: guest.id)
    #expect(collection.owned.map(\.dragonID) == [300])
    #expect(collection.owned.first?.count == 2)
    #expect(collection.missing.map(\.dragonID) == [301])
}

@Test func everyFallbackDragonHasBundledArt() {
    let missing = (1...fallbackDragonCount).filter { !DragonArt.isBundled($0) }
    #expect(missing.isEmpty, "run npm run ios:dragon-art")
}
