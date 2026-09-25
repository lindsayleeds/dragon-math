import Foundation
import GameRules
import Store
import Testing
@testable import DragonAcademy

private let day: TimeInterval = 24 * 3600
private let start = Date(timeIntervalSince1970: 1_800_000_000)

/// The Store's clock, moved by hand.
private final class StoreClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current = start
    func now() -> Date { lock.withLock { current } }
    func advance(_ seconds: TimeInterval) { lock.withLock { current += seconds } }
}

@MainActor
private struct ProgressHarness {
    let clock = StoreClock()
    let store: SQLiteStore
    let progress: PhonicsProgress

    init() throws {
        let clock = clock
        store = try .inMemory(now: { clock.now() })
        progress = PhonicsProgress(store: store, profileID: store.guestProfile.id, now: { clock.now() })
    }

    /// Records one answer, a minute after the last.
    func answer(_ key: String, _ mode: String, _ correct: Bool, chosen: String? = nil) async throws {
        clock.advance(60)
        _ = try await store.record(
            PhonicsAttempted(elementKey: key, mode: mode, correct: correct, chosen: chosen, responseMs: 900),
            for: store.guestProfile.id)
    }
}

@MainActor @Test func nothingPlayedIsAllNewAndUnweightedUntilLoaded() async throws {
    let h = try ProgressHarness()
    #expect(h.progress.states == nil)
    await h.progress.reload()
    #expect(h.progress.loaded)
    #expect(h.progress.states == [:])
    #expect(h.progress.review == nil)
    #expect(h.progress.overview.overall.new == PhonicsElement.all.count)
}

@MainActor @Test func masteryIsJudgedFromTheKidsOwnAttempts() async throws {
    let h = try ProgressHarness()
    // sh: six right across two games → mastered.
    for mode in ["choose", "type-it", "choose", "type-it", "choose", "choose"] {
        try await h.answer("sh", mode, true)
    }
    // ch: five right in one game → solid.
    for _ in 0..<5 { try await h.answer("ch", "choose", true) }
    // th: mostly wrong, read as f → learning.
    try await h.answer("th", "choose", false, chosen: "f")
    try await h.answer("th", "choose", false, chosen: "f")
    try await h.answer("th", "choose", true)
    // Another kid's answers and other kinds of event don't count.
    let sibling = try await h.store.addChildProfile(remoteID: 7, displayName: "Sib")
    _ = try await h.store.record(
        PhonicsAttempted(elementKey: "th", mode: "type-it", correct: true, chosen: nil, responseMs: nil), for: sibling.id)
    _ = try await h.store.record(NodeWon(nodeID: 1, stars: 3), for: h.store.guestProfile.id)

    await h.progress.reload()

    #expect(h.progress.mastery["sh"]?.level == .mastered)
    #expect(h.progress.mastery["sh"]?.modes == ["choose", "type-it"])
    #expect(h.progress.mastery["ch"]?.level == .solid)
    #expect(h.progress.mastery["th"]?.level == .learning)
    #expect(h.progress.mastery["th"]?.total == 3)
    #expect(h.progress.mastery.count == 3)
    #expect(h.progress.confusions == [PhonicsConfusion(element: "th", chose: "f", count: 2)])

    // The same verdict the rule gives on the same rows.
    let events = try await h.store.events(for: h.store.guestProfile.id)
    let rows = PhonicsProgress.attempts(from: events)
    #expect(rows.count == 14)
    #expect(h.progress.mastery == PhonicsMastery.classifyAll(rows, nowMs: h.clock.now().timeIntervalSince1970 * 1000))

    // What the round builder reads, and the Needs Practice list.
    #expect(h.progress.states?["ch"] == PhonicsMasteryState(level: "solid", stale: false, accuracy: 1))
    #expect(h.progress.review == ["th"])
    #expect(h.progress.overview.overall.mastered == 1)
}

@MainActor @Test func unpractisedSoundsGoStaleAndComeUpForReview() async throws {
    let h = try ProgressHarness()
    for _ in 0..<5 { try await h.answer("ch", "choose", true) }
    await h.progress.reload()
    #expect(h.progress.mastery["ch"]?.stale == false)

    h.clock.advance(Double(PhonicsMastery.staleAfterDays + 1) * day)
    await h.progress.reload()
    #expect(h.progress.mastery["ch"]?.level == .solid)
    #expect(h.progress.mastery["ch"]?.stale == true)
    #expect(h.progress.review == ["ch"])
    #expect(h.progress.overview.overall.stale == 1)
}

@MainActor @Test func aRoundIsWeightedByMasteryAndReJudgedOnceRecorded() async throws {
    let h = try ProgressHarness()
    for _ in 0..<5 { try await h.answer("ch", "choose", true) }
    await h.progress.reload()
    let states = try #require(h.progress.states)

    let model = PhonicsModel(
        mode: .typeIt, stages: .stage(3), store: h.store, profileID: h.store.guestProfile.id, sync: nil, seed: 42,
        progress: h.progress)
    var rng = SeededRandom(seed: 42)
    #expect(model.items == Phonics.buildRound(mode: .typeIt, stages: .stage(3), mastery: states, rng: &rng))

    for _ in 0..<model.total {
        let item = try #require(model.current)
        model.submit(typed: item.element.accepts[0])
        model.next()
    }
    #expect(model.phase == .done)
    await model.lastWrite?.value
    // Every sound of the round now has a verdict.
    #expect(model.items.allSatisfy { h.progress.mastery[$0.element.key] != nil })
}

@MainActor @Test func aNeedsPracticeRoundAsksOnlyItsSounds() async throws {
    let h = try ProgressHarness()
    try await h.answer("sh", "choose", false, chosen: "ch")
    try await h.answer("th", "choose", false)
    await h.progress.reload()
    let review = try #require(h.progress.review)
    #expect(Set(review) == ["sh", "th"])

    let model = PhonicsModel(
        mode: .choose, stages: .all, store: nil, profileID: nil, sync: nil, seed: 3, progress: h.progress,
        only: review)
    #expect(model.items.map(\.element.key).sorted() == ["sh", "th"])
}
