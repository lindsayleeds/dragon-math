import GameRules
import Store

/// The Dragon Den's album: every catalog dragon in a numbered slot, grouped
/// by rarity (rarest first), owned ones with how many the kid has. The same
/// grouping as src/pages/DragonCollectionPage.jsx: within a rarity, slots are
/// numbered in dragon id order, and a missing dragon is only its number, so
/// the album spoils nothing but how many of each rarity there are.
struct DragonCollection: Equatable {
    struct Slot: Equatable, Identifiable {
        var dragonID: Int
        var name: String?
        /// 1-based position within its rarity.
        var numberInRarity: Int
        /// How many the kid has; 0 = still missing.
        var count: Int

        var id: Int { dragonID }
        var isOwned: Bool { count > 0 }
    }

    struct Section: Equatable, Identifiable {
        var rarity: PrizeRarity
        var slots: [Slot]

        var id: String { rarity.key }
        var ownedCount: Int { slots.count(where: \.isOwned) }
    }

    /// Rarest first; a rarity with no dragons has no section.
    var sections: [Section]

    /// `catalog` is the synced one (empty before the first sync: the web's
    /// 1…253 art range, all common, as the prize draw uses). `owned` is dragon
    /// id → count, from the kid's progress. Owned dragons no longer in the
    /// catalog (retired) aren't shown, as on the web; an unknown rarity files
    /// as common.
    init(catalog: [PrizeDragon], owned: [Int: Int]) {
        let dragons = (catalog.isEmpty ? fallbackPrizeCatalog : catalog).sorted { $0.dragonID < $1.dragonID }
        let byRarity = Dictionary(grouping: dragons) { PrizeRarity(key: $0.drawnRarity).key }
        sections = PrizeRarity.keys.reversed().compactMap { key in
            guard let members = byRarity[key], !members.isEmpty else { return nil }
            let slots = members.enumerated().map { i, dragon in
                Slot(dragonID: dragon.dragonID, name: dragon.name, numberInRarity: i + 1,
                     count: max(0, owned[dragon.dragonID, default: 0]))
            }
            return Section(rarity: PrizeRarity(key: key), slots: slots)
        }
    }

    var total: Int { sections.reduce(0) { $0 + $1.slots.count } }
    var ownedCount: Int { sections.reduce(0) { $0 + $1.ownedCount } }
    var owned: [Slot] { sections.flatMap(\.slots).filter(\.isOwned) }
    var missing: [Slot] { sections.flatMap(\.slots).filter { !$0.isOwned } }

    /// The profile's collection from the Store: the synced catalog and its
    /// current dragons. Never fails; anything unreadable shows as missing.
    static func load(from store: any Store, for profileID: Profile.ID) async -> DragonCollection {
        let catalog = await PrizeDragon.syncedCatalog(from: store)
        let owned = (try? await store.progress(for: profileID).dragons) ?? [:]
        return DragonCollection(catalog: catalog, owned: owned)
    }
}
