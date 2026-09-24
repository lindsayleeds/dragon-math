# Dragon Academy iOS — Plan

Native iPhone + iPad app for the kid experience. Decisions settled 2026-09-23; the
hard-to-reverse ones have ADRs in `docs/adr/`.

## Scope (v1)

- Kid app: login/home (family picker + QR/kid-link), map, battles + companions,
  Dragon's Trial, collection, Learning Lair (Egg Hatchery, Munchers, Stepping
  Stones), Proving Grounds, spelling, phonics, memorize, settings/font picker,
  on-device guest mode. — ADR 0002
- Slim parent view (parental gate + Face ID/passcode): add children, kid QR
  codes, basic stats, purchase, account deletion, contact email, local practice
  reminders.
- Not in iOS: tribes (later), parent dashboards, custom list creation, billing
  management, teacher/school/admin.
- Build order: (1) login, parent view, map, battle, trial, collection →
  internal TestFlight; (2) math mini-games; (3) spelling, phonics, memorize.

## Platform

- SwiftUI rewrite — ADR 0001. Minimum iOS/iPadOS 18.
- iPhone portrait only; iPad both orientations + Split View/Stage Manager.
  Battle and map designed iPad-landscape first.
- Design: same brand/art (`docs/BRAND.md`), native app shell, custom game screens.
- Art: static map/boss art exported to vectors; animated parts rebuilt in SwiftUI.
- Game screens in SwiftUI; `Canvas`/`TimelineView` particles, SpriteKit only
  if profiling on an iOS 18 iPad demands it.

## Architecture

- Code in `ios/` in this repo — ADR 0006.
- Plain SwiftUI + `@Observable`, services via environment, `NavigationStack`
  with typed routes.
- Local Swift packages: `GameRules` (pure, injectable clock + RNG), `Store`
  (GRDB), `API` (generated), `Sync`, `Audio`; features in the app target.
- Offline-first event queue, idempotent uploads — ADR 0003.
- Client-authoritative rewards + server plausibility flags — ADR 0004.
- Rule parity via server-served tunables + golden files + shared PRNG — ADR 0005.
- API contract: zod on iOS-used routes → `openapi.json` →
  `swift-openapi-generator`.
- Assets: bundle everything at release; delta-download new catalog dragons and
  custom-list audio; lists appear only when fully downloaded. Recompress
  dragon PNGs.

## Accounts, payments, store

- Parents: Sign in with Apple only, separate verified contact email — ADR 0007.
- StoreKit 2 subscription, unified with Stripe; classroom plans server-granted;
  Education category, 4+ — ADR 0008.
- Kids: family picker + QR/universal links (`apple-app-site-association` on web
  domain).
- Developer account: individual for now; move to an LLC before real users sign
  in with Apple if it becomes a business.
- **Deferred:** app name and bundle ID (decide before creating the App Store
  Connect record). No personal name in the bundle ID. "Dragon Academy" looked
  open; "Dragon Math" is crowded. Placeholder: `dev.placeholder.dragonacademy`.

## Audio

- Synthesized web SFX rendered offline to short compressed files, played via
  an AVAudioEngine pool.
- All spoken words/phonics are server-generated clips (ElevenLabs) — no TTS.
- Spoken content plays through the silent switch; SFX respect it; in-app SFX toggle.

## Quality

- Accessibility: VoiceOver labels, Dynamic Type outside game boards, Reduce
  Motion, parent-set timer/pace accommodation, never color-only feedback,
  consider a dyslexia-friendly font (license check).
- Tests: golden `GameRules`, `Store`/`Sync`, API contract, a few end-to-end UI
  tests (login → battle → win → sync). Snapshot tests later.
- CI: local only for now; Xcode Cloud once the paid account exists.
- Telemetry: own events via the sync queue, per-child opt-out; Apple-only crash
  reporting (App Store Connect + MetricKit); no ATT prompt.
- English only, String Catalogs from day one.

## Follow-ups

- [ ] Add Sign in with Apple to the web app
- [ ] Server plausibility flags for client-reported results
- [ ] Sync endpoints (idempotent event batches), Apple sign-in token
      verification, App Store Server Notifications
- [ ] Move tunables into server-served config; inject RNG/clock in JS rules;
      golden-file generator script
- [ ] zod schemas + OpenAPI for iOS-used routes
- [ ] `apple-app-site-association` on the web domain
- [ ] Register email-sending domain with Apple's private relay service
- [ ] Install an iOS 18 simulator runtime
- [ ] Font license check (Google Fonts OFL; any dyslexia font)
