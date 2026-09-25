import API
import Foundation
import GameRules
import Store
import Testing
import TextNormalization
@testable import DragonAcademy

private struct FakeSource: MemorizePassageSource {
    var result: Result<[MemorizePassage], MemorizePassageError>

    func passages(for profile: Profile) async throws -> [MemorizePassage] {
        try result.get()
    }
}

private let revision = "2026-09-10T12:00:00.123Z"
private let assigned = MemorizePassage(
    source: .server(id: 3, revision: revision), title: "Stillness", category: "verse",
    body: "Be still. Know that I am here!", serverMastery: 1)

/// Waits (briefly) for the model's observed progress to satisfy `condition`.
@MainActor
private func eventually(_ condition: () -> Bool) async {
    for _ in 0..<200 where !condition() {
        try? await Task.sleep(for: .milliseconds(10))
    }
}

@Test func samplesArePlayableOnHard() {
    #expect(Set(MemorizePassage.samples.map(\.id)).count == MemorizePassage.samples.count)
    for sample in MemorizePassage.samples {
        #expect(Memorize.unsupportedWords(sample.body).isEmpty, "\(sample.title)")
        #expect(!Memorize.sentences(sample.body).isEmpty)
        #expect(sample.isSample)
    }
}

@Test func mapsAServerPassageKeepingItsRevisionVerbatim() {
    let passage = MemorizePassage(
        server: Components.Schemas.MemoryPassage(
            id: 9, title: "Ode", category: "poem", body: "Hello there.", masteryLevel: 2, lastPracticedAt: nil,
            createdAt: nil, updatedAt: revision))
    #expect(passage.source == .server(id: 9, revision: revision))
    #expect(passage.id == "server:9")
    #expect(passage.serverMastery == 2)
    #expect(!passage.isSample)
}

@MainActor @Test func guestPlaysSamplesAndProgressStaysLocal() async throws {
    let store = try SQLiteStore.inMemory()
    let model = MemorizeModel(
        profile: store.guestProfile, store: store, sync: nil, source: FakeSource(result: .success([assigned])))
    await model.load()
    // The guest has no passage book; the server is never asked.
    #expect(!model.hasPassageBook)
    #expect(model.serverPassages.isEmpty)
    #expect(model.samples == MemorizePassage.samples)

    let observing = Task { await model.observeProgress() }
    defer { observing.cancel() }
    let sample = MemorizePassage.samples[0]
    await model.complete(sample, at: .medium)
    await eventually { model.mastery(of: sample) == 2 }
    #expect(model.mastery(of: sample) == 2)

    let events = try await store.events(for: store.guestProfile.id)
    #expect(events.map(\.kind) == [MemorizeSampleCompleted.kind])
}

@MainActor @Test func childCompletionIsRecordedForUploadAndMergedWithServerMastery() async throws {
    let store = try SQLiteStore.inMemory()
    let child = try await store.addChildProfile(remoteID: 42, displayName: "Ember")
    let model = MemorizeModel(profile: child, store: store, sync: nil, source: FakeSource(result: .success([assigned])))
    await model.load()
    #expect(model.loadState == .loaded)
    #expect(model.serverPassages == [assigned])
    #expect(model.samples.isEmpty)
    #expect(model.mastery(of: assigned) == 1)

    let observing = Task { await model.observeProgress() }
    defer { observing.cancel() }
    await model.complete(assigned, at: .hard)
    await eventually { model.mastery(of: assigned) == 3 }
    #expect(model.mastery(of: assigned) == 3)

    let pending = try await store.pendingEvents(for: child.id, kinds: [MemorizePassageCompleted.kind], limit: 10)
    #expect(try pending.map { try $0.decode(MemorizePassageCompleted.self) } == [
        MemorizePassageCompleted(passageID: 3, difficulty: "hard", body: assigned.body, revision: revision),
    ])

    // An edit is a new revision: what was recorded for the old one doesn't carry.
    var edited = assigned
    edited.source = .server(id: 3, revision: "2026-09-11T08:00:00.000Z")
    edited.serverMastery = 0
    #expect(model.mastery(of: edited) == 0)
}

@MainActor @Test func aBookThatWontOpenOffersSamplesAndRetries() async throws {
    let store = try SQLiteStore.inMemory()
    let child = try await store.addChildProfile(remoteID: 42, displayName: "Ember")
    let model = MemorizeModel(
        profile: child, store: store, sync: nil, source: FakeSource(result: .failure(.server(403))))
    await model.load()
    guard case .failed = model.loadState else {
        Issue.record("expected a failure, got \(model.loadState)")
        return
    }
    #expect(model.samples == MemorizePassage.samples)
}

@MainActor @Test func masteryLabelsMatchTheWeb() {
    #expect((0...3).map(MemorizeModel.masteryLabel) == [
        "Not completed", "Easy complete", "Medium complete", "Hard complete",
    ])
}
