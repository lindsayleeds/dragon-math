import Audio
import Foundation
import GameRules
import Store
import Sync
import Testing
@testable import DragonAcademy

/// A clock the test moves by hand. Sleepers wait until the test advances past
/// their deadline; a cancelled sleeper is resumed like any other and the model
/// ignores it (it checks `Task.isCancelled`).
@MainActor
final class TestClock {
    var now: Double = 1_000
    private var sleepers: [(at: Double, continuation: CheckedContinuation<Void, Never>)] = []

    var battleClock: BattleClock {
        // Strong captures: a model's leftover sleeper can outlive its test.
        BattleClock(
            now: { self.now },
            sleepUntil: { at in await self.sleep(until: at) })
    }

    private func sleep(until at: Double) async {
        if at <= now { return }
        await withCheckedContinuation { sleepers.append((at, $0)) }
    }

    func wakeDue() {
        let due = sleepers.filter { $0.at <= now }
        sleepers.removeAll { $0.at <= now }
        for sleeper in due { sleeper.continuation.resume() }
    }
}

/// What a test's `onWin` saw.
@MainActor
final class WinLog {
    var wins: [BattleModel.NodeWin] = []
    var syncRequests = 0

    var onWin: @MainActor (BattleModel.NodeWin) async -> Void {
        { self.wins.append($0) }
    }
}

/// What a test's `playSound` heard.
@MainActor
final class SoundLog {
    var played: [SoundEffect] = []

    var play: @MainActor (SoundEffect) -> Void {
        { self.played.append($0) }
    }
}

@MainActor
struct BattleModelTests {
    let clock = TestClock()
    let log = WinLog()

    /// A node-1 battle on a fixed seed; prizes draw from `prizeSeed`.
    func makeModel(
        seed: UInt64 = 7,
        prizeSeed: UInt64 = 11,
        companion: Companion = .pip,
        prizeContext: @escaping @MainActor () async -> PrizeContext = { PrizeContext() },
        onWin: @escaping @MainActor (BattleModel.NodeWin) async -> Void = { _ in },
        playSound: @escaping @MainActor (SoundEffect) -> Void = { _ in }
    ) -> BattleModel {
        BattleModel(
            nodeID: 1, companion: companion, rng: SeededRandom(seed: seed), prizeRNG: SeededRandom(seed: prizeSeed),
            clock: clock.battleClock, prizeContext: prizeContext, onWin: onWin, playSound: playSound)
    }

    /// The prize a fresh `SeededRandom(seed)` draws for a win — the golden
    /// order (GameRules' DragonPrizeTests): the count, then two draws a dragon.
    func expectedPrize(seed: UInt64 = 11, context: PrizeContext = PrizeContext()) -> [Int] {
        var rng = SeededRandom(seed: seed)
        let count = rollPrizeCount(.high, rng: &rng, settings: context.settings)
        return drawDragonPrize(catalog: context.catalog, count: count, rng: &rng, settings: context.settings)
            .map(\.dragonID)
    }

    /// Moves the clock to `time` and lets the pending tick, if it's due, run.
    func advance(_ model: BattleModel, to time: Double) async {
        clock.now = time
        while let at = model.state.nextTimerAt, at <= clock.now, let task = model.tickTask {
            clock.wakeDue()
            await task.value
        }
    }

    func advance(_ model: BattleModel, by ms: Double) async {
        await advance(model, to: clock.now + ms)
    }

    func answerCell(_ model: BattleModel) -> Int {
        model.state.grid.firstIndex(of: model.state.problem.answer)!
    }

    func wrongCell(_ model: BattleModel) -> Int {
        model.state.grid.indices.first { model.state.grid[$0] != nil && model.state.grid[$0] != model.state.problem.answer }!
    }

    /// Solves problems until the child has won.
    func winMatch(_ model: BattleModel) async {
        while model.state.status == .playing {
            model.tap(answerCell(model))
            await advance(model, by: BattleSettings.defaults.gridBlankMs)
        }
    }

