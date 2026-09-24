import Foundation
import Testing
@testable import DragonAcademy

@Test func readsTheExpiryFromTheJWT() {
    let exp = Date(timeIntervalSince1970: 1_900_000_000)
    let session = ParentSession(token: fakeJWT(exp: exp))
    #expect(session.expiresAt == exp)
    #expect(!session.isExpired(now: exp.addingTimeInterval(-1)))
    #expect(session.isExpired(now: exp))
}

@Test func anUnreadableTokenIsLeftToTheServer() {
    #expect(ParentSession(token: "not-a-jwt").expiresAt == nil)
    #expect(!ParentSession(token: "a.%%%.c").isExpired())
}

@Test func inMemoryStoreRoundTrips() throws {
    let store = InMemoryParentSessionStore()
    #expect(try store.load() == nil)
    try store.save(ParentSession(token: "one"))
    try store.save(ParentSession(token: "two"))
    #expect(try store.load() == ParentSession(token: "two"))
    try store.clear()
    #expect(try store.load() == nil)
}

/// The real Keychain, under a throwaway service so the app's item is untouched.
@Test func keychainStoreRoundTripsAndOverwrites() throws {
    let store = KeychainParentSessionStore(service: "dragonacademy.tests.\(UUID().uuidString)")
    defer { try? store.clear() }
    #expect(try store.load() == nil)
    try store.save(ParentSession(token: "first"))
    try store.save(ParentSession(token: "second"))
    #expect(try store.load() == ParentSession(token: "second"))
    // A second instance (a later launch) reads the same item.
    #expect(try KeychainParentSessionStore(service: store.service).load() == ParentSession(token: "second"))
    try store.clear()
    #expect(try store.load() == nil)
    try store.clear()
}

@Test func baseURLComesFromInfoPlistWithALocalFallback() {
    #expect(AppConfiguration.baseURL(from: "https://dragon.example") == URL(string: "https://dragon.example"))
    #expect(AppConfiguration.baseURL(from: nil) == AppConfiguration.fallbackBaseURL)
    #expect(AppConfiguration.baseURL(from: "") == AppConfiguration.fallbackBaseURL)
    #expect(AppConfiguration.baseURL(from: "$(DRAGON_API_BASE_URL)") == AppConfiguration.fallbackBaseURL)
    #expect(AppConfiguration.fallbackBaseURL.absoluteString == "http://localhost:3001")
}

@Test func theBuiltAppCarriesTheBaseURLSetting() {
    #expect(Bundle.main.object(forInfoDictionaryKey: "DragonAPIBaseURL") as? String == "http://localhost:3001")
}
