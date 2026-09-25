import GameRules
import SwiftUI

/// The dragon prize on a won battle's result card: a wiggling egg while the
/// draw is prepared, then one card per dragon popping in turn, with the web's
/// "NEW!" ribbon for a first catch and "Now ×N" for a repeat. Follows
/// src/components/DragonPrizeReveal.jsx and DragonPrizeReveal.module.css.
struct PrizeReveal: View {
    let prize: PrizeState

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var wiggle = false

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Text(verbatim: "🎁")
                    .rotationEffect(.degrees(reduceMotion ? 0 : (wiggle ? 6 : -6)))
                    .accessibilityHidden(true)
                heading
            }
            .font(Typeface.display(20, relativeTo: .title3))
            .foregroundStyle(Palette.kraftDark)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("prize.heading")

            switch prize {
            case .none, .opening:
                Text(verbatim: "🥚")
                    .font(.system(size: 52))
                    .rotationEffect(.degrees(reduceMotion ? 0 : (wiggle ? 8 : -8)))
                    .frame(minHeight: 96)
                    .accessibilityHidden(true)
            case .revealed(let cards):
                cardRow(cards)
                if cards.contains(where: \.isNew) {
                    Text("✨ New dragon added to your Den!")
                        .font(Typeface.body(16, relativeTo: .callout))
                        .foregroundStyle(Palette.pencil)
                }
            }
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { wiggle = true }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("prize")
    }

    @ViewBuilder private var heading: some View {
        switch prize {
        case .revealed(let cards):
            if cards.count == 1 {
                Text("You won a dragon!")
            } else {
                Text("You won \(cards.count) dragons!")
            }
        default:
            Text("Opening your dragon prize…")
        }
    }

    private func cardRow(_ cards: [PrizeCard]) -> some View {
        // Three cards fit side by side at the card's width; more wrap. At the
        // accessibility text sizes each card gets a row, wide enough for its
        // words (#168).
        let large = dynamicTypeSize.isAccessibilitySize
        let perRow = large ? 1 : 3
        let rows = stride(from: 0, to: cards.count, by: perRow).map {
            Array(cards[$0..<min($0 + perRow, cards.count)])
        }
        return VStack(spacing: 12) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(spacing: 12) {
                    ForEach(rows[r]) { card in
                        PrizeCardView(card: card, delay: Double(card.id) * 0.26, width: large ? 220 : 92)
                    }
                }
            }
        }
    }
}

/// One dragon: its art in a rarity frame, the rarity, the name if it has one.
private struct PrizeCardView: View {
    let card: PrizeCard
    let delay: Double
    var width: CGFloat = 92

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        let rarity = PrizeRarity(key: card.dragon.drawnRarity)
        VStack(spacing: 3) {
            DragonArtView(dragonID: card.dragon.dragonID)
                .padding(4)
                .frame(width: 72, height: 72)
                .background(rarity.color.opacity(0.18))
                .overlay(Rectangle().strokeBorder(rarity.color, lineWidth: 2.5))
                .shadow(color: card.isNew ? rarity.color.opacity(0.7) : .clear, radius: 8)
                .accessibilityHidden(true)
            Text(rarity.label)
                .font(Typeface.display(13, relativeTo: .caption))
                .foregroundStyle(rarity.textColor)
            if let name = card.dragon.name {
                Text(verbatim: name)
                    .font(Typeface.body(13, relativeTo: .caption))
                    .foregroundStyle(Palette.charcoal)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            if !card.isNew {
                Text("Now ×\(card.total)")
                    .font(Typeface.body(13, relativeTo: .caption))
                    .foregroundStyle(Palette.pencil)
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 6)
        .padding(.bottom, 8)
        .frame(width: width)
        .background(Color.white.opacity(0.55))
        .overlay(Rectangle().strokeBorder(Palette.kraftDark.opacity(0.4), lineWidth: 1.5))
        .shadow(color: Palette.charcoal.opacity(0.1), radius: 0, x: 2, y: 3)
        .overlay(alignment: .topTrailing) {
            if card.isNew {
                Text("NEW!")
                    .font(Typeface.display(12, relativeTo: .caption2))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Palette.roseInk)
                    .rotationEffect(.degrees(12))
                    .offset(x: 10, y: -8)
            }
        }
        .rotationEffect(.degrees(card.id.isMultiple(of: 2) ? -1.5 : 1.8))
        .scaleEffect(shown || reduceMotion ? 1 : 0.6)
        .opacity(shown ? 1 : 0)
        .onAppear {
            let animation: Animation = reduceMotion ? .easeOut(duration: 0.2) : .spring(duration: 0.42, bounce: 0.4)
            withAnimation(animation.delay(delay)) { shown = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel(rarity))
        .accessibilityIdentifier("prize.card.\(card.id)")
    }

    private func accessibilityLabel(_ rarity: PrizeRarity) -> Text {
        let label = String(localized: rarity.label)
        let what = card.dragon.name.map { String(localized: "\(label) dragon, \($0)") }
            ?? String(localized: "\(label) dragon")
        return card.isNew ? Text("\(what), new!") : Text("\(what), you have \(card.total)")
    }
}

/// A rarity's label and colour, as src/data/dragonRarity.js's RARITIES. An
/// unknown key shows as common, as `rarityMeta` does.
struct PrizeRarity: Equatable {
    let key: String

    /// Weakest to strongest, as RARITIES.
    static let keys = ["common", "uncommon", "rare", "very_rare", "legendary", "mythic"]

    init(key: String) {
        self.key = Self.keys.contains(key) ? key : "common"
    }

    var label: LocalizedStringResource {
        switch key {
        case "uncommon": "Uncommon"
        case "rare": "Rare"
        case "very_rare": "Very Rare"
        case "legendary": "Legendary"
        case "mythic": "Mythic"
        default: "Common"
        }
    }

    var color: Color {
        switch key {
        case "uncommon": Color(hex: 0x4CAF72)
        case "rare": Color(hex: 0x3D8BDF)
        case "very_rare": Color(hex: 0x9B59D0)
        case "legendary": Color(hex: 0xE8A317)
        case "mythic": Color(hex: 0xE0457B)
        default: Color(hex: 0x8D9AA5)
        }
    }

    /// The rarity colour darkened for text on cream, so small labels keep
    /// their contrast.
    var textColor: Color {
        switch key {
        case "uncommon": Color(hex: 0x2E7A4C)
        case "rare": Color(hex: 0x2461A8)
        case "very_rare": Color(hex: 0x7440A3)
        case "legendary": Color(hex: 0x8F6100)
        case "mythic": Color(hex: 0xB02A5A)
        default: Color(hex: 0x5C6873)
        }
    }
}
