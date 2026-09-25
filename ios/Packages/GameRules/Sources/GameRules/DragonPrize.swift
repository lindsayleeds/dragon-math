// Post-game dragon prizes — the Swift port of src/data/dragonPrize.js;
// golden/prize-draws.json is the check (DragonPrizeTests).
//
//   rollPrizeCount(_:rng:settings:)            rollPrizeCount
//   drawDragonPrize(catalog:count:rng:settings:) drawDragonPrize
//
// The device decides the draw and the server only records it (ADR 0004), so
// these must consume the same numbers in the same order as the JavaScript:
//
//   - rollPrizeCount: one draw, a weighted pick over the tier's
//     count_weights entries in served order.
//   - drawDragonPrize: two draws per dragon. First a weighted pick of the
//     rarity over only the tiers present in the catalog, in the order each
//     tier first appears there; then floor(next() * tierSize) for the dragon
//     within that tier, in catalog order.
//
// A weighted pick draws r = next() * total and walks the entries subtracting
// each weight, taking the first where r reaches <= 0 (so a draw of exactly 0
// takes the first entry even at weight 0), else the last entry.

/// How a game went, which skews how many dragons drop: wins → `high`,
/// losses → `low`.
public enum PrizePerformance: String, Sendable, Equatable, CaseIterable, Codable {
    case low, normal, high

    /// A served or stored tier name; anything unknown counts as `normal`, as on
    /// the web.
    public init(tier: String) {
        self = PrizePerformance(rawValue: tier) ?? .normal
    }
}

/// One weighted prize size — a `count_weights` entry in the `prize` section of
/// GET /api/rule-settings.
public struct PrizeCountWeight: Sendable, Equatable, Decodable {
    public var count: Int
    public var weight: Double

    public init(count: Int, weight: Double) {
        self.count = count
        self.weight = weight
    }
}

/// Prize sizes per performance tier, walked in order.
public struct PrizeCountWeights: Sendable, Equatable, Decodable {
    public var low: [PrizeCountWeight]
    public var normal: [PrizeCountWeight]
    public var high: [PrizeCountWeight]

    public init(low: [PrizeCountWeight], normal: [PrizeCountWeight], high: [PrizeCountWeight]) {
        self.low = low
        self.normal = normal
        self.high = high
    }

    public subscript(_ performance: PrizePerformance) -> [PrizeCountWeight] {
        switch performance {
        case .low: low
        case .normal: normal
        case .high: high
        }
    }
}

/// The prize odds, decoded straight from the `prize` section of GET
/// /api/rule-settings (snake-case keys, the served types) —
/// `DEFAULT_PRIZE_SETTINGS` in src/data/ruleSettings.js.
public struct PrizeSettings: Sendable, Equatable, Decodable {
    /// Relative weight per rarity key. Only rarities with dragons in the
    /// catalog are ever picked; a rarity missing here weighs 1.
    public var rarityWeights: [String: Double]
    public var countWeights: PrizeCountWeights

    enum CodingKeys: String, CodingKey {
        case rarityWeights = "rarity_weights"
        case countWeights = "count_weights"
    }

    public init(rarityWeights: [String: Double], countWeights: PrizeCountWeights) {
        self.rarityWeights = rarityWeights
        self.countWeights = countWeights
    }

    /// The fallback until the server's settings arrive. Must equal the web's
    /// DEFAULT_PRIZE_SETTINGS (and so the server's PRIZE_SETTINGS).
    public static let defaults = PrizeSettings(
        rarityWeights: [
            "common": 100, "uncommon": 45, "rare": 18, "very_rare": 6, "legendary": 2, "mythic": 0.6,
        ],
        countWeights: PrizeCountWeights(
            low: [.init(count: 1, weight: 70), .init(count: 2, weight: 25), .init(count: 3, weight: 5)],
            normal: [.init(count: 1, weight: 45), .init(count: 2, weight: 40), .init(count: 3, weight: 15)],
            high: [.init(count: 1, weight: 20), .init(count: 2, weight: 45), .init(count: 3, weight: 35)]))

