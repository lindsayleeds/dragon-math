import Foundation
import GameRules
import Store
import Testing
@testable import DragonAcademy

private func verdict(
    _ level: PhonicsMasteryLevel, attempts: Int = 6, correct: Int = 6, modes: [String] = ["choose"],
    stale: Bool = false
) -> PhonicsElementMastery {
    PhonicsElementMastery(
        level: level, attempts: attempts, correct: correct,
        accuracy: attempts == 0 ? nil : Double(correct) / Double(attempts), modes: modes, lastSeenAtMs: 0,
        stale: stale, total: attempts)
}

@MainActor @Test func aTileOpensItsDetailAndClosesOnASecondTap() async throws {
    let store = try SQLiteStore.inMemory()
    for _ in 0..<4 {
        _ = try await store.record(
            PhonicsAttempted(elementKey: "sh", mode: "choose", correct: true, chosen: nil, responseMs: nil),
            for: store.guestProfile.id)
    }
    let progress = PhonicsProgress(store: store, profileID: store.guestProfile.id)
    await progress.reload()
    let model = SoundMapModel(progress: progress)

    #expect(model.detail == nil)
    #expect(model.tap("sh"))
    let detail = try #require(model.detail)
    #expect(detail.element.key == "sh")
    #expect(detail.state.level == .solid)
    #expect(detail.state.attempts == 4)

    // Another tile moves the detail; the open tile closes it.
    #expect(model.tap("ch"))
    #expect(model.detail?.element.key == "ch")
    #expect(model.detail?.state == .new)
    #expect(!model.tap("ch"))
    #expect(model.detail == nil)
}

@MainActor @Test func theMapShowsEveryStageWithItsCounts() async throws {
    let store = try SQLiteStore.inMemory()
    let progress = PhonicsProgress(store: store, profileID: store.guestProfile.id)
    await progress.reload()
    let overview = SoundMapModel(progress: progress).overview
    #expect(overview.stages.map(\.stage.stage) == PhonicsStage.all.map(\.stage))
    #expect(overview.stages.map(\.total).reduce(0, +) == PhonicsElement.all.count)
    #expect(overview.stages.allSatisfy { $0.mastered == 0 && $0.counts.new == $0.total })
}

@MainActor @Test func confusionsOutsideTheCurriculumAreDropped() async throws {
    let store = try SQLiteStore.inMemory()
    for chosen in ["ch", "ch", "zz-not-a-sound", "zz-not-a-sound"] {
        _ = try await store.record(
            PhonicsAttempted(elementKey: "sh", mode: "choose", correct: false, chosen: chosen, responseMs: nil),
            for: store.guestProfile.id)
    }
    let progress = PhonicsProgress(store: store, profileID: store.guestProfile.id)
    await progress.reload()
    #expect(progress.confusions.count == 2)
    let model = SoundMapModel(progress: progress)
    #expect(model.confusions.map(\.id) == ["sh\tch"])
    #expect(model.confusions.first?.count == 2)
}

@Test func theHeadlineCountsWhatIsThere() {
    var counts = PhonicsMasteryCounts()
    counts.new = 97
    #expect(SoundMapModel.headlineDetail(counts) == "97 not tried yet")
    counts.solid = 3
    counts.learning = 2
    #expect(SoundMapModel.headlineDetail(counts) == "3 nearly there · 2 still learning · 97 not tried yet")

    #expect(SoundMapModel.staleLine(0) == nil)
    #expect(SoundMapModel.staleLine(1) == "1 sound needs a re-check")
    #expect(SoundMapModel.staleLine(4) == "4 sounds need a re-check")
}

@Test func theDetailSaysWhyASoundSitsWhereItDoes() {
    #expect(SoundMapModel.stats(.new) == nil)
    #expect(SoundMapModel.stats(verdict(.solid, attempts: 6, correct: 5)) == "5 right out of your last 6 · right in 1 game")
    #expect(
        SoundMapModel.stats(verdict(.mastered, modes: ["choose", "type-it"]))
            == "6 right out of your last 6 · right in 2 games")
    #expect(SoundMapModel.stats(verdict(.learning, attempts: 2, correct: 0, modes: [])) == "0 right out of your last 2")
}

@Test func tilesTellTheirLevelToVoiceOver() throws {
    let sh = try #require(Phonics.elementByKey["sh"])
    #expect(SoundMapAccessibility.tile(sh, .new) == "sh, /sh/, Not tried yet")
    #expect(SoundMapAccessibility.tile(sh, verdict(.solid)) == "sh, /sh/, Got it one way")
    #expect(SoundMapAccessibility.tile(sh, verdict(.mastered, stale: true)) == "sh, /sh/, Mastered!, needs a re-check")
    #expect(SoundMapAccessibility.stageScore(mastered: 3, total: 21) == "3 of 21 mastered")
}

@Test func everyLevelHasItsOwnGlyphAndColors() {
    let levels = PhonicsMasteryLevel.allCases
    #expect(Set(levels.map(\.emoji)).count == levels.count)
    #expect(Set(levels.map(SoundMapStyle.fillHex)).count == levels.count)
    #expect(Set(levels.map(\.label)).count == levels.count)
}