    // MARK: -

    @Test func slowPaceGivesTheOpponentTwiceTheBaseDelay() throws {
        let normal = makeModel()
        let slow = BattleModel(
            nodeID: 1, rng: SeededRandom(seed: 7), pace: .slow, clock: clock.battleClock, onWin: { _ in })
        normal.start()
        slow.start()
        #expect(slow.state.pace == .slow)
        let s = BattleSettings.defaults
        let base = BattleConfig.defaultConfig(forNode: 1).aiSeconds * 1000
        let normalAt = try #require(normal.state.nextTimerAt) - clock.now
        let slowAt = try #require(slow.state.nextTimerAt) - clock.now
        // The same seed draws the same jitter: only the base doubled.
        #expect(abs(normalAt - max(s.aiMinDelayMs, base + (slowAt - base * 2) / 2)) < 0.001)
        #expect(slowAt > base * 2 * (1 - s.aiJitterFraction / 2) - 0.001)
    }

    @Test func untimedPaceNeverArmsTheOpponent() async {
        let model = BattleModel(
            nodeID: 1, rng: SeededRandom(seed: 7), pace: .off, clock: clock.battleClock, onWin: log.onWin)
        model.start()
        #expect(model.state.timers.isEmpty)
        #expect(model.tickTask == nil)
        await advance(model, by: 3_600_000)
        #expect(model.state.aiScore == 0)
        await winMatch(model)
        #expect(model.state.status == .won)
        #expect(model.state.aiScore == 0)
    }

    @Test func dealsNodeOnesConfigAndArmsTheOpponentOnStart() {
        let model = makeModel()
        #expect(model.state.config == BattleConfig.defaultConfig(forNode: 1))
        #expect(model.state.layout == BattleLayout.world(1))
        #expect(model.state.target == 10)
        #expect(model.tickTask == nil)

        model.start()
        #expect(model.state.matchStartedAt == 1_000)
        #expect(model.state.timers.map(\.kind) == [.opponentSolve])
        #expect(model.tickTask != nil)
        #expect(model.gridMode == .ready)
    }

    @Test func tapsDoNothingBeforeStart() {
        let model = makeModel()
        model.tap(answerCell(model))
        #expect(model.state.playerScore == 0)
    }

    @Test func aRightTapScoresAndBlanksUntilTheNextProblem() async {
        let model = makeModel()
        model.start()
        let round = model.state.round
        model.tap(answerCell(model))
        #expect(model.state.playerScore == 1)
        #expect(model.gridMode == .blank)

        await advance(model, by: BattleSettings.defaults.gridBlankMs - 1)
        #expect(model.gridMode == .blank)
        await advance(model, by: 1)
        #expect(model.gridMode == .ready)
        #expect(model.state.round == round + 1)
    }

    @Test func aWrongTapLocksTheGridForTheLockTime() async {
        let model = makeModel()
        model.start()
        let wrong = wrongCell(model)
        model.tap(wrong)
        #expect(model.gridMode == .locked)
        #expect(model.state.wrongCellIndex == wrong)

        // Taps while locked are ignored.
        model.tap(answerCell(model))
        #expect(model.state.playerScore == 0)

        await advance(model, by: BattleSettings.defaults.wrongFlashMs)
        #expect(model.state.wrongCellIndex == nil)
        #expect(model.gridMode == .locked)
        await advance(model, to: 1_000 + BattleSettings.defaults.gridLockMs)
        #expect(model.gridMode == .ready)
    }

    @Test func theOpponentScoresWhenItsTimerFires() async throws {
        let model = makeModel()
        model.start()
        let at = try #require(model.state.nextTimerAt)
        await advance(model, to: at - 1)
        #expect(model.state.aiScore == 0)
        await advance(model, to: at)
        #expect(model.state.aiScore == 1)
        #expect(model.state.aiSolvedAnswer == model.state.problem.answer)
        #expect(model.gridMode == .blank)
    }

