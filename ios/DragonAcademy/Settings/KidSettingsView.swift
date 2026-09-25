import Audio
import SwiftUI

/// The kid's own Settings: things a kid may change without a grown-up. For
/// now the sound effects switch; the font picker (#166) joins it here.
struct KidSettingsView: View {
    @Bindable var sound: SoundSettings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle(isOn: $sound.effectsEnabled) {
                        Label("Sound effects", systemImage: "speaker.wave.2.fill")
                    }
                    .accessibilityIdentifier("settings.soundEffects")
                } footer: {
                    Text("Cheers and growls in games. Spoken words always play.")
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
}

/// Opens `KidSettingsView`. Shown only when the app has an `AudioPlayer`.
struct KidSettingsButton: View {
    @Environment(\.audio) private var audio
    @State private var showing = false

    var body: some View {
        if let audio {
            Button {
                showing = true
            } label: {
                Image(systemName: "gearshape.fill")
            }
            .buttonStyle(StampButtonStyle(kind: .secondary))
            .accessibilityLabel(Text("Settings"))
            .accessibilityIdentifier("map.settings")
            .sheet(isPresented: $showing) {
                KidSettingsView(sound: audio.settings)
            }
        }
    }
}

#Preview {
    KidSettingsView(sound: SoundSettings(defaults: UserDefaults(suiteName: "preview")!))
}
