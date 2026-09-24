import Foundation
import UserNotifications

/// Whether the app may show notifications, as far as reminders care.
enum NotificationAuthorization: Equatable, Sendable {
    /// Never asked. Asking shows the system prompt, once per install.
    case notDetermined
    /// Turned off, at the prompt or later in Settings. Only Settings can undo it.
    case denied
    /// Authorized, provisional or ephemeral: notifications will be delivered.
    case allowed
}

/// A local notification repeating every week at one weekday and time.
struct ScheduledNotification: Equatable, Sendable {
    var id: String
    var title: String
    var body: String
    /// `Calendar` numbering: 1 is Sunday, 7 is Saturday.
    var weekday: Int
    var hour: Int
    var minute: Int
}

/// The slice of `UNUserNotificationCenter` reminders use, swappable for a fake
/// so tests can see what was scheduled and that nothing asked for permission.
protocol NotificationScheduler: Sendable {
    /// The current setting. Never prompts.
    func authorization() async -> NotificationAuthorization
    /// Shows the system permission prompt (the first time only) and returns
    /// whether notifications are allowed.
    func requestAuthorization() async throws -> Bool
    /// Adds or replaces the pending request with this notification's id.
    func add(_ notification: ScheduledNotification) async throws
    func removePendingRequests(withIdentifiers identifiers: [String]) async
    func pendingRequestIdentifiers() async -> [String]
}

struct SystemNotificationScheduler: NotificationScheduler {
    private var center: UNUserNotificationCenter { .current() }

    func authorization() async -> NotificationAuthorization {
        switch await center.notificationSettings().authorizationStatus {
        case .notDetermined: .notDetermined
        case .denied: .denied
        default: .allowed
        }
    }

    func requestAuthorization() async throws -> Bool {
        try await center.requestAuthorization(options: [.alert, .sound])
    }

    func add(_ notification: ScheduledNotification) async throws {
        let content = UNMutableNotificationContent()
        content.title = notification.title
        content.body = notification.body
        content.sound = .default
        var when = DateComponents()
        when.weekday = notification.weekday
        when.hour = notification.hour
        when.minute = notification.minute
        let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: true)
        try await center.add(UNNotificationRequest(identifier: notification.id, content: content, trigger: trigger))
    }

    func removePendingRequests(withIdentifiers identifiers: [String]) async {
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
    }

    func pendingRequestIdentifiers() async -> [String] {
        await center.pendingNotificationRequests().map(\.identifier)
    }
}