    @Test func theOpponentWinsIfTheChildNeverTaps() async {
        let model = makeModel(onWin: log.onWin)
        model.start()
        // Far enough for ten opponent answers plus their blanks.
        for _ in 0..<40 { await advance(model, by: 5_000) }
        #expect(model.state.status == .lost)
        #expect(model.state.aiScore == 10)
        #expect(model.gridMode == .over)
        #expect(model.winRecording == nil)
        #expect(log.wins.isEmpty)
    }

    @Test func aWinIsReportedOnceWithStars() async {
        let model = makeModel(onWin: log.onWin)
        model.start()
        await winMatch(model)
        await model.winRecording?.value
        #expect(model.state.status == .won)
        #expect(model.gridMode == .over)
        #expect(log.wins == [BattleModel.NodeWin(nodeID: 1, stars: 3, dragonIDs: expectedPrize())])

        // Later events (the trailing nextProblem tick) don't report it again.
        await advance(model, by: 10_000)
        #expect(log.wins.count == 1)
    }

    @Test func retryStartsAFreshMatchThatCanBeWonAgain() async {
        let model = makeModel(onWin: log.onWin)
        model.start()
        await winMatch(model)
        model.retry()
        #expect(model.state.status == .playing)
        #expect(model.state.playerScore == 0)
        #expect(model.state.aiScore == 0)
        await advance(model, by: BattleSettings.defaults.gridBlankMs)
        await winMatch(model)
        await model.winRecording?.value
        #expect(log.wins.count == 2)
    }

    @Test func stopCancelsTheTickAndResumeReArmsIt() async throws {
        let model = makeModel()
        model.start()
        let at = try #require(model.state.nextTimerAt)
        model.stop()
        #expect(model.tickTask == nil)
        clock.now = at
        clock.wakeDue()
        for _ in 0..<10 { await Task.yield() }
        #expect(model.state.aiScore == 0)

        model.resume()
        await model.tickTask?.value
        #expect(model.state.aiScore == 1)
    }

    @Test func theSameSeedPlaysTheSameBattle() async {
        func transcript() async -> [String] {
            let model = makeModel(seed: 42)
            model.start()
            var lines: [String] = []
            for _ in 0..<5 {
                lines.append("\(model.problemText) \(model.state.grid) \(model.state.nextTimerAt ?? -1)")
                model.tap(answerCell(model))
                await advance(model, by: 600)
            }
            return lines
        }
        let first = await transcript()
        clock.now = 1_000
        let second = await transcript()
        #expect(first == second)
    }

    // MARK: - Sounds

    @Test func aRightAnswerYipsAndAWrongOneIsQuiet() async {
        let sounds = SoundLog()
        let model = makeModel(playSound: sounds.play)
        model.start()
        #expect(sounds.played.isEmpty)
        model.tap(wrongCell(model))
        #expect(sounds.played.isEmpty)
        await advance(model, to: 1_000 + BattleSettings.defaults.gridLockMs)
        #expect(model.gridMode == .ready)
        model.tap(answerCell(model))
        #expect(sounds.played == [.yip])
    }

    @Test func aWinYipsEachAnswerThenPlaysVictoryOnce() async {
        let sounds = SoundLog()
        let model = makeModel(playSound: sounds.play)
        model.start()
        await winMatch(model)
        #expect(sounds.played.last == .victory)
        #expect(sounds.played.dropLast().allSatisfy { $0 == .yip || $0 == .growl })
        #expect(sounds.played.filter { $0 == .yip }.count == model.state.playerScore)
        // The trailing tick after the match doesn't play it again.
        await advance(model, by: 10_000)
        #expect(sounds.played.filter { $0 == .victory }.count == 1)
    }

