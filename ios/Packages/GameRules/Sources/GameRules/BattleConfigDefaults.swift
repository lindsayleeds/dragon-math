// Built-in battle config per map node — the Swift port of
// DEFAULT_BATTLE_CONFIGS in src/data/battleData.js. Like the web's, these are
// only the fallback for when the `nodes` section of /api/rule-settings hasn't
// loaded (or failed); the server's node_config table is authoritative.
// BattleProblemsTests checks ops and range against golden/battle-problems.json.
//
// World 1 (1-8):   addition foundation, 1-12
// World 2 (9-16):  addition mastery — larger numbers, faster
// World 3 (17-25): subtraction, then mixed +/−
// World 4 (26-33): multiplication intro, 2-12 tables
// World 5 (34-41): mixed all-ops mastery

extension BattleConfig {
    /// Node id → built-in config, for nodes 1-41.
    public static let defaults: [Int: BattleConfig] = [
        // --- World 1: Mushroom Forest (addition foundation, 1-12) ---
        1: BattleConfig(ops: [.add], min: 1, max: 3, aiSeconds: 10.0),
        2: BattleConfig(ops: [.add], min: 1, max: 5, aiSeconds: 9.0),
        3: BattleConfig(ops: [.add], min: 1, max: 6, aiSeconds: 8.0),
        4: BattleConfig(ops: [.add], min: 1, max: 7, aiSeconds: 7.5),
        5: BattleConfig(ops: [.add], min: 1, max: 8, aiSeconds: 7.0),
        6: BattleConfig(ops: [.add], min: 1, max: 10, aiSeconds: 6.5),
        7: BattleConfig(ops: [.add], min: 1, max: 12, aiSeconds: 6.0),
        8: BattleConfig(ops: [.add], min: 1, max: 12, aiSeconds: 4.5),

        // --- World 2: Honeyfield Plains (addition mastery, larger numbers) ---
        9: BattleConfig(ops: [.add], min: 1, max: 14, aiSeconds: 7.0),
        10: BattleConfig(ops: [.add], min: 1, max: 16, aiSeconds: 6.5),
        11: BattleConfig(ops: [.add], min: 1, max: 18, aiSeconds: 6.0),
        12: BattleConfig(ops: [.add], min: 1, max: 20, aiSeconds: 5.5),
        13: BattleConfig(ops: [.add], min: 5, max: 20, aiSeconds: 5.0),
        14: BattleConfig(ops: [.add], min: 5, max: 25, aiSeconds: 5.0),
        15: BattleConfig(ops: [.add], min: 8, max: 25, aiSeconds: 4.5),
        16: BattleConfig(ops: [.add], min: 8, max: 30, aiSeconds: 4.0),

        // --- World 3: Crystal Caves (subtraction, then mixed +/−) ---
        17: BattleConfig(ops: [.sub], min: 1, max: 5, aiSeconds: 9.0),
        18: BattleConfig(ops: [.sub], min: 1, max: 7, aiSeconds: 8.0),
        19: BattleConfig(ops: [.sub], min: 1, max: 9, aiSeconds: 7.0),
        20: BattleConfig(ops: [.sub], min: 1, max: 10, aiSeconds: 6.5),
        21: BattleConfig(ops: [.sub], min: 1, max: 12, aiSeconds: 6.0),
        22: BattleConfig(ops: [.add, .sub], min: 1, max: 8, aiSeconds: 6.0),
        23: BattleConfig(ops: [.add, .sub], min: 1, max: 10, aiSeconds: 5.5),
        24: BattleConfig(ops: [.add, .sub], min: 1, max: 12, aiSeconds: 5.0),
        25: BattleConfig(ops: [.add, .sub], min: 1, max: 12, aiSeconds: 4.0),

        // --- World 4: Sakura Vale (multiplication intro, 2-12) ---
        26: BattleConfig(ops: [.mul], min: 2, max: 3, aiSeconds: 9.0),
        27: BattleConfig(ops: [.mul], min: 2, max: 4, aiSeconds: 8.0),
        28: BattleConfig(ops: [.mul], min: 2, max: 5, aiSeconds: 7.0),
        29: BattleConfig(ops: [.mul], min: 2, max: 7, aiSeconds: 6.5),
        30: BattleConfig(ops: [.mul], min: 2, max: 9, aiSeconds: 6.0),
        31: BattleConfig(ops: [.mul], min: 2, max: 10, aiSeconds: 5.5),
        32: BattleConfig(ops: [.mul], min: 2, max: 12, aiSeconds: 5.0),
        33: BattleConfig(ops: [.mul], min: 2, max: 12, aiSeconds: 4.0),

        // --- World 5: Cloudspire Heights (mixed all-ops mastery) ---
        34: BattleConfig(ops: [.add, .sub, .mul], min: 1, max: 10, aiSeconds: 6.0),
        35: BattleConfig(ops: [.add, .sub, .mul], min: 1, max: 12, aiSeconds: 5.5),
        36: BattleConfig(ops: [.add, .sub, .mul], min: 2, max: 12, aiSeconds: 5.0),
        37: BattleConfig(ops: [.mul], min: 3, max: 12, aiSeconds: 4.5),
        38: BattleConfig(ops: [.add, .sub, .mul], min: 2, max: 12, aiSeconds: 4.5),
        39: BattleConfig(ops: [.add, .sub, .mul], min: 2, max: 12, aiSeconds: 4.0),
        40: BattleConfig(ops: [.add, .sub, .mul], min: 3, max: 12, aiSeconds: 3.5),
        41: BattleConfig(ops: [.add, .sub, .mul], min: 2, max: 15, aiSeconds: 3.0),
    ]

    /// The built-in config for a node, or node 1's for an unknown node —
    /// `getDefaultBattleConfig` on the web.
    public static func defaultConfig(forNode nodeId: Int) -> BattleConfig {
        defaults[nodeId] ?? defaults[1]!
    }
}
