import Foundation
import Testing
@testable import DragonAcademy

/// Stands in for `UNUserNotificationCenter`: records permission prompts and
/// keeps pending requests by id, as the real center does.
final class FakeNotificationScheduler: NotificationScheduler, @unchecked Sendable {
    private let lock = NSLock()
    private var status: NotificationAuthorization
    /// What the person answers at the prompt.
    private let grants: Bool
    private var requests = 0
    private var pendingByID: [String: ScheduledNotification] = [:]

    init(status: NotificationAuthorization = .notDetermined, grants: Bool = true) {
        self.status = status
        self.grants = grants
    }

    var authorizationRequests: Int { lock.withLock { requests } }
    var pending: [ScheduledNotification] {
        lock.withLock { pendingByID.values.sorted { $0.id < $1.id } }
    }

    func setStatus(_ status: NotificationAuthorization) { lock.withLock { self.status = status } }
    func addStale(_ notification: ScheduledNotification) { lock.withLock { pendingByID[notification.id] = notification } }

    func authorization() async -> NotificationAuthorization { lock.withLock { status } }

    func requestAuthorization() async throws -> Bool {
        lock.withLock {
            requests += 1
            if status == .notDetermined { status = grants ? .allowed : .denied }
            return status == .allowed
        }
    }

    func add(_ notification: ScheduledNotification) async throws {
        lock.withLock { pendingByID[notification.id] = notification }
    }

    func removePendingRequests(withIdentifiers identifiers: [String]) async {
        lock.withLock { for id in identifiers { pendingByID[id] = nil } }
    }

    func pendingRequestIdentifiers() async -> [String] { lock.withLock { Array(pendingByID.keys) } }
}

@MainActor
private struct Harness {
    let defaults = UserDefaults(suiteName: "reminders.tests.\(UUID().uuidString)")!
    let scheduler: FakeNotificationScheduler
    let model: PracticeRemindersModel

    init(status: NotificationAuthorization = .notDetermined, grants: Bool = true) {
        scheduler = FakeNotificationScheduler(status: status, grants: grants)
        model = PracticeRemindersModel(storage: PracticeReminderStorage(defaults: defaults), scheduler: scheduler)
    }

    func reopened() -> PracticeRemindersModel {
        PracticeRemindersModel(storage: PracticeReminderStorage(defaults: defaults), scheduler: scheduler)
    }
}

private let reminderID = UUID(uuidString: "00000000-0000-0000-0000-0000000000A1")!

private func reminder(
    weekdays: Set<Int> = [2, 4, 6], hour: Int = 16, minute: Int = 30,
    child: PracticeReminder.Child? = nil, isEnabled: Bool = true
) -> PracticeReminder {
    PracticeReminder(id: reminderID, child: child, weekdays: weekdays, hour: hour, minute: minute, isEnabled: isEnabled)
}

@MainActor @Test func openingAndRefreshingNeverAsksForPermission() async {
    let h = Harness()
    await h.model.refresh()
    #expect(h.scheduler.authorizationRequests == 0)
    #expect(h.model.authorization == .notDetermined)
}

@MainActor @Test func savingAReminderThatIsOffNeverAsks() async {
    let h = Harness()
    await h.model.save(reminder(isEnabled: false))
    #expect(h.scheduler.authorizationRequests == 0)
    #expect(h.scheduler.pending.isEmpty)
    #expect(h.model.reminders.count == 1)
}

@MainActor @Test func turningTheFirstReminderOnAsksThenSchedulesOnePerWeekday() async {
    let h = Harness()
    await h.model.save(reminder(isEnabled: false))
    await h.model.setEnabled(true, for: reminderID)

    #expect(h.scheduler.authorizationRequests == 1)
    #expect(h.scheduler.pending == [2, 4, 6].map { day in
        ScheduledNotification(
            id: "practice-reminder.00000000-0000-0000-0000-0000000000A1.\(day)",
            title: "Practice time!", body: "Your dragons are ready when you are.",
            weekday: day, hour: 16, minute: 30)
    })
}