    @Test func aLossGrowlsEachOpponentAnswerThenPlaysDefeat() async {
        let sounds = SoundLog()
        let model = makeModel(playSound: sounds.play)
        model.start()
        for _ in 0..<40 { await advance(model, by: 5_000) }
        #expect(model.state.status == .lost)
        #expect(sounds.played == Array(repeating: .growl, count: 10) + [.defeat])
    }

    @Test func eachBattleSoundHasItsFile() {
        #expect(SoundEffect(BattleSound.yip) == .yip)
        #expect(SoundEffect(BattleSound.growl) == .growl)
        #expect(SoundEffect(endOfMatch: .won) == .victory)
        #expect(SoundEffect(endOfMatch: .lost) == .defeat)
        #expect(SoundEffect(endOfMatch: .playing) == nil)
    }

    @Test func aWinsStarsComeFromTheMatchOutcome() async {
        let log = log
        let model = makeModel(onWin: log.onWin)
        model.start()
        await winMatch(model)
        await model.winRecording?.value
        let stars = matchStars(aiScore: model.state.aiScore, target: model.state.target)
        #expect(model.outcome == MatchOutcome(stars: stars, crowned: false, befriends: nil))
        #expect(log.wins.map(\.stars) == [stars])
    }

    @Test func aNodePlaysItsOwnBattle() throws {
        let node = try #require(GameMap.node(26))
        let model = BattleModel(nodeID: 26, rng: SeededRandom(seed: 7), clock: clock.battleClock, onWin: { _ in })
        #expect(model.node == node)
        #expect(model.state.config == node.battleConfig)
        #expect(model.state.layout == node.battleLayout)
    }

    @Test func aNodeOffTheMapPlaysNodeOnesBattle() {
        let model = BattleModel(nodeID: 99, rng: SeededRandom(seed: 7), clock: clock.battleClock, onWin: { _ in })
        #expect(model.nodeID == 99)
        #expect(model.node.id == 1)
        #expect(model.state.config == BattleConfig.defaultConfig(forNode: 1))
    }

    // MARK: - Boss battles

    /// A battle on the Forest Dragon (node 8), the first boss.
    func makeBossModel(
        owned: Set<String> = [Companion.pip.id],
        onWin: @escaping @MainActor (BattleModel.NodeWin) async -> Void = { _ in }
    ) -> BattleModel {
        BattleModel(
            nodeID: 8, ownedCompanionIDs: owned, rng: SeededRandom(seed: 7), prizeRNG: SeededRandom(seed: 11),
            clock: clock.battleClock, onWin: onWin)
    }

    @Test func aRegularNodeGoesStraightIntoBattleAgainstTheFox() {
        let model = makeModel()
        #expect(model.stage == .battle)
        #expect(!model.opponent.isBoss)
        #expect(model.opponent.icon == "🦊")
        model.start()
        #expect(model.stage == .battle)
        #expect(model.state.nextTimerAt != nil)
    }

    @Test func aBossNodeOpensOnItsIntroAndWaitsForTheFight() throws {
        let model = makeBossModel()
        let node = try #require(GameMap.node(8))
        #expect(model.stage == .bossIntro)
        #expect(model.opponent == Opponent(node: node))
        #expect(model.opponent.isBoss)
        #expect(model.opponent.icon == "🐉")
        #expect(model.opponent.art == node.bossArt)
        #expect(model.state.config == node.battleConfig)

        model.start()
        #expect(model.stage == .bossIntro)
        #expect(model.state.nextTimerAt == nil)
        #expect(model.tickTask == nil)
        let score = model.state.playerScore
        model.tap(answerCell(model))
        #expect(model.state.playerScore == score)

        model.fight()
        #expect(model.stage == .battle)
        #expect(model.state.nextTimerAt != nil)
        model.fight()
        #expect(model.stage == .battle)
    }

