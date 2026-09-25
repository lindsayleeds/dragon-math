import Foundation

/// A kid's plan as the server last reported it, and when it was read.
struct CachedPlanStatus: Codable, Equatable, Sendable {
    /// free, premium or classroom (free text, like the server's).
    let plan: String
    let fetchedAt: Date

    /// Premium or better. Classroom includes everything Premium does.
    var isPremium: Bool { plan == "premium" || plan == "classroom" }
}

/// The last plan status read for each kid on the device, keyed by the kid's
/// server id, so premium holds while the device is offline (see
/// `PremiumAccess.offlineGrace`). Each kid's status already carries their
/// family's plan (the best among all their guardians), so this is the
/// family's plan, per kid.
///
/// A device setting rather than play history, so it lives in `UserDefaults`
/// like the practice reminders, not in the Store.
protocol PlanStatusCache: Sendable {
    func load() -> [Int: CachedPlanStatus]
    func save(_ statuses: [Int: CachedPlanStatus])
}

/// The app's cache, as JSON in `UserDefaults`.
struct UserDefaultsPlanStatusCache: PlanStatusCache, @unchecked Sendable {
    static let key = "planStatusCache.v1"

    let defaults: UserDefaults

    static var standard: Self { Self(defaults: .standard) }

    func load() -> [Int: CachedPlanStatus] {
        guard let data = defaults.data(forKey: Self.key),
              let stored = try? JSONDecoder().decode([String: CachedPlanStatus].self, from: data)
        else { return [:] }
        return Dictionary(uniqueKeysWithValues: stored.compactMap { key, value in Int(key).map { ($0, value) } })
    }

    func save(_ statuses: [Int: CachedPlanStatus]) {
        let stored = Dictionary(uniqueKeysWithValues: statuses.map { (String($0.key), $0.value) })
        guard let data = try? JSONEncoder().encode(stored) else { return }
        defaults.set(data, forKey: Self.key)
    }
}

/// Kept in memory only; for previews, `-ParentAccessFakes` and tests.
final class InMemoryPlanStatusCache: PlanStatusCache, @unchecked Sendable {
    private let lock = NSLock()
    private var statuses: [Int: CachedPlanStatus]

    init(_ statuses: [Int: CachedPlanStatus] = [:]) { self.statuses = statuses }

    func load() -> [Int: CachedPlanStatus] { lock.withLock { statuses } }

    func save(_ statuses: [Int: CachedPlanStatus]) { lock.withLock { self.statuses = statuses } }
}
