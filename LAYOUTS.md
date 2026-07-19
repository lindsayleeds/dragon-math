# Dragon Math — Layouts & Screen-Size Matrix

Dragon Math is a PWA played almost entirely on phones and tablets (kids add it
to their home screen). This document tracks the screen sizes we design for and
records the results of testing every game at each size.

## The 10 screen sizes we target

Sizes are the **CSS logical viewport** in portrait (the coordinate space our CSS
and Playwright's `browser_resize` actually use), which is the physical
resolution divided by the device pixel ratio (DPR). These ten cover the great
majority of real phone/tablet traffic (StatCounter mobile + tablet, 2024–2025).

Test each one at the **CSS viewport** column.

### Phones

| # | Device family | Physical px | CSS viewport (portrait) | DPR |
|---|---------------|-------------|--------------------------|-----|
| 1 | Galaxy S / most Android (small) | 1080×2400 | **360 × 800** | 3 |
| 2 | Pixel / Galaxy (large) | 1080×2340 | **412 × 915** | ~2.6 |
| 3 | iPhone SE / 8 / older | 750×1334 | **375 × 667** | 2 |
| 4 | iPhone 12/13/14/15/16 (base) | 1170×2532 | **390 × 844** | 3 |
| 5 | iPhone 14 Pro/15/16 | 1179×2556 | **393 × 852** | 3 |
| 6 | iPhone Pro Max / Plus | 1290×2796 | **430 × 932** | 3 |
| 7 | iPhone XR/11 / older large | 828×1792 | **414 × 896** | 2 |

### Tablets

| #  | Device family | Physical px | CSS viewport (portrait) | DPR |
|----|---------------|-------------|--------------------------|-----|
| 8  | iPad / iPad mini (9.7") | 1536×2048 | **768 × 1024** | 2 |
| 9  | iPad Air / Pro 11" | 1668×2388 | **834 × 1194** | 2 |
| 10 | iPad Pro 12.9" | 2048×2732 | **1024 × 1366** | 2 |

> **Landscape note:** several games are landscape-oriented in play (the core
> Battle grid, Proving Grounds — see the "Proving Grounds landscape fit" commit).
> Where a game plays landscape, it was also spot-checked at the swapped
> dimensions (e.g. 844 × 390).

## Games under test

The "games" (per [src/data/games.js](src/data/games.js)) plus the core node
Battle:

1. **Dragon Egg Hatchery** — Learning Lair → pick an operation → this game
2. **Dragon Munchers** — grid muncher (paid plan)
3. **Stepping Stones** — skip-counting lily pads
4. **Proving Grounds** — `/proving-grounds` (timed × / ÷)
5. **Dragon Spelling** — `/dragon-spelling`
6. **Core Battle** — `/battle/:nodeId` (the main math battle)

## Test results

Tested **2026-07-19** against the live site (https://mydragonmath.com, build
`5f605f2`) via Playwright, signed in as an agent-created test kid (premium
guardian so the paid Dragon Munchers was unlocked). Each of the 6 games was
loaded at each of the 10 viewports — **60 cells, all pass**. The automated check
at every cell was: (a) no horizontal overflow (`scrollWidth <= innerWidth`) and
(b) the game's own screen actually rendered (content signature present).
Representative cells were also screenshotted and eyeballed.

Legend: ✅ works / ⚠️ works with minor layout note / ❌ broken.

| # | Viewport | Egg Hatchery | Dragon Munchers | Stepping Stones | Proving Grounds | Dragon Spelling | Core Battle |
|---|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | 360 × 800 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | 412 × 915 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3 | 375 × 667 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4 | 390 × 844 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 | 393 × 852 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6 | 430 × 932 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7 | 414 × 896 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8 | 768 × 1024 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9 | 834 × 1194 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 10 | 1024 × 1366 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Result: every game loads and fits (no horizontal scroll) at all 10 sizes.**

### Notes

- **No horizontal overflow anywhere.** All 60 cells had `scrollWidth ==
  innerWidth` — nothing spills sideways on any phone or tablet size.
- **✅ FIXED — Large tablets (1024 × 1366) — Core Battle & Egg Hatchery
  whitespace.** Originally these two capped their content width and (for
  Hatchery) top-anchored it, leaving a big empty band on the 12.9" iPad. Fixed:
  - *Core Battle* ([BattlePage.module.css](src/styles/BattlePage.module.css)):
    the shared content column was `max-width: 50vw` above 900px (a 512px sliver
    on a 1024px screen) → now `max-width: 640px`, and above 900px the answer grid
    grows from 380px → 560px with larger tiles, staying vertically centred.
  - *Egg Hatchery*
    ([DragonEggHatchery.module.css](src/styles/DragonEggHatchery.module.css)):
    the vertical-centre rule only fired at `max-height: 860px` and the fill rule
    was landscape-only, so tall **portrait** tablets fell through and
    top-anchored. Added a portrait-tablet rule that centres the column
    vertically. The existing landscape two-column grid is untouched.
  - Both changes are scoped to widths > 900px / portrait tablets, so phones and
    small tablets (≤ 900px) are mathematically unaffected — re-verified, no
    overflow or regression at 390/768/834.
- **✅ Not a bug — Dragon Munchers buddy thumbnails.** The "Blaze"/"Fern" images
  (`/dragon_pngs/250.png`, `138.png`) return **200 and load fine** (naturalWidth
  750px). The broken glyph in the first pass was a **load-timing artifact** — the
  570KB PNG hadn't finished loading in the 2s screenshot window (possibly during
  a `dist` rebuild). Hardened anyway: the picker `<img>` now uses
  `loading="eager" fetchPriority="high" decoding="async"`
  ([FatDragonAvatar.jsx](src/components/FatDragonAvatar.jsx)) so it loads
  promptly and doesn't flash on slow connections.
- **Method quirk:** the three Learning-Lair games (Egg Hatchery, Munchers,
  Stepping Stones) aren't URL-addressable — they launch from
  `/learning-lair/mul` → tap a number → "Choose a game". One Stepping Stones
  capture landed on a stale "Not found" from a mis-timed tap; re-running loaded
  the game cleanly, so it's ✅.
- Fixes deployed to the live `dist/` via `npm run build` (frontend-only; no
  server change). Screenshots from the runs were kept in the session scratchpad,
  not committed.