    @Test func aFirstBossWinBefriendsItsDragonThenShowsTheCrownedResult() async {
        let log = log
        let model = makeBossModel(onWin: log.onWin)
        model.fight()
        await winMatch(model)
        await model.winRecording?.value

        let forest = Companion.named("forest_dragon")
        #expect(model.stage == .befriended(forest))
        #expect(model.outcome?.crowned == true)
        #expect(model.outcome?.befriends == forest)
        #expect(model.ownedCompanionIDs == ["pip", "forest_dragon"])
        #expect(log.wins.map(\.nodeID) == [8])

        model.continueAfterBefriending()
        #expect(model.stage == .result)

        // Played again, it's crowned but befriends no one new.
        model.retry()
        #expect(model.stage == .battle)
        #expect(model.outcome == nil)
        await winMatch(model)
        await model.winRecording?.value
        #expect(model.stage == .result)
        #expect(model.outcome?.crowned == true)
        #expect(model.outcome?.befriends == nil)
        #expect(log.wins.count == 2)
    }

    @Test func aBossAlreadyBefriendedGoesStraightToTheResult() async {
        let model = makeBossModel(owned: ["pip", "forest_dragon"])
        model.fight()
        await winMatch(model)
        #expect(model.stage == .result)
        #expect(model.outcome?.crowned == true)
        #expect(model.outcome?.befriends == nil)
        model.continueAfterBefriending()
        #expect(model.stage == .result)
    }

    @Test func aLostBossBattleIsNeitherCrownedNorBefriending() async {
        let model = makeBossModel()
        model.fight()
        for _ in 0..<60 { await advance(model, by: 5_000) }
        #expect(model.state.status == .lost)
        #expect(model.stage == .result)
        #expect(model.outcome == MatchOutcome(stars: nil, crowned: false, befriends: nil))
        // A retry after a loss goes back into battle, not the intro.
        model.retry()
        #expect(model.stage == .battle)
    }

    // MARK: - Recording

    @Test func aWinIsRecordedAsNodeWonForTheGuestAndAsksToSync() async throws {
        let store = try SQLiteStore.inMemory()
        let guest = store.guestProfile
        let log = log
        let model = makeModel(onWin: BattleModel.recordingWins(
            in: store, for: guest.id, requestSync: { log.syncRequests += 1 }))
        model.start()
        await winMatch(model)
        await model.winRecording?.value

        let events = try await store.events(for: guest.id)
        #expect(events.count == 2)
        let won = try #require(try events.first?.decode(NodeWon.self))
        #expect(won == NodeWon(nodeID: 1, stars: 3))
        #expect(try await store.progress(for: guest.id).nodesWon == [1])
        #expect(log.syncRequests == 1)
    }

    @Test func bringsTheChosenCompanionsBondPower() {
        #expect(makeModel().companion == .pip)
        let storm = Companion.named("storm_dragon")
        let model = BattleModel(
            nodeID: 1, companion: storm, rng: SeededRandom(seed: 7), clock: clock.battleClock, onWin: { _ in })
        #expect(model.companion == storm)
        #expect(model.bondPower == BondPower(kind: .revealAnswer, cooldownMs: 22_000, durationMs: 2_200, highlightColor: "#a8d8f0"))
    }

    // MARK: - Bond Powers

    @Test func theBondPowerDoesNothingBeforeStart() {
        let model = makeModel()
        model.useBondPower()
        #expect(model.state.hintCellIndices == nil)
        #expect(model.bondStatus == BattleModel.BondStatus(phase: .ready, cooldownFraction: 0, secondsLeft: 0))
    }

