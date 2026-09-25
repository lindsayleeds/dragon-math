import Foundation

/// A weekly practice nudge a parent sets on this device: some weekdays at one
/// time, for the whole family or one child. Nothing about it leaves the device.
struct PracticeReminder: Codable, Identifiable, Hashable, Sendable {
    /// The child a reminder names; nil on the reminder means the whole family.
    struct Child: Codable, Hashable, Sendable {
        /// The Store profile id.
        var profileID: UUID
        var name: String
    }

    var id: UUID
    var child: Child?
    /// `Calendar` numbering: 1 is Sunday, 7 is Saturday.
    var weekdays: Set<Int>
    var hour: Int
    var minute: Int
    var isEnabled: Bool

    /// What the Add button starts from: school days after school, switched on.
    static func new(id: UUID = UUID()) -> Self {
        Self(id: id, child: nil, weekdays: [2, 3, 4, 5, 6], hour: 16, minute: 0, isEnabled: true)
    }

    /// Every pending request id reminders use starts with this.
    static let identifierPrefix = "practice-reminder."

    /// One request per weekday, since a calendar trigger matches one weekday.
    /// Covers all seven so removing works after days are dropped.
    static func identifiers(for id: UUID) -> [String] {
        (1...7).map { identifier(for: id, weekday: $0) }
    }

    static func identifier(for id: UUID, weekday: Int) -> String {
        "\(identifierPrefix)\(id.uuidString).\(weekday)"
    }

    /// The requests to schedule while the reminder is on.
    func notifications() -> [ScheduledNotification] {
        let title = if let child {
            String(localized: "Practice time, \(child.name)!", comment: "Practice reminder notification title for one child")
        } else {
            String(localized: "Practice time!", comment: "Practice reminder notification title for the family")
        }
        let body = String(localized: "Your dragons are ready when you are.", comment: "Practice reminder notification body")
        return weekdays.sorted().map { weekday in
            ScheduledNotification(
                id: Self.identifier(for: id, weekday: weekday),
                title: title, body: body,
                weekday: weekday, hour: hour, minute: minute)
        }
    }
}

/// The parent's reminders, as JSON in `UserDefaults`. Device-only settings,
/// not play history, so they stay out of the Store's event log.
struct PracticeReminderStorage {
    static let key = "practiceReminders.v1"

    let defaults: UserDefaults

    static var standard: Self { Self(defaults: .standard) }

    func load() -> [PracticeReminder] {
        guard let data = defaults.data(forKey: Self.key) else { return [] }
        return (try? JSONDecoder().decode([PracticeReminder].self, from: data)) ?? []
    }

    func save(_ reminders: [PracticeReminder]) {
        guard let data = try? JSONEncoder().encode(reminders) else { return }
        defaults.set(data, forKey: Self.key)
    }
}
