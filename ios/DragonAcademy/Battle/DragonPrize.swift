import API
import Foundation
import GameRules
import OSLog
import Store
import Sync

/// What a prize draws from and against: the catalog and odds (the last synced
/// copies, else GameRules' built-ins) and what the kid already owns, so the
/// reveal can say which dragons are new. Everything is on the device, so a
/// prize works offline.
struct PrizeContext: Sendable, Equatable {
    /// Empty until a catalog has synced; the draw then uses the fallback art
    /// range, as the web does before its catalog loads.
    var catalog: [PrizeDragon] = []
    var settings: PrizeSettings = .defaults
    /// Dragon id → how many the kid has, before this prize.
    var owned: [Int: Int] = [:]

    /// Reads the synced catalog and rule settings and the profile's dragons.
    /// Anything missing or unreadable falls back; this never fails.
    static func load(from store: (any Store)?, for profileID: Profile.ID?) async -> PrizeContext {
        var context = PrizeContext()
        guard let store else { return context }
        let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Prize")
        context.catalog = await PrizeDragon.syncedCatalog(from: store)
        do {
            if let doc = try await store.cachedContent(.ruleSettings) {
                context.settings = try prizeSettings(from: doc.prize)
            }
        } catch {
            log.error("Couldn't read the prize settings: \(error)")
        }
        if let profileID {
            do {
                context.owned = try await store.progress(for: profileID).dragons
            } catch {
                log.error("Couldn't read the dragons owned: \(error)")
            }
        }
        return context
    }

    /// The served `prize` section as GameRules' type: re-encoded to its wire
    /// JSON and decoded the way the golden tests decode it, so any tier or
    /// rarity the server sends comes through.
    static func prizeSettings(from served: Components.Schemas.PrizeSettings) throws -> PrizeSettings {
        try JSONDecoder().decode(PrizeSettings.self, from: JSONEncoder().encode(served)).validated()
    }
}

extension PrizeDragon {
    /// The last synced dragon catalog, in its served (dragon id) order; empty
    /// before the first sync or if it can't be read.
    static func syncedCatalog(from store: any Store) async -> [PrizeDragon] {
        do {
            guard let doc = try await store.cachedContent(.dragonCatalog) else { return [] }
            return doc.dragons.map { PrizeDragon(dragonID: $0.dragonId, name: $0.name, rarity: $0.rarity) }
        } catch {
            Logger(subsystem: "dev.placeholder.dragonacademy", category: "Prize")
                .error("Couldn't read the dragon catalog: \(error)")
            return []
        }
    }
}

/// One dragon on the reveal.
struct PrizeCard: Equatable, Identifiable {
    /// Position in the prize, so the same dragon twice is two cards.
    var id: Int
    var dragon: PrizeDragon
    /// A first-ever catch.
    var isNew: Bool
    /// How many of this dragon the kid has with this prize.
    var total: Int
}

/// Where the prize is.
enum PrizeState: Equatable {
    /// No win yet (or a fresh match).
    case none
    /// Won; the draw is being prepared.
    case opening
    case revealed([PrizeCard])
}

extension PrizeCard {
    /// The reveal for `drawn`, counting against `owned`: the first of a dragon
    /// the kid never had is new, and a repeat within the prize is not.
    static func cards(for drawn: [PrizeDragon], owned: [Int: Int]) -> [PrizeCard] {
        var counts = owned
        return drawn.enumerated().map { i, dragon in
            let before = counts[dragon.dragonID, default: 0]
            counts[dragon.dragonID] = before + 1
            return PrizeCard(id: i, dragon: dragon, isNew: before == 0, total: before + 1)
        }
    }
}