    @Test func pipsPeekLightsCellsRoundTheAnswerThenCoolsDown() async {
        let model = makeModel()
        model.start()
        let usedAt = clock.now
        model.useBondPower()
        let hinted = model.state.hintCellIndices ?? []
        #expect(hinted.contains(answerCell(model)))
        #expect(model.state.hintColor == "#9ed8ff")
        #expect(model.cellBond(answerCell(model)) == .hinted)
        #expect(model.bondStatus == BattleModel.BondStatus(phase: .active, cooldownFraction: 1, secondsLeft: 20))

        // The peek lasts its 2s; the cooldown runs on.
        await advance(model, to: usedAt + 1_999)
        #expect(model.bondStatus.phase == .active)
        await advance(model, to: usedAt + 2_000)
        #expect(model.state.hintCellIndices == nil)
        #expect(model.bondStatus.phase == .coolingDown)
        #expect(model.bondStatus.secondsLeft == 18)
        #expect(abs(model.bondStatus.cooldownFraction - 0.9) < 1e-9)

        // Refused while cooling down: nothing lights, the cooldown isn't reset.
        model.useBondPower()
        #expect(model.state.hintCellIndices == nil)
        #expect(model.state.bondCooldownMs == 18_000)

        await advance(model, to: usedAt + 19_900)
        #expect(model.bondStatus.phase == .coolingDown)
        #expect(model.bondStatus.secondsLeft == 1)
        await advance(model, to: usedAt + 20_000)
        #expect(model.bondStatus == BattleModel.BondStatus(phase: .ready, cooldownFraction: 0, secondsLeft: 0))
        #expect(model.bondStatus.isEnabled)
    }

    @Test func aHintHidesWhileTheGridIsBlank() async {
        let model = makeModel()
        model.start()
        model.useBondPower()
        let hinted = model.state.hintCellIndices ?? []
        model.tap(answerCell(model))
        #expect(model.gridMode == .blank)
        #expect(model.state.hintCellIndices != nil)
        #expect(hinted.allSatisfy { model.cellBond($0) == nil })
    }

    @Test func stormsEyeRevealsTheAnswerCell() {
        let model = makeModel(companion: .named("storm_dragon"))
        model.start()
        model.useBondPower()
        #expect(model.state.revealCellIndex == answerCell(model))
        #expect(model.cellBond(answerCell(model)) == .revealed)
        #expect(model.state.hintColor == "#a8d8f0")
        #expect(model.bondStatus.secondsLeft == 22)
    }

    @Test func mushroomsCoverWrongCellsWhichIgnoreTaps() async {
        let model = makeModel(companion: .named("forest_dragon"))
        model.start()
        model.useBondPower()
        let covered = model.state.mushroomCellIndices ?? []
        #expect(!covered.isEmpty)
        #expect(!covered.contains(answerCell(model)))
        let cell = covered[0]
        #expect(model.cellBond(cell) == .covered)
        model.tap(cell)
        #expect(model.gridMode == .ready)
        #expect(model.state.wrongCellIndex == nil)

        // Active until the next problem, however long the cooldown has left.
        model.tap(answerCell(model))
        #expect(model.state.mushroomCellIndices == nil)
        #expect(model.bondStatus.phase == .coolingDown)
    }

    @Test func crystalFlashZapsWrongCells() {
        let model = makeModel(companion: .named("crystal_dragon"))
        model.start()
        model.useBondPower()
        let zapped = model.state.zappedCellIndices ?? []
        #expect(!zapped.isEmpty && zapped.count <= lightningMaxCells)
        #expect(zapped.allSatisfy { model.cellBond($0) == .zapped })
        model.tap(zapped[0])
        #expect(model.gridMode == .ready)
    }

    @Test func sunfireHoldPausesTheOpponentForItsDuration() async throws {
        let model = makeModel(companion: .named("sunfire_dragon"))
        model.start()
        let usedAt = clock.now
        model.useBondPower()
        #expect(model.state.aiLocked)
        #expect(!model.state.timers.contains { $0.kind == .opponentSolve })

        await advance(model, to: usedAt + 29_999)
        #expect(model.state.aiScore == 0)
        #expect(model.bondStatus.phase == .active)
        await advance(model, to: usedAt + 30_000)
        #expect(!model.state.aiLocked)
        #expect(model.bondStatus.phase == .coolingDown)
        #expect(model.bondStatus.secondsLeft == 15)
        // The opponent is back on the clock.
        let solveAt = try #require(model.state.timers.first { $0.kind == .opponentSolve }?.at)
        await advance(model, to: solveAt)
        #expect(model.state.aiScore == 1)
    }

