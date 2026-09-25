import GameRules
import Store
import SwiftUI

/// A child's "Game timers" setting in the parent view (#167): how fast the
/// clocks they race against run in battles and Dragon Munchers. Saved on the
/// server (so the kid's other devices learn it with their next sync) and on
/// this device, which is what the games read (`PlayPace`).
struct GamePacePicker: View {
    let model: FamilyModel
    let child: Profile

    var body: some View {
        let childID = child.remoteID ?? 0
        VStack(alignment: .leading, spacing: 6) {
            Text("Game timers")
            Picker("Game timers", selection: pace) {
                ForEach(GamePace.allCases, id: \.self) { pace in
                    Text(Self.name(pace)).tag(pace)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .disabled(child.remoteID == nil || model.savingPace.contains(childID))
            .accessibilityIdentifier("family.pace.\(childID)")

            Text(Self.explanation(child.pace))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("family.pace.\(childID).explanation")

            if let failed = model.paceNotice, failed.childID == childID,
                let message = FamilyNoticeText.message(for: failed.notice)
            {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("family.pace.\(childID).notice")
            }
        }
        .padding(.horizontal, 12)
    }

    private var pace: Binding<GamePace> {
        Binding(
            get: { child.pace },
            set: { pace in
                Task { await model.setGamePace(pace, for: child) }
            })
    }

    static func name(_ pace: GamePace) -> LocalizedStringKey {
        switch pace {
        case .normal: "Normal"
        case .slow: "Slower"
        case .off: "No timers"
        }
    }

    static func explanation(_ pace: GamePace) -> LocalizedStringKey {
        switch pace {
        case .normal:
            "The dragon in battles and the Munchers monsters move at full speed."
        case .slow:
            "The dragon in battles and the Munchers monsters move at half speed."
        case .off:
            "No racing: the dragon in battles never answers, and Munchers has no monsters."
        }
    }
}
