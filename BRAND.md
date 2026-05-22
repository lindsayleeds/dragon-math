# My Dragon Math — Brand Guide

A hand-drawn adventure. Every surface should feel like a page out of a kid's
field journal: cream paper, pencil lines, crayon washes, washi tape, and the
occasional doodle. Nothing flat, nothing slick, nothing generic.

## Name

The product is **My Dragon Math** — always written in full, in that order, with
title case. Never "Dragon Math," never "MyDragonMath," never "MDM." If a
surface is too narrow for the full name, drop the entire wordmark before you
abbreviate it.

The tagline is **a hand-drawn adventure** (lowercase, em-dash prefix optional:
`— a hand-drawn adventure`).

## Voice & tone

Warm, curious, kid-friendly. We talk like a friendly grown-up sketching in the
margins of a notebook — never like a tutorial pop-up.

- **Use:** "Welcome, Dragon Tamer", "turning the page…", "keep going, traveler",
  "next stop", "field notes", "enter the realm"
- **Avoid:** "Get started", "Sign up now", "Click here", anything that sounds
  like a SaaS dashboard
- **Tone words:** cozy, wholesome, playful, hand-made, adventurous, bright
- **Tone we are not:** edgy, sleek, corporate, dark, occult, spooky

### Content guardrails

No dark/spiritual/occult themes. No witches, wizards, ghouls, zombies, demons,
necromancy, séances, hexes, curses, or dark magic in copy, art, or game
content. The world is nature-forward: animals, plants, weather, gems, cozy
dwellings, friendly creatures, mythical-but-bright themes. Dragons in the boss
role are fine — that's the whole point.

## Color palette

The journal palette. Use it consistently — these are the CSS variables that
already live on the map page and should be reused everywhere.

| Token              | Hex       | Role                                    |
|--------------------|-----------|-----------------------------------------|
| `--paper`          | `#f4ead5` | Page background — cream notebook paper  |
| `--paper-deep`     | `#ede0bf` | Page edges / shadowed paper             |
| `--paper-rule`     | `#c4b290` | Notebook rule lines                     |
| `--kraft`          | `#a07859` | Kraft brown — borders, dashed lines     |
| `--kraft-dark`     | `#7d5a3f` | Deeper kraft — secondary text           |
| `--charcoal`       | `#3d3528` | Primary ink — headings, borders         |
| `--pencil`         | `#5a4a3a` | Pencil gray — body copy                 |
| `--rose`           | `#d97474` | Boss / underline / hot accent           |
| `--sage`           | `#7d9d6c` | Ready / go / primary action             |
| `--sky`            | `#8eb0cc` | Cool accent / locked / info             |
| `--mustard`        | `#d4a957` | Completed / counter / warm accent       |
| `--lavender`       | `#c79bb8` | Soft accent — sparingly                 |

**Do not use** the old purple gradient (`#e05fa0 → #9b4dca`), generic system
purples, or any pure white card on a colored gradient — those are the auth
page's previous look and read as off-brand SaaS.

## Typography

Two fonts, no exceptions:

- **Caveat** (`Caveat`, weights 400/600/700) — display, headings, brand mark,
  numbers, stat values, button labels. Always rendered like handwriting.
- **Patrick Hand** (`Patrick Hand`) — body copy, form labels, captions,
  descriptions, small text. Set the page default to Patrick Hand.

Loaded via Google Fonts: `https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=Patrick+Hand&display=swap`

**Forbidden:** Inter, Roboto, Arial, Segoe UI, system-ui, any sans-serif that
isn't one of the two above. The old `--font-main` (`'Segoe UI', 'Comic Sans MS',
Verdana`) is legacy and should not be used on new surfaces.

## Texture & paper

Every primary surface sits on the cream paper background with a faint dot
grid:

```css
background: var(--paper);
background-image: radial-gradient(circle, rgba(160,120,89,0.22) 1px, transparent 1.4px);
background-size: 22px 22px;
opacity: 0.55; /* on a ::before overlay */
```

Cards on top of paper get a subtle horizontal-rule gradient (one ruled line
near the top) and a soft layered drop shadow that reads like stacked paper:

```css
box-shadow:
  2px 3px 0 rgba(61,53,40,0.10),
  5px 7px 0 rgba(61,53,40,0.07),
  8px 12px 18px rgba(61,53,40,0.18);