    /// The web's `prizeSettingsFromServer` checks: a rarity weight that is
    /// missing, negative or not finite takes its default (a served rarity the
    /// defaults don't know is kept if valid), and a tier's count list that is
    /// empty or has any entry with count < 1 or a bad weight takes its default
    /// list.
    public func validated() -> PrizeSettings {
        let d = PrizeSettings.defaults
        func valid(_ w: Double) -> Bool { w.isFinite && w >= 0 }
        var rarity = d.rarityWeights
        for (key, weight) in rarityWeights where valid(weight) {
            rarity[key] = weight
        }
        func tier(_ served: [PrizeCountWeight], _ fallback: [PrizeCountWeight]) -> [PrizeCountWeight] {
            !served.isEmpty && served.allSatisfy { $0.count >= 1 && valid($0.weight) } ? served : fallback
        }
        let c = countWeights, dc = d.countWeights
        return PrizeSettings(
            rarityWeights: rarity,
            countWeights: PrizeCountWeights(
                low: tier(c.low, dc.low), normal: tier(c.normal, dc.normal), high: tier(c.high, dc.high)))
    }
}

/// A catalog row a prize draws from — GET /api/dragons/catalog's `dragons`.
public struct PrizeDragon: Sendable, Hashable {
    public var dragonID: Int
    public var name: String?
    /// A rarity key; nil counts as common.
    public var rarity: String?

    public init(dragonID: Int, name: String? = nil, rarity: String? = nil) {
        self.dragonID = dragonID
        self.name = name
        self.rarity = rarity
    }

    /// The rarity the draw files this dragon under.
    public var drawnRarity: String { rarity ?? "common" }
}

/// The art range the draw falls back to before a catalog has synced:
/// `DRAGON_PNG_COUNT` in src/data/dragonRarity.js.
public let fallbackDragonCount = 253

/// Dragons 1…`fallbackDragonCount`, all common and unnamed — the legacy art
/// range the web draws from when it has no catalog.
public let fallbackPrizeCatalog: [PrizeDragon] = (1...fallbackDragonCount).map {
    PrizeDragon(dragonID: $0, name: nil, rarity: "common")
}

/// One draw: the first entry whose running weight reaches the draw.
private func weightedPick<Value>(_ entries: [(Value, Double)], rng: inout some RandomSource) -> Value {
    let total = entries.reduce(0) { $0 + $1.1 }
    var r = rng.next() * total
    for (value, weight) in entries {
        r -= weight
        if r <= 0 { return value }
    }
    return entries[entries.count - 1].0
}

/// How many dragons this prize holds. One draw.
public func rollPrizeCount(
    _ performance: PrizePerformance, rng: inout some RandomSource, settings: PrizeSettings = .defaults
) -> Int {
    weightedPick(settings.countWeights[performance].map { ($0.count, $0.weight) }, rng: &rng)
}

/// `count` rarity-weighted dragons from the catalog (the fallback range if it
/// is empty). The same dragon can come up more than once. Two draws each.
public func drawDragonPrize(
    catalog: [PrizeDragon], count: Int, rng: inout some RandomSource, settings: PrizeSettings = .defaults
) -> [PrizeDragon] {
    let pool = catalog.isEmpty ? fallbackPrizeCatalog : catalog
    var tiers: [String] = []
    var byRarity: [String: [PrizeDragon]] = [:]
    for dragon in pool {
        let rarity = dragon.drawnRarity
        if byRarity[rarity] == nil { tiers.append(rarity) }
        byRarity[rarity, default: []].append(dragon)
    }
    let rarityEntries = tiers.map { ($0, settings.rarityWeights[$0] ?? 1) }

    var out: [PrizeDragon] = []
    for _ in 0..<max(count, 0) {
        let rarity = weightedPick(rarityEntries, rng: &rng)
        let group = byRarity[rarity]!
        out.append(group[Int((rng.next() * Double(group.count)).rounded(.down))])
    }
    return out
}
