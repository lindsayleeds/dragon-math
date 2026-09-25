/// Every foreground/background pair the kid screens draw, with the WCAG level
/// it must meet (#169). ThemeContrastTests fails if one drops below it, so a
/// new text colour, or text on a new fill, gets a line here.
///
/// The crayon fills (`rose`, `sage`, `sky`, `mustard`, `lavender`) are only
/// ~2:1 on paper: they carry charcoal text but aren't text colours
/// themselves. Text and icons in those hues use `roseInk`/`sageInk`.
enum ThemeContrast {
    typealias H = Palette.Hex

    /// The cream surfaces text sits on.
    static let papers: [(String, UInt32)] = [
        ("paper", H.paper), ("paperDeep", H.paperDeep), ("cardTop", H.cardTop), ("cardBottom", H.cardBottom),
    ]

    static let pairs: [ContrastPair] = paperText + onFills + feedback + games

    /// The brand's inks on every paper.
    static let paperText: [ContrastPair] = papers.flatMap { name, bg in
        [
            ContrastPair(name: "charcoal on \(name)", foreground: H.charcoal, background: bg, level: .text),
            ContrastPair(name: "pencil on \(name)", foreground: H.pencil, background: bg, level: .text),
            ContrastPair(name: "kraftDark on \(name)", foreground: H.kraftDark, background: bg, level: .text),
            ContrastPair(name: "roseInk on \(name)", foreground: H.roseInk, background: bg, level: .text),
            ContrastPair(name: "sageInk on \(name)", foreground: H.sageInk, background: bg, level: .text),
            // Dashed kraft borders, and the empty Trial stars.
            ContrastPair(name: "kraft border on \(name)", foreground: H.kraft, background: bg, level: .large),
        ]
    }

    /// Text on the crayon fills: button labels (22pt bold display), map
    /// labels, badges.
    static let onFills: [ContrastPair] = [
        ContrastPair(name: "primary button: charcoal on sage", foreground: H.charcoal, background: H.sage, level: .large),
        ContrastPair(name: "charcoal on rose", foreground: H.charcoal, background: H.rose, level: .large),
        ContrastPair(name: "charcoal on mustard", foreground: H.charcoal, background: H.mustard, level: .text),
        ContrastPair(name: "charcoal on lavender", foreground: H.charcoal, background: H.lavender, level: .text),
        ContrastPair(name: "charcoal on sky", foreground: H.charcoal, background: H.sky, level: .text),
        ContrastPair(name: "charcoal on paperRule", foreground: H.charcoal, background: H.paperRule, level: .text),
        ContrastPair(name: "quit buttons, NEW! badge: white on roseInk", foreground: H.white, background: H.roseInk, level: .text),
        ContrastPair(name: "map won stamp: charcoal on mustard", foreground: H.charcoal, background: H.mustard, level: .large),
        ContrastPair(name: "Spelling chosen grade: cardTop on sageInk", foreground: H.cardTop, background: H.sageInk, level: .text),
        ContrastPair(name: "filled star outline: kraftDark on cardBottom", foreground: H.kraftDark, background: H.cardBottom, level: .large),
    ]

    /// The right/wrong marks and tints.
    static let feedback: [ContrastPair] = AnswerFeedback.allCases.flatMap { f in
        papers.map { name, bg in
            ContrastPair(name: "\(f) mark on \(name)", foreground: f.tintHex, background: bg, level: .large)
        } + [
            ContrastPair(name: "\(f) mark on white", foreground: f.tintHex, background: H.white, level: .large),
            ContrastPair(name: "\(f) mark glyph: white on its disc", foreground: H.white, background: f.tintHex, level: .large),
        ]
    } + [
        ContrastPair(
            name: "battle wrong cell: number on rose 25%",
            foreground: 0x8C2A2A, background: WCAG.composite(H.rose, opacity: 0.25, over: H.cardTop), level: .text),
        ContrastPair(
            name: "hatchery right answer: number on sage 45%",
            foreground: 0x3D5A2B, background: WCAG.composite(H.sage, opacity: 0.45, over: H.cardTop), level: .text),
        ContrastPair(
            name: "hatchery wrong answer: number on rose 30%",
            foreground: 0x5A2A2A, background: WCAG.composite(H.rose, opacity: 0.3, over: H.cardTop), level: .text),
    ]

    /// The games with their own palettes.
    static let games: [ContrastPair] = [
        ContrastPair(name: "Memorize: ink on paper", foreground: MemorizeStyle.inkHex, background: MemorizeStyle.paperHex, level: .text),
        ContrastPair(name: "Memorize: ink on card", foreground: MemorizeStyle.inkHex, background: H.white, level: .text),
        ContrastPair(name: "Memorize: ember on paper", foreground: MemorizeStyle.emberHex, background: MemorizeStyle.paperHex, level: .text),
        ContrastPair(name: "Memorize: ember on card", foreground: MemorizeStyle.emberHex, background: H.white, level: .text),
        ContrastPair(
            name: "Memorize: ember on its 10% capsule",
            foreground: MemorizeStyle.emberHex,
            background: WCAG.composite(MemorizeStyle.emberHex, opacity: 0.1, over: MemorizeStyle.paperHex), level: .text),
        ContrastPair(
            name: "Memorize: the current blank, ember on 12% ember",
            foreground: MemorizeStyle.emberHex,
            background: WCAG.composite(MemorizeStyle.emberHex, opacity: 0.12, over: H.white), level: .text),
        ContrastPair(name: "Memorize: white on ember button", foreground: H.white, background: MemorizeStyle.emberHex, level: .text),
        ContrastPair(name: "Memorize: moss on paper", foreground: MemorizeStyle.mossHex, background: MemorizeStyle.paperHex, level: .text),
        ContrastPair(name: "Memorize: error on paper", foreground: H.roseInk, background: MemorizeStyle.paperHex, level: .text),
        ContrastPair(name: "Proving: ink on paper", foreground: ProvingStyle.inkHex, background: ProvingStyle.paperHex, level: .text),
        ContrastPair(name: "Proving: ink on card", foreground: ProvingStyle.inkHex, background: H.white, level: .text),
        ContrastPair(name: "Proving: misses on paper", foreground: H.roseInk, background: ProvingStyle.paperHex, level: .text),
        ContrastPair(name: "Proving: personal best on paper", foreground: ProvingStyle.bestInkHex, background: ProvingStyle.paperHex, level: .text),
        ContrastPair(name: "Proving: wrong border on card", foreground: H.roseInk, background: H.white, level: .large),
        ContrastPair(name: "Proving: text on the × accent", foreground: ProvingStyle.onAccentHex, background: H.rose, level: .text),
        ContrastPair(name: "Proving: text on the ÷ accent", foreground: ProvingStyle.onAccentHex, background: H.mustard, level: .text),
        ContrastPair(name: "Stones: streak on sky (20pt bold)", foreground: H.roseInk, background: 0x87CEEB, level: .large),
        ContrastPair(name: "Stones: bank label on bank (22pt bold)", foreground: SteppingStonesStyle.bankLabelHex, background: 0x7AAB5C, level: .large),
        ContrastPair(name: "Stones: pad number (22pt bold)", foreground: H.charcoal, background: SteppingStonesStyle.padHex[1], level: .large),
        ContrastPair(name: "Stones: rock number (22pt bold)", foreground: H.charcoal, background: 0xA8953C, level: .large),
        ContrastPair(name: "Stones: reset banner, white on roseInk", foreground: H.white, background: H.roseInk, level: .large),
    ]
}
