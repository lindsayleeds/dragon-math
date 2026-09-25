import Store
import SwiftUI
import UIKit

/// The parent view's practice reminders: a list with on/off switches, and an
/// editor for the days, time and who a reminder is for.
struct PracticeRemindersView: View {
    @State private var model: PracticeRemindersModel
    @State private var editing: PracticeReminder?
    @Environment(\.scenePhase) private var scenePhase

    init(model: PracticeRemindersModel = .live()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        List {
            if model.isBlockedByPermission {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Notifications are off for Dragon Academy, so reminders can't appear.",
                              systemImage: "bell.slash")
                        if let settings = URL(string: UIApplication.openNotificationSettingsURLString) {
                            Link("Turn on in Settings", destination: settings)
                                .accessibilityIdentifier("reminders.openSettings")
                        }
                    }
                }
            }
            Section {
                ForEach(model.reminders) { reminder in
                    PracticeReminderRow(reminder: reminder) {
                        editing = reminder
                    } setEnabled: { isOn in
                        Task { await model.setEnabled(isOn, for: reminder.id) }
                    }
                }
                .onDelete { offsets in
                    let ids = offsets.map { model.reminders[$0].id }
                    Task { for id in ids { await model.delete(id) } }
                }
            } footer: {
                if !model.reminders.isEmpty {
                    Text("Reminders are notifications on this device only.")
                }
            }
        }
        .overlay {
            if model.reminders.isEmpty {
                ContentUnavailableView {
                    Label("No reminders", systemImage: "bell")
                } description: {
                    Text("Add a reminder to practice at the same time each week.")
                } actions: {
                    Button("Add reminder") { editing = .new() }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("reminders.addEmpty")
                }
            }
        }
        .navigationTitle("Practice reminders")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add reminder", systemImage: "plus") { editing = .new() }
                    .accessibilityIdentifier("reminders.add")
            }
        }
        .sheet(item: $editing) { reminder in
            PracticeReminderEditor(reminder: reminder, isNew: !model.contains(reminder.id)) { saved in
                Task { await model.save(saved) }
            } onDelete: {
                Task { await model.delete(reminder.id) }
            }
        }
        .task { await model.refresh() }
        .onChange(of: scenePhase) { _, phase in
            // Back from Settings with notifications turned on: schedule them.
            if phase == .active { Task { await model.refresh() } }
        }
        .accessibilityIdentifier("reminders")
    }
}

private struct PracticeReminderRow: View {
    let reminder: PracticeReminder
    let edit: () -> Void
    let setEnabled: (Bool) -> Void

    var body: some View {
        HStack {
            Button(action: edit) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(reminder.timeText)
                        .font(.title2.monospacedDigit())
                    Text(reminder.summaryText)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            Toggle("On", isOn: Binding(get: { reminder.isEnabled }, set: setEnabled))
                .labelsHidden()
                .accessibilityLabel(Text(reminder.timeText))
                .accessibilityIdentifier("reminders.toggle")
        }
    }
}

struct PracticeReminderEditor: View {
    @State private var reminder: PracticeReminder
    let isNew: Bool
    let onSave: (PracticeReminder) -> Void
    let onDelete: () -> Void

    @Environment(\.store) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var children: [PracticeReminder.Child] = []

    init(reminder: PracticeReminder, isNew: Bool,
         onSave: @escaping (PracticeReminder) -> Void, onDelete: @escaping () -> Void) {
        _reminder = State(initialValue: reminder)
        self.isNew = isNew
        self.onSave = onSave
        self.onDelete = onDelete
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("Reminder time", selection: time, displayedComponents: .hourAndMinute)
                        .accessibilityIdentifier("reminderEditor.time")
                }
                Section("Days") {
                    WeekdayPicker(selection: $reminder.weekdays)
                }
                if !pickableChildren.isEmpty {
                    Section {
                        Picker("For", selection: $reminder.child) {
                            Text("Whole family").tag(PracticeReminder.Child?.none)
                            ForEach(pickableChildren, id: \.profileID) { child in
                                Text(verbatim: child.name).tag(Optional(child))
                            }
                        }
                    }
                }
                if !isNew {
                    Section {
                        Button("Delete reminder", role: .destructive) {
                            onDelete()
                            dismiss()
                        }
                        .accessibilityIdentifier("reminderEditor.delete")
                    }
                }
            }
            .navigationTitle(isNew ? "New reminder" : "Edit reminder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(reminder)
                        dismiss()
                    }
                    .disabled(reminder.weekdays.isEmpty)
                    .accessibilityIdentifier("reminderEditor.save")
                }
            }
        }
        .task { await loadChildren() }
    }

    /// Children on this device, plus the reminder's own if it's since gone.
    private var pickableChildren: [PracticeReminder.Child] {
        guard let current = reminder.child, !children.contains(current) else { return children }
        return children + [current]
    }

    private var time: Binding<Date> {
        Binding {
            Calendar.current.date(from: DateComponents(hour: reminder.hour, minute: reminder.minute)) ?? .now
        } set: { date in
            let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
            reminder.hour = parts.hour ?? reminder.hour
            reminder.minute = parts.minute ?? reminder.minute
        }
    }

    private func loadChildren() async {
        guard let store, let profiles = try? await store.profiles() else { return }
        children = profiles
            .filter { $0.kind == .child }
            .map { PracticeReminder.Child(profileID: $0.id, name: $0.displayName) }
    }
}

/// Seven round day buttons, in the locale's week order.
private struct WeekdayPicker: View {
    @Binding var selection: Set<Int>

    var body: some View {
        HStack(spacing: 6) {
            ForEach(PracticeReminder.weekdayOrder, id: \.self) { weekday in
                let isOn = selection.contains(weekday)
                Button {
                    if isOn { selection.remove(weekday) } else { selection.insert(weekday) }
                } label: {
                    Text(verbatim: Calendar.current.veryShortWeekdaySymbols[weekday - 1])
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(isOn ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.tertiary), in: .circle)
                        .foregroundStyle(isOn ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: Calendar.current.weekdaySymbols[weekday - 1]))
                .accessibilityAddTraits(isOn ? .isSelected : [])
            }
        }
        .padding(.vertical, 4)
    }
}

extension PracticeReminder {
    /// Weekday numbers starting from the locale's first day of the week.
    static var weekdayOrder: [Int] {
        let first = Calendar.current.firstWeekday
        return (0..<7).map { (first - 1 + $0) % 7 + 1 }
    }

    var timeText: String {
        let date = Calendar.current.date(from: DateComponents(hour: hour, minute: minute)) ?? .now
        return date.formatted(date: .omitted, time: .shortened)
    }

    /// "Every day", or the short day names; then who it's for.
    var summaryText: String {
        let days = if weekdays.count == 7 {
            String(localized: "Every day", comment: "Practice reminder repeats on all seven days")
        } else {
            Self.weekdayOrder.filter(weekdays.contains)
                .map { Calendar.current.shortWeekdaySymbols[$0 - 1] }
                .formatted(.list(type: .and, width: .narrow))
        }
        guard let child else { return days }
        return String(localized: "\(days) · \(child.name)", comment: "Practice reminder days, then the child it's for")
    }
}

#Preview {
    NavigationStack {
        PracticeRemindersView(model: PracticeRemindersModel(
            storage: PracticeReminderStorage(defaults: UserDefaults(suiteName: "preview.reminders")!),
            scheduler: SystemNotificationScheduler()))
    }
}