```

## Decorative motifs

These are the recurring details. Reach for them — they're what makes the brand
feel hand-made.

- **Washi tape** strips — colored translucent rectangles with a faint vertical
  stripe pattern, slightly rotated, used to "pin" cards to the page. Rose,
  sage, sky, and mustard tapes are all in rotation.
- **Dashed kraft borders** (`1.5px dashed var(--kraft)`) instead of solid
  borders wherever possible.
- **Wavy underlines** in rose under titles (`text-decoration: underline wavy
  var(--rose)` with `text-underline-offset: 6px`).
- **Slight rotations** — never put a card perfectly straight. Use `rotate(-1.2deg)`,
  `rotate(0.6deg)`, etc. Tape, tabs, and buttons get a few degrees too.
- **Hard offset shadows** on buttons (`box-shadow: 3px 3px 0 var(--charcoal)`)
  for a stamped/sticker feel — never use blurry drop shadows on buttons.
- **Doodles** — stars (✦), sparkles, tiny flowers, dotted-line paths, and the
  brand dragon (🐉) with a slight rotation and sepia filter. Scatter them in
  empty space; don't pack them in.
- **Hand-drawn dotted-line paths** in dashed kraft, sometimes curving.

## Components

### Brand mark

`🐉` rotated `-8deg` with `filter: sepia(0.4) saturate(0.7)`, sized to match
the wordmark. Pair with the wordmark "My Dragon Math" in Caveat 700, with a
3px rose underline on the title (the title sits in a wrapper that's rotated
`-1deg` and has `border-bottom: 3px solid var(--rose)`).

### Buttons

Two recipes:

- **Primary (sage tab):** Caveat 700, charcoal text on `var(--sage)`
  background, `2px solid var(--charcoal)` border, `3px 3px 0 var(--charcoal)`
  hard shadow, rotated `-1.5deg`. On press: translate `2px 2px` and shrink the
  shadow to `1px 1px`.
- **Secondary (kraft tab):** Patrick Hand, smaller, cream fill,
  `1.5px dashed var(--kraft)` border, rotated `2deg`, with a softer
  `2px 3px 0 rgba(61,53,40,0.12)` shadow. Used for log-out and tertiary
  actions.

### Inputs

Fields are notebook-line style: transparent background, no top/left/right
borders, a single dotted kraft underline. On focus, the underline thickens and
shifts to the active accent (sage for primary, rose for parent surfaces). No
rounded "pill" inputs, no purple focus rings.

### Cards

Cream paper card, single ruled line about 28px from the top, dashed kraft
border, slight rotation, washi tape pinning one corner. Use the layered hard
shadow recipe above.

### Map nodes

Map nodes are crayon-circle medallions on the paper, not pixel sprites or
slick badges. Every node is built from the same stack of SVG layers — keep
this order if you ever rebuild it:

1. Soft wobbled drop shadow (charcoal, ~15% opacity)
2. Crayon-fill circle (colored by state — see table below) with a `paperWobble`
   filter and a deterministic 0–5° tilt per node
3. Hand-drawn charcoal outline (2px, wobbled)
4. Waxy highlight ellipse, top-left, cream `#fff8e2` at ~28% opacity
5. **Center icon** — a single emoji
6. Completion stamp (top-right corner) when applicable
7. Caveat label below

**Size:** regular nodes `r = 25`, boss nodes `r = 36`. Don't introduce
in-between sizes — those two are the rhythm of the map.

**Fill by state:**

| State              | Fill                    | Token             |
|--------------------|-------------------------|-------------------|
| Locked             | `#c4b290` at 55% opacity | `--paper-rule`    |
| Available, regular | `#7d9d6c`               | `--sage`          |
| Available, boss    | `#d97474`               | `--rose`          |
| Completed, regular | `#d4a957`               | `--mustard`       |
| Completed, boss    | `#c79bb8`               | `--lavender`      |

Lavender appears here and effectively only here — it's the "you beat a dragon"
color, which is why the brand otherwise tells you to use it sparingly.

**Center icon.** A single emoji glyph, no background, sized `18` on regular
nodes and `26` on bosses. Pick from the wholesome palette: animals (🦔 🦋 🐦
🦆 🐟 🕊️), plants & weather (🌿 🌻 🌼 🌸 🎋 ☁️ ❄️ 🌈), gems & minerals
(💎 🔮), cozy dwellings & landmarks (🏡 🗼 🏮 ⛰️ 🌙), or terrain features
(💧 🌊). Locked nodes keep their icon visible at 30% opacity — never hide it
behind a lock glyph; this is a field journal, not a UI. **Bosses are always a
dragon emoji** (🐲 for chapter dragons, 🐉 reserved for late-game / Crystal
Dragon-class). Do not put initials, numerals, level numbers, or letter avatars
inside a node — the emoji is the avatar.

**Completion stamp.** A small mustard disc (`r = 11`, `#d4a957`) with a 1.4px
charcoal outline, placed at `(0.78r, -0.78r)` and rotated a few degrees off
true, carrying a Caveat 700 charcoal `✓`. It reads as a stamped sticker, not a
material-design check badge.

**Available state.** Add a dashed rose pulse ring (`r + 9`, `stroke #d97474`,
`stroke-dasharray "3 4"`) outside the medallion, plus a gentle bobbing
animation on the whole node group. Only the currently-reachable node gets
this — don't apply it to everything that isn't locked.

**Current-position annotation.** A rose Caveat `you →` to the left of the
current node, rotated `-6°`. This is the only text that sits *outside* the
medallion besides the label.

**Wobble.** Every node gets a small deterministic offset (`±1.5px`) and tilt
(`±2.5°`) seeded from its id, so the path never looks like a grid. New nodes
should opt into the same `seeded(node.id * n)` helper rather than picking
fixed offsets.

## Surface-by-surface notes

- **Kid sign-in:** Sage as the primary accent (matches `ready` state on the
  map). Washi tape in rose. Brand dragon centered above the wordmark.
- **Grown-up sign-in:** Sky as the primary accent (cooler, calmer, signals
  "this is the parent door"). Washi tape in sage. Same wordmark, smaller
  brand dragon.
- **Map:** Already the canonical brand surface — match it, don't drift from it.
- **About / version pages:** Should adopt the journal style; the current
  system-font version is a legacy stub.
- **Emails (weekly report):** Plain HTML can't carry the texture, but it
  should still use the wordmark "My Dragon Math", the brand dragon emoji, and
  Caveat-like headings (Georgia or system serif is an acceptable email
  fallback). Keep the warm cream/charcoal palette.

## Quick checklist for any new surface

- [ ] Cream paper background with dot grid overlay
- [ ] Caveat for headings, Patrick Hand for body — nothing else
- [ ] At least one slightly-rotated element (card, tape, button)
- [ ] Dashed kraft borders over solid borders where possible
- [ ] A hand-drawn motif (washi tape, doodle, wavy underline, stamp shadow)
- [ ] Copy in the journal voice — warm, curious, kid-friendly
- [ ] Wordmark reads "My Dragon Math" in full
- [ ] No purple gradient, no system fonts, no perfectly straight white cards
