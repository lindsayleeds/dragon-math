import Foundation
import GameRules
import Store
import Sync
import Testing
@testable import DragonAcademy

/// A kid's own list (#161) plays like a grade: all of its words, each from its
/// downloaded clip, with the best score kept under the list.
@MainActor @Test func aListRoundPlaysEveryWordAndKeepsItsOwnBest() async throws {
    let clips = ["cat", "dog", "owl"].reduce(into: [String: URL]()) {
        $0[$1] = URL(filePath: "/tmp/\($1).mp3")
    }
    let list = SyncedSpellingList(id: 5, name: "Week 1", words: ["cat", "dog", "owl"], clips: clips)
    let pick = SpellingPick.list(list)
    #expect(pick.label == "Week 1")
    #expect(pick.clipURL(for: "Dog") == clips["dog"])
    #expect(pick.clipURL(for: "bird") == nil)

    let store = try SQLiteStore.inMemory()
    let spoken = SpokenLog()
    let model = SpellingModel(
        pick: pick, difficulty: .hard, store: store, profileID: store.guestProfile.id, sync: nil,
        rng: SeededRandom(seed: 3), prizeRNG: SeededRandom(seed: 5), sleep: { _ in }, speak: spoken.speak)
    #expect(Set(model.words) == ["cat", "dog", "owl"])
    await model.speaking?.value
    #expect(spoken.words == [model.words[0]])

    while model.phase != .done {
        for letter in try #require(model.word) { model.press(letter) }
        model.submit()
        model.advance()
        await model.speaking?.value
    }
    await model.lastWrite?.value
    let rounds = try await store.events(for: store.guestProfile.id).compactMap { try $0.decode(SpellingRoundFinished.self) }
    #expect(rounds == [SpellingRoundFinished(sourceKey: "list:5", difficulty: "hard", correct: 3, total: 3, hints: 0)])
}
