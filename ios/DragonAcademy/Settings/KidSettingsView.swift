import Audio
import OSLog
import Store
import SwiftUI
import Sync

/// The kid's own Settings: things a kid may change without a grown-up — the
/// sound effects switch and the font the kid screens read in.
struct KidSettingsView: View {
    /// Nil without an `AudioPlayer` (previews, tests): no sound section.
    var sound: SoundSettings?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.store) private var store
    @Environment(\.sync) private var sync
    @Environment(\.currentProfile) private var profile
    @Environment(\.fontTheme) private var current

    var body: some View {
        NavigationStack {
            Form {
                if let sound {
                    SoundSection(sound: sound)
                }
                if store != nil, profile != nil {
                    Section {
                        ForEach(FontTheme.all) { theme in
                            FontThemeRow(theme: theme, chosen: theme == current) { choose(theme) }
                        }
                    } header: {
                        Text("Font")
                    } footer: {
                        Text("The letters and numbers in your games.")
                    }
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("settings.done")
                }
            }
        }
    }

    private func choose(_ theme: FontTheme) {
        guard let store, let profile else { return }
        let sync = sync
        Task {
            do {
                try await FontChoice.choose(theme, in: store, for: profile.id, requestSync: { sync?.requestSync() })
            } catch {
                Logger(subsystem: "dev.placeholder.dragonacademy", category: "Settings")
                    .error("Couldn't record font \(theme.id): \(error)")
            }
        }
    }
}

private struct SoundSection: View {
    @Bindable var sound: SoundSettings

    var body: some View {
        Section {
            Toggle(isOn: $sound.effectsEnabled) {
                Label("Sound effects", systemImage: "speaker.wave.2.fill")
            }
            .accessibilityIdentifier("settings.soundEffects")
        } footer: {
            Text("Cheers and growls in games. Spoken words always play.")
        }
    }
}

/// One theme, drawn in itself: its name in the display family and a sample
/// in the body family.
private struct FontThemeRow: View {
    let theme: FontTheme
    let chosen: Bool
    let onChoose: () -> Void

    var body: some View {
        Button(action: onChoose) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: theme.label)
                        .font(Typeface.display(22, relativeTo: .title3))
                    Text("Dragons love 3 × 4 = 12!")
                        .font(Typeface.body(17))
                        .foregroundStyle(Palette.pencil)
                }
                Spacer()
                if chosen {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Palette.sage)
                        .fontWeight(.bold)
                }
            }
            .foregroundStyle(Palette.charcoal)
            .contentShape(Rectangle())
        }
        .environment(\.fontTheme, theme)
        .accessibilityAddTraits(chosen ? .isSelected : [])
        .accessibilityIdentifier("settings.font.\(theme.id)")
    }
}

/// Opens `KidSettingsView`. Shown when there is something to set: sound
/// (the app has an `AudioPlayer`) or a font (a profile is playing).
struct KidSettingsButton: View {
    @Environment(\.audio) private var audio
    @Environment(\.store) private var store
    @Environment(\.currentProfile) private var profile
    @State private var showing = false

    var body: some View {
        if audio != nil || (store != nil && profile != nil) {
            Button {
                showing = true
            } label: {
                Image(systemName: "gearshape.fill")
            }
            .buttonStyle(StampButtonStyle(kind: .secondary))
            .accessibilityLabel(Text("Settings"))
            .accessibilityIdentifier("map.settings")
            .sheet(isPresented: $showing) {
                KidSettingsView(sound: audio?.settings)
            }
        }
    }
}

#Preview {
    KidSettingsView(sound: SoundSettings(defaults: UserDefaults(suiteName: "preview")!))
}