    @Test func petalShieldForgivesOneWrongTap() async {
        let model = makeModel(companion: .named("sakura_dragon"))
        model.start()
        model.useBondPower()
        #expect(model.state.shieldActive)
        model.tap(wrongCell(model))
        #expect(model.gridMode == .ready)
        #expect(!model.state.shieldActive)
        await advance(model, by: BattleSettings.defaults.wrongFlashMs)
        model.tap(wrongCell(model))
        #expect(model.gridMode == .locked)
    }

    @Test func theBondPowerIsUnavailableOnceTheMatchEndsAndRetryResetsIt() async {
        let model = makeModel()
        model.start()
        model.useBondPower()
        await winMatch(model)
        #expect(model.bondStatus.phase == .unavailable)
        #expect(!model.bondStatus.isEnabled)
        model.retry()
        #expect(model.bondStatus == BattleModel.BondStatus(phase: .ready, cooldownFraction: 0, secondsLeft: 0))
    }

    // MARK: - The prize

    @Test func aWinRevealsASeededHighPrize() async throws {
        let model = makeModel(onWin: log.onWin)
        model.start()
        #expect(model.prize == .none)
        await winMatch(model)
        // The draw may already have finished by now; either way a prize has
        // started, and the recording task ends on the reveal.
        #expect(model.prize != .none)
        await model.winRecording?.value

        let drawn = expectedPrize()
        #expect((1...3).contains(drawn.count))
        guard case .revealed(let cards) = model.prize else {
            Issue.record("prize is \(model.prize)")
            return
        }
        #expect(cards.map(\.dragon.dragonID) == drawn)
        // No catalog synced: the fallback range, all common.
        #expect(cards.allSatisfy { (1...fallbackDragonCount).contains($0.dragon.dragonID) && $0.dragon.rarity == "common" })
        #expect(log.wins.first?.dragonIDs == drawn)
    }

    @Test func aPrizeIsRecordedAsDragonsCollectedForTheProfile() async throws {
        let store = try SQLiteStore.inMemory()
        let kid = try await store.addChildProfile(remoteID: 7, displayName: "Robin")
        let log = log
        let model = makeModel(
            prizeContext: { await PrizeContext.load(from: store, for: kid.id) },
            onWin: BattleModel.recordingWins(in: store, for: kid.id, requestSync: { log.syncRequests += 1 }))
        model.start()
        await winMatch(model)
        await model.winRecording?.value

        let drawn = expectedPrize()
        let events = try await store.events(for: kid.id)
        #expect(events.map(\.kind) == [NodeWon.kind, DragonsCollected.kind])
        #expect(try events[1].decode(DragonsCollected.self) == DragonsCollected(dragonIDs: drawn))
        let owned = try await store.progress(for: kid.id).dragons
        #expect(owned == Dictionary(drawn.map { ($0, 1) }, uniquingKeysWith: +))
        // One sync request, after both events are queued.
        #expect(log.syncRequests == 1)
        // Nothing lands on the guest.
        #expect(try await store.events(for: store.guestProfile.id).isEmpty)
    }

