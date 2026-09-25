import Foundation
import OSLog

/// The parent's practice reminders and their pending notifications. Asks for
/// notification permission only when a reminder is switched on (or saved on),
/// never on appearing; if it's denied the reminders are kept, nothing is
/// scheduled, and the view points to Settings. `refresh()` puts the pending
/// requests back in step, e.g. after permission is turned on in Settings.
@MainActor
@Observable
final class PracticeRemindersModel {
    private(set) var reminders: [PracticeReminder]
    /// Nil until first checked.
    private(set) var authorization: NotificationAuthorization?

    private let storage: PracticeReminderStorage
    private let scheduler: any NotificationScheduler
    private let log = Logger(subsystem: "dev.placeholder.dragonacademy", category: "Reminders")

    init(storage: PracticeReminderStorage, scheduler: any NotificationScheduler) {
        self.storage = storage
        self.scheduler = scheduler
        reminders = storage.load()
    }

    static func live() -> PracticeRemindersModel {
        PracticeRemindersModel(storage: .standard, scheduler: SystemNotificationScheduler())
    }

    /// A reminder is on but notifications are off, so it can't appear.
    var isBlockedByPermission: Bool {
        authorization == .denied && reminders.contains(where: \.isEnabled)
    }

    func contains(_ id: PracticeReminder.ID) -> Bool {
        reminders.contains { $0.id == id }
    }

    /// Reads the permission (without asking) and, if allowed, replaces every
    /// pending reminder request with the enabled reminders'.
    func refresh() async {
        let status = await scheduler.authorization()
        authorization = status
        guard status == .allowed else { return }
        let stale = await scheduler.pendingRequestIdentifiers()
            .filter { $0.hasPrefix(PracticeReminder.identifierPrefix) }
        await scheduler.removePendingRequests(withIdentifiers: stale)
        for reminder in reminders where reminder.isEnabled {
            await schedule(reminder)
        }
    }

    /// Adds or replaces a reminder and reschedules it.
    func save(_ reminder: PracticeReminder) async {
        if let index = reminders.firstIndex(where: { $0.id == reminder.id }) {
            reminders[index] = reminder
        } else {
            reminders.append(reminder)
        }
        storage.save(reminders)
        await scheduler.removePendingRequests(withIdentifiers: PracticeReminder.identifiers(for: reminder.id))
        guard reminder.isEnabled, await ensureAuthorized() else { return }
        await schedule(reminder)
    }

    func setEnabled(_ isEnabled: Bool, for id: PracticeReminder.ID) async {
        guard var reminder = reminders.first(where: { $0.id == id }) else { return }
        reminder.isEnabled = isEnabled
        await save(reminder)
    }

    func delete(_ id: PracticeReminder.ID) async {
        reminders.removeAll { $0.id == id }
        storage.save(reminders)
        await scheduler.removePendingRequests(withIdentifiers: PracticeReminder.identifiers(for: id))
    }

    /// Asks the first time; after that the answer stands until Settings.
    private func ensureAuthorized() async -> Bool {
        var status = await scheduler.authorization()
        if status == .notDetermined {
            do {
                _ = try await scheduler.requestAuthorization()
            } catch {
                log.error("Notification permission request failed: \(error)")
            }
            status = await scheduler.authorization()
        }
        authorization = status
        return status == .allowed
    }

    private func schedule(_ reminder: PracticeReminder) async {
        for notification in reminder.notifications() {
            do {
                try await scheduler.add(notification)
            } catch {
                log.error("Couldn't schedule \(notification.id): \(error)")
            }
        }
    }
}
