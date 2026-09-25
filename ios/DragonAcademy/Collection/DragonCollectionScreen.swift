import GameRules
import Store
import SwiftUI

/// "My Dragon Den": every dragon the kid playing has caught, and numbered
/// empty slots for the ones still to find, grouped by rarity. The SwiftUI twin
/// of src/pages/DragonCollectionPage.jsx; the grouping is `DragonCollection`.
/// Everything comes from the Store, so the Den works offline.
struct DragonCollectionScreen: View {
    @Environment(\.store) private var store
    @Environment(\.currentProfile) private var profile
    @Environment(\.dismiss) private var dismiss
    @State private var collection: DragonCollection?

    var body: some View {
        ZStack {
            PaperBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button(action: { dismiss() }) {
                        Text("⌂ map")
                    }
                    .buttonStyle(StampButtonStyle(kind: .secondary))
                    .accessibilityLabel(Text("Return to the map"))
                    .accessibilityIdentifier("den.back")
                    title
                    if let collection {
                        summary(collection)
                        ForEach(collection.sections) { section in
                            DenSection(section: section)
                        }
                    } else {
                        Text("counting your dragons…")
                            .font(Typeface.body(17, relativeTo: .body))
                            .foregroundStyle(Palette.pencil)
                    }
                }
                .padding(16)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .task(id: profile?.id) {
            guard let store, let profile else { return }
            let catalog = await PrizeDragon.syncedCatalog(from: store)
            do {
                // Live, so a prize synced in from another device shows up.
                for try await progress in store.observeProgress(for: profile.id) {
                    collection = DragonCollection(catalog: catalog, owned: progress.dragons)
                }
            } catch {
                // The stream only ends in error if the database does; keep
                // what's shown, or show the album empty.
                if collection == nil { collection = DragonCollection(catalog: catalog, owned: [:]) }
            }
        }
    }

    private var title: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Text(verbatim: "🐉").font(.system(size: 34)).accessibilityHidden(true)
                Text("My Dragon Den")
                    .font(Typeface.display(36, relativeTo: .largeTitle))
                    .rotationEffect(.degrees(-1))
            }
            Text("— every dragon you’ve hatched")
                .font(Typeface.body(18, relativeTo: .headline))
                .foregroundStyle(Palette.kraftDark)
        }
        .foregroundStyle(Palette.charcoal)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private func summary(_ collection: DragonCollection) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(verbatim: "\(collection.ownedCount)")
                .font(Typeface.display(40, relativeTo: .largeTitle))
            Text(verbatim: "/ \(collection.total)")
                .font(Typeface.display(24, relativeTo: .title2))
                .foregroundStyle(Palette.kraftDark)
            Text("dragons collected")
                .font(Typeface.body(17, relativeTo: .body))
                .foregroundStyle(Palette.pencil)
        }
        .foregroundStyle(Palette.charcoal)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .paperCard(rotation: -0.4)
        .overlay(alignment: .top) { WashiTape(color: Palette.mustard).offset(y: -9) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(collection.ownedCount) of \(collection.total) dragons collected"))
        .accessibilityIdentifier("den.summary")
    }
}

/// One rarity: its header and its slots.
private struct DenSection: View {
    let section: DragonCollection.Section

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Circle().fill(section.rarity.color).frame(width: 12, height: 12).accessibilityHidden(true)
                Text(section.rarity.label)
                    .font(Typeface.display(24, relativeTo: .title2))
                    .foregroundStyle(section.rarity.textColor)
                Spacer()
                Text(verbatim: "\(section.ownedCount) / \(section.slots.count)")
                    .font(Typeface.body(16, relativeTo: .callout))
                    .foregroundStyle(Palette.pencil)
                    .monospacedDigit()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("\(String(localized: section.rarity.label)): \(section.ownedCount) of \(section.slots.count)"))
            .accessibilityAddTraits(.isHeader)
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 96, maximum: DragonArt.maxPoints), spacing: 10)],
                spacing: 10
            ) {
                ForEach(section.slots) { slot in
                    if slot.isOwned {
                        OwnedSlot(slot: slot, rarity: section.rarity)
                    } else {
                        MissingSlot(slot: slot, rarity: section.rarity)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("den.section.\(section.rarity.key)")
    }
}

/// A caught dragon: its art in the rarity's frame, its name, how many.
private struct OwnedSlot: View {
    let slot: DragonCollection.Slot
    let rarity: PrizeRarity

    var body: some View {
        VStack(spacing: 3) {
            DragonArtView(dragonID: slot.dragonID)
                .padding(4)
                .aspectRatio(1, contentMode: .fit)
                .frame(maxWidth: DragonArt.maxPoints)
                .background(rarity.color.opacity(0.14))
                .overlay(Rectangle().strokeBorder(rarity.color, lineWidth: 2.5))
                .overlay(alignment: .topTrailing) {
                    if slot.count > 1 {
                        Text(verbatim: "×\(slot.count)")
                            .font(Typeface.display(14, relativeTo: .caption))
                            .foregroundStyle(Color.white)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(rarity.textColor)
                            .offset(x: 4, y: -6)
                    }
                }
            Text(verbatim: name)
                .font(Typeface.body(13, relativeTo: .caption))
                .foregroundStyle(Palette.charcoal)
                .lineLimit(2)
                .multilineTextAlignment(.center)
            Text(rarity.label)
                .font(Typeface.display(12, relativeTo: .caption2))
                .foregroundStyle(rarity.textColor)
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(slot.count > 1
            ? Text("\(String(localized: rarity.label)) dragon, \(name), you have \(slot.count)")
            : Text("\(String(localized: rarity.label)) dragon, \(name)"))
        .accessibilityIdentifier("den.dragon.\(slot.dragonID)")
    }

    private var name: String {
        slot.name ?? String(localized: "Dragon #\(slot.dragonID)")
    }
}

/// A dragon still to find: a numbered empty slot, nothing more.
private struct MissingSlot: View {
    let slot: DragonCollection.Slot
    let rarity: PrizeRarity

    var body: some View {
        Rectangle()
            .fill(Color.white.opacity(0.3))
            .strokeBorder(rarity.color.opacity(0.6), style: StrokeStyle(lineWidth: 2, dash: [5, 4]))
            .aspectRatio(1, contentMode: .fit)
            .frame(maxWidth: DragonArt.maxPoints)
            .overlay {
                Text(verbatim: "\(slot.numberInRarity)")
                    .font(Typeface.display(22, relativeTo: .title3))
                    .foregroundStyle(rarity.textColor.opacity(0.55))
            }
            .frame(maxWidth: .infinity, alignment: .top)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("\(String(localized: rarity.label)) dragon #\(slot.numberInRarity), not collected yet"))
            .accessibilityIdentifier("den.missing.\(slot.dragonID)")
    }
}

/// The map header's way into the Den.
struct DragonDenButton: View {
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("🐉 Den")
                .lineLimit(1)
                .fixedSize()
        }
        .buttonStyle(StampButtonStyle(kind: .secondary))
        .accessibilityLabel(Text("My Dragon Den"))
        .accessibilityHint(Text("Every dragon you’ve collected."))
        .accessibilityIdentifier("home.dragonDen")
    }
}
