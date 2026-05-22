# Dragon Math — Form-Factor Testing Matrix

What we need to actually click through before shipping a UI change. Kids
play this on whatever device is in the house; parents read the dashboard
on something bigger. We can't catch layout bugs by testing on a MacBook
alone.

## Device classes to cover

Pick one representative per row. The point isn't every device — it's
that each class behaves differently (touch sizing, viewport, browser
engine, on-screen-keyboard behavior).

| Class                | Representative                  | Why it matters                                                  |
|----------------------|---------------------------------|-----------------------------------------------------------------|
| Small phone          | iPhone SE / 13 mini (375×667)   | Smallest viewport we plausibly support; battle grid stress test |
| Large phone          | iPhone 15 Pro Max / Pixel 8 Pro | Most common kid hand-me-down                                    |
| Small tablet         | iPad mini / 8" Fire             | Common kid device; Fire ships Silk browser, not Chrome          |
| Large tablet         | iPad Pro 11" / Galaxy Tab       | "Primary" play surface for most kids                            |
| Chromebook           | 11" Chromebook (1366×768)       | Dominant K-8 school device; touch + trackpad both in play       |
| Laptop / desktop     | 13" MacBook, 1080p Windows      | Parent dashboard, admin, weekly-digest landing                  |

We do **not** need to cover: Apple Watch, foldables in folded mode,
Kindle e-ink, smart fridges. If a parent emails us about one, revisit.

## What to actually check, per class

For each device class, walk these flows. Tick when verified for that
class; a row only counts as "done" when every class is ticked.

### Battle (the hot path)

- [ ] Grid renders without horizontal scroll in portrait
- [ ] Grid renders without horizontal scroll in landscape
- [ ] Cells are tappable without zoom (≥ 44px on phones)
- [ ] Problem text doesn't overflow at the longest realistic length
      (e.g. `12 × 12 = ?`)
- [ ] Score bars + dragon art fit above the grid without pushing the
      grid offscreen
- [ ] AI timer flash + correct/wrong cell flash are visible (some Fire
      tablets have aggressive color profiles)
- [ ] Sound effects play (iOS Safari requires a user gesture; verify the
      first-tap unlock works)

### Dragon's Trial

- [ ] 20-problem sequence completes without layout shift between ops
- [ ] 2-attempt limit feedback is legible (red flash + advance)
- [ ] Per-op score reveal screen fits without scroll

### Map / node selection

- [ ] All 41 nodes reachable by scroll on the smallest phone
- [ ] Active-node highlight visible against the background art
- [ ] Tap targets don't overlap on the small phone

### Parent dashboard

- [ ] Stats tables don't blow out horizontally on a 13" laptop
- [ ] Per-child stats page charts render at desktop, tablet, and phone
      widths (parents do open this on phones)
- [ ] Weekly-digest "Open dashboard" link opens correctly when tapped
      from the iOS Mail app (in-app browser quirks)

### Admin

- [ ] `/admin` is usable on a laptop (the only intended surface)
- [ ] If accidentally opened on a phone, it degrades to scrollable
      rather than broken

### Auth

- [ ] Google OAuth round-trip works in iOS Safari, Android Chrome, and
      Chromebook Chrome
- [ ] Sign-in form is usable with the on-screen keyboard open (input
      not hidden behind keyboard)

## Browser engines to hit

Engine matters more than vendor — testing iPhone and iPad both only
exercises WebKit.

- [ ] **WebKit** — iOS Safari (current and one-major-version-back)
- [ ] **Blink** — Android Chrome, desktop Chrome, Chromebook Chrome
- [ ] **Silk** — Amazon Fire tablet (Blink-based but lags; ships on a
      device class that's common with kids and rare in dev shops)
- [ ] **Gecko** — desktop Firefox (parent dashboard only; not worth
      stressing on mobile)

## Orientation + input

- [ ] Portrait and landscape on every touch device
- [ ] Touch + trackpad on Chromebook (the convertible ones flip)
- [ ] External keyboard on iPad (some kids use them; make sure tab
      order isn't broken)

## Accessibility quick-pass

Not a full audit — just the things that bite kids:

- [ ] Text scales at 200% browser zoom without the battle grid breaking
- [ ] Color isn't the only cue for correct/wrong (we use cell flash +
      score change, double-check)
- [ ] iOS "Reduce Motion" doesn't break the dragon-attack animation
      (should degrade, not freeze)

## How to run the pass

1. Local dev (`npm run dev`) covers desktop + Chrome DevTools device
   emulation. Good for catching obvious layout breaks; **bad** for
   touch sizing, sound unlock, and Safari-specific bugs.
2. Real iPad + real iPhone on the same Wi-Fi pointing at the dev box
   (or staging) catches the WebKit-only bugs.
3. BrowserStack / a borrowed Chromebook + Fire tablet for the long
   tail. Worth doing before any release that touches the battle or
   trial UI; skippable for backend-only or admin-only changes.

## When this matrix triggers

- **Always:** changes to battle UI, trial UI, map, or sign-in.
- **Sometimes:** parent dashboard changes (phone + laptop minimum).
- **Skip:** server-only changes, cron, admin-only tweaks, copy edits.
