import Store
import SwiftUI

/// A child's "Share play details" switch in the parent view. Off, Sync still
/// uploads their progress (map wins, dragons, medals, memorize) but not how
/// they played: answers, wrong taps, matches and playtime (the server kind
/// list is `SyncKinds.telemetry`).
struct TelemetryToggle: View {
    let model: FamilyModel
    let child: Profile

    var body: some View {
        let childID = child.remoteID ?? 0
        VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: sharing) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Share play details")
                    Text("Answers, mistakes and play time, for your stats. Progress always syncs.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .disabled(child.remoteID == nil || model.savingTelemetry.contains(childID))
            .accessibilityIdentifier("family.telemetry.\(childID)")

            if let failed = model.telemetryNotice, failed.childID == childID,
                let message = FamilyNoticeText.message(for: failed.notice)
            {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("family.telemetry.\(childID).notice")
            }
        }
        .padding(.horizontal, 12)
    }

    /// On while telemetry is shared, i.e. not opted out.
    private var sharing: Binding<Bool> {
        Binding(
            get: { !child.telemetryOptOut },
            set: { share in
                Task { await model.setTelemetryOptOut(!share, for: child) }
            })
    }
}
