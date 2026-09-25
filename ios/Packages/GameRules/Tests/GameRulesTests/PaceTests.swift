import GameRules
import Testing

// The game pace as a reducer input, beyond the slow-pace and untimed golden
// transcripts (BattleTests, MunchersTests): what each pace stretches or stops.

@Test func paceReadsUnknownValuesAsNormal() {
    #expect(GamePace.allCases.map(\.rawValue) == ["normal", "slow", "off"])
    #expect(GamePace(normalizing: "slow") == .slow)
    #expect(GamePace(normalizing: "off") == .off)
    for raw in [nil, "", "fast", "SLOW"] { #expect(GamePace(normalizing: raw) == .normal) }
    #expect(GamePace.slow.factor == GamePace.slowFactor)
    #expect(GamePace.normal.factor == 1 && GamePace.off.factor == 1)
    #expect(GamePace.off.isUntimed && !GamePace.slow.isUntimed)
}

/// Always the same draw, so every pace sees the same jitter.
private struct ConstantRandom: RandomSource {
    let value: Double
    mutating func next() -> Double { value }
}

private func startedBattle(_ pace: GamePace) -> BattleState {
    var rng = ConstantRandom(value: 0.75)
    let state = BattleState(
        config: BattleConfig.defaultConfig(forNode: 9), layout: .world(2), pace: pace, rng: &rng)
    return stepBattle(state, .start(now: 0), rng: &rng).state
}

private func opponentAt(_ state: BattleState) -> Double? {
    state.timers.first { $0.kind == .opponentSolve }?.at
}

@Test func slowBattleDoublesTheOpponentsBaseDelay() throws {
    let config = BattleConfig.defaultConfig(forNode: 9)
    let s = BattleSettings.defaults
    func delay(_ base: Double) -> Double { max(s.aiMinDelayMs, base + base * s.aiJitterFraction * 0.25) }
    #expect(opponentAt(startedBattle(.normal)) == delay(config.aiSeconds * 1000))
    #expect(opponentAt(startedBattle(.slow)) == delay(config.aiSeconds * 1000 * GamePace.slowFactor))
    // The think-it-through lock keeps its length.
    var rng = ConstantRandom(value: 0.75)
    let slow = startedBattle(.slow)
    let wrong = try #require(slow.grid.indices.first { slow.grid[$0] != nil && slow.grid[$0] != slow.problem.answer })
    let locked = stepBattle(slow, .tap(now: 100, cell: wrong), rng: &rng).state
    #expect(locked.timers.first { $0.kind == .unlockGrid }?.at == 100 + s.gridLockMs)
}

@Test func untimedBattleNeverRunsTheOpponent() {
    var battle = BattleSession(
        config: BattleConfig.defaultConfig(forNode: 9), layout: .world(2), pace: .off, rng: SeededRandom(seed: 4))
    battle.send(.start(now: 0))
    #expect(opponentAt(battle.state) == nil)
    let before = battle
    battle.send(.tick(now: 3_600_000))
    #expect(battle == before, "an hour's pause changes nothing and draws nothing")
    var now = 3_600_000.0
    while battle.state.status == .playing {
        now += 100
        if let cell = battle.state.grid.firstIndex(of: battle.state.problem.answer), !battle.state.blanking {
            battle.send(.tap(now: now, cell: cell))
        }
        now += 5000
        battle.send(.tick(now: now))
        #expect(opponentAt(battle.state) == nil)
    }
    #expect(battle.state.status == .won)
    #expect(battle.state.aiScore == 0)
}

@Test func slowMunchersStretchesTheMonsterClocks() {
    var rng = SeededRandom(seed: 9)
    let normal = MunchersState(operation: .mul, baseNumber: 3, rng: &rng)
    let slow = MunchersState(operation: .mul, baseNumber: 3, pace: .slow, rng: &rng)
    let d = MunchersSettings.defaults
    #expect(slow.spawnInterval == d.spawnIntervalMs * GamePace.slowFactor)
    #expect(slow.enemyInterval == normal.enemyInterval * GamePace.slowFactor)
    #expect(slow.telegraphMs == d.enemyTelegraphMs * GamePace.slowFactor)
    var campaign = MunchersState(operation: .mul, baseNumber: 3, progression: true, pace: .slow, rng: &rng)
    campaign.level = 40
    #expect(campaign.enemyInterval == d.minEnemyIntervalMs * GamePace.slowFactor)

    let started = stepMunchers(slow, .start(now: 0), rng: &rng).state
    #expect(started.timers.map(\.at) == [slow.spawnInterval, slow.enemyInterval])
}

@Test func untimedMunchersHasNoMonsters() {
    var rng = SeededRandom(seed: 9)
    let state = MunchersState(operation: .mul, baseNumber: 3, pace: .off, rng: &rng)
    let started = stepMunchers(state, .start(now: 0), rng: &rng).state
    #expect(started.started && started.timers.isEmpty && !started.monstersRun)
    let later = stepMunchers(started, .tick(now: 3_600_000), rng: &rng)
    #expect(!later.changed)
    #expect(later.state.enemies.isEmpty)
}