@MainActor @Test func onceAllowedLaterRemindersDontAskAgain() async {
    let h = Harness()
    await h.model.save(reminder())
    var second = PracticeReminder.new()
    second.weekdays = [1]
    await h.model.save(second)

    #expect(h.scheduler.authorizationRequests == 1)
    #expect(h.scheduler.pending.count == 4)
}

@MainActor @Test func deniedPermissionKeepsTheReminderButSchedulesNothing() async {
    let h = Harness(grants: false)
    await h.model.save(reminder())

    #expect(h.scheduler.pending.isEmpty)
    #expect(h.model.reminders.map(\.isEnabled) == [true])
    #expect(h.model.isBlockedByPermission)

    // Denied stays denied until Settings; don't prompt again (it wouldn't show).
    await h.model.setEnabled(false, for: reminderID)
    await h.model.setEnabled(true, for: reminderID)
    #expect(h.scheduler.authorizationRequests == 1)
}

@MainActor @Test func allowingInSettingsSchedulesOnTheNextRefresh() async {
    let h = Harness(status: .denied)
    await h.model.save(reminder())
    #expect(h.scheduler.pending.isEmpty)

    h.scheduler.setStatus(.allowed)
    await h.model.refresh()
    #expect(h.scheduler.pending.map(\.weekday) == [2, 4, 6])
    #expect(!h.model.isBlockedByPermission)
    #expect(h.scheduler.authorizationRequests == 0)
}

@MainActor @Test func turningOffRemovesItsRequests() async {
    let h = Harness(status: .allowed)
    await h.model.save(reminder())
    await h.model.setEnabled(false, for: reminderID)
    #expect(h.scheduler.pending.isEmpty)
}

@MainActor @Test func editingReplacesTheRequestsAndDropsRemovedDays() async {
    let h = Harness(status: .allowed)
    await h.model.save(reminder(weekdays: [2, 4, 6]))
    await h.model.save(reminder(weekdays: [3], hour: 7, minute: 5))

    #expect(h.scheduler.pending.map { [$0.weekday, $0.hour, $0.minute] } == [[3, 7, 5]])
    #expect(h.model.reminders.count == 1)
}

@MainActor @Test func deletingRemovesTheReminderAndItsRequests() async {
    let h = Harness(status: .allowed)
    await h.model.save(reminder())
    await h.model.delete(reminderID)
    #expect(h.scheduler.pending.isEmpty)
    #expect(h.model.reminders.isEmpty)
    #expect(h.reopened().reminders.isEmpty)
}

@MainActor @Test func remindersAreKeptOnTheDevice() async {
    let h = Harness(status: .allowed)
    let child = PracticeReminder.Child(profileID: UUID(), name: "Ada")
    await h.model.save(reminder(child: child))
    #expect(h.reopened().reminders == [reminder(child: child)])
}

@MainActor @Test func aChildsReminderNamesThem() async {
    let h = Harness(status: .allowed)
    await h.model.save(reminder(weekdays: [7], child: .init(profileID: UUID(), name: "Ada")))
    #expect(h.scheduler.pending.map(\.title) == ["Practice time, Ada!"])
}

@MainActor @Test func refreshReplacesStaleReminderRequestsOnly() async {
    let h = Harness(status: .allowed)
    await h.model.save(reminder(weekdays: [2]))
    let orphan = ScheduledNotification(id: "practice-reminder.gone.3", title: "", body: "", weekday: 3, hour: 1, minute: 1)
    let other = ScheduledNotification(id: "something-else", title: "", body: "", weekday: 3, hour: 1, minute: 1)
    h.scheduler.addStale(orphan)
    h.scheduler.addStale(other)

    await h.model.refresh()
    #expect(h.scheduler.pending.map(\.id) == [
        "practice-reminder.00000000-0000-0000-0000-0000000000A1.2", "something-else",
    ])
}

@Test func weekdayOrderCoversEveryDayOnce() {
    #expect(Set(PracticeReminder.weekdayOrder) == Set(1...7))
    #expect(PracticeReminder.weekdayOrder.first == Calendar.current.firstWeekday)
}