    @Test func thePrizeDrawsFromTheSyncedCatalogAndOdds() async throws {
        let store = try SQLiteStore.inMemory()
        let guest = store.guestProfile
        try await store.saveContent(
            ContentDocument.dragonCatalog.name, version: "c1",
            json: Data(#"{"dragons":[{"dragon_id":300,"name":"Ember","rarity":"mythic"},{"dragon_id":301,"name":null,"rarity":"common"}],"total":2}"#.utf8))
        try await store.saveContent(ContentDocument.ruleSettings.name, version: "r1", json: try Self.ruleSettings(
            prize: ["rarity_weights": [
                "common": 0, "uncommon": 0, "rare": 0, "very_rare": 0, "legendary": 0, "mythic": 1,
            ], "count_weights": [  // the contract requires every rarity

                "low": [["count": 1, "weight": 1]], "normal": [["count": 1, "weight": 1]],
                "high": [["count": 3, "weight": 1]],
            ]]))
        // Ember is already in the Den once.
        _ = try await store.record(DragonsCollected(dragonIDs: [300]), for: guest.id)

        let context = await PrizeContext.load(from: store, for: guest.id)
        #expect(context.catalog.map(\.dragonID) == [300, 301])
        #expect(context.settings.countWeights.high == [PrizeCountWeight(count: 3, weight: 1)])
        #expect(context.owned == [300: 1])

        let model = makeModel(prizeContext: { context })
        model.start()
        await winMatch(model)
        await model.winRecording?.value
        guard case .revealed(let cards) = model.prize else {
            Issue.record("prize is \(model.prize)")
            return
        }
        #expect(cards.map(\.dragon.dragonID) == [300, 300, 300])
        #expect(cards.map(\.dragon.name) == ["Ember", "Ember", "Ember"])
        #expect(cards.map(\.isNew) == [false, false, false])
        #expect(cards.map(\.total) == [2, 3, 4])
    }

    @Test func noSyncedContentFallsBackToTheBuiltIns() async throws {
        let store = try SQLiteStore.inMemory()
        #expect(await PrizeContext.load(from: store, for: store.guestProfile.id) == PrizeContext())
        #expect(await PrizeContext.load(from: nil, for: nil) == PrizeContext())
    }

    @Test func cardsMarkFirstCatchesAndCountRepeats() {
        let a = PrizeDragon(dragonID: 1), b = PrizeDragon(dragonID: 2)
        let cards = PrizeCard.cards(for: [a, b, a], owned: [2: 4])
        #expect(cards.map(\.isNew) == [true, false, false])
        #expect(cards.map(\.total) == [1, 5, 2])
        #expect(cards.map(\.id) == [0, 1, 2])
    }

    @Test func retryClearsThePrizeAndTheNextWinDrawsAnother() async {
        let model = makeModel(onWin: log.onWin)
        model.start()
        await winMatch(model)
        await model.winRecording?.value
        model.retry()
        #expect(model.prize == .none)
        await advance(model, by: BattleSettings.defaults.gridBlankMs)
        await winMatch(model)
        await model.winRecording?.value
        guard case .revealed = model.prize else {
            Issue.record("prize is \(model.prize)")
            return
        }
        #expect(log.wins.count == 2)
    }

    @Test func aLossHasNoPrize() async {
        let model = makeModel(onWin: log.onWin)
        model.start()
        for _ in 0..<40 { await advance(model, by: 5_000) }
        #expect(model.state.status == .lost)
        #expect(model.prize == .none)
    }

    /// golden/rule-settings.json's served document with its `prize` section
    /// replaced.
    static func ruleSettings(prize: [String: Any]) throws -> Data {
        var root = URL(filePath: #filePath)
        for _ in 0..<3 { root.deleteLastPathComponent() }
        let file = try Data(contentsOf: root.appending(path: "golden/rule-settings.json"))
        let golden = try #require(try JSONSerialization.jsonObject(with: file) as? [String: Any])
        var document = try #require(golden["document"] as? [String: Any])
        document["prize"] = prize
        return try JSONSerialization.data(withJSONObject: document)
    }

    @Test func aLossRecordsNothing() async throws {
        let store = try SQLiteStore.inMemory()
        let log = log
        let model = makeModel(onWin: BattleModel.recordingWins(
            in: store, for: store.guestProfile.id, requestSync: { log.syncRequests += 1 }))
        model.start()
        for _ in 0..<40 { await advance(model, by: 5_000) }
        #expect(model.state.status == .lost)
        #expect(try await store.events(for: store.guestProfile.id).isEmpty)
        #expect(log.syncRequests == 0)
    }
}
