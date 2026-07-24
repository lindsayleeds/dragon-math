# Dragon Math — Business & Product Gaps

Living tracker of functionality/business gaps identified in advisory review.
Status legend: ✅ Done · 🟡 Partial / in progress · ⬜ Not started

_Last updated: 2026-07-20_

---

## 1. Monetization & conversion

### 1a. Prices set and billing turned on — ✅ Done
- All four Stripe price IDs wired in `.env`, match Stripe dashboard, loaded via
  dotenv, live server past the 503 gate (returns 401 auth, not 503).
- Current pricing:
  | Plan | Monthly | Yearly | Yearly effective |
  |---|---|---|---|
  | Premium (≤9 kids) | $2.99 | $19.99 | $1.67/mo (–44%) |
  | Classroom (unlimited kids) | $4.99 | $39.99 | $3.33/mo (–33%) |

### 1b. Pricing is far too low / mispositioned — ✅ Repricing shipped 2026-07-20
- **LIVE** (deployed via `pm2 reload`): Premium $7.99/mo · $59.99/yr; Classroom
  $9.99/mo · $79.99/yr. Child cap 9→6. Old $2.99 archived + grandfathered in code
  (`LEGACY_PRICE_PLANS`). Verified round-trip + grandfather mapping pre-deploy.
- Remaining under this theme is packaging, tracked as 1d (free-tier repackage).
- **$2.99/mo is at the floor** — parent EdTech typically $7–15/mo; low price
  can read as low quality. Likely 3–5× underpriced.
- **Classroom $4.99/mo unlimited = charity** — no per-seat scaling; heaviest
  users pay least. Needs per-seat or per-classroom pricing if schools are real.
- **Premium vs Classroom only $2 apart** — Classroom unlocks unlimited kids +
  all features, so Premium gets cannibalized. Widen the gap or add a "Family" tier.
- **Proposal drafted:** [docs/PRICING_STRATEGY.md](docs/PRICING_STRATEGY.md) —
  Premium $2.99→$7.99/mo ($59.99/yr), per-class Classroom, School "Contact us"
  tier, grandfather existing subs, ~+117% ARPU/family. 4 open decisions listed.
- **Next action:** answer the 4 open decisions, then implement Phase 1 (new
  Stripe prices + trial + `CHILD_LIMIT` + copy).

### 1c. No free trial — ✅ 14-day trial LIVE 2026-07-20
- `subscription_data: { trial_period_days: 14 }` on the Checkout session,
  deployed. Webhook grants access on `trialing`.
- **Still open:** "trial ending" + failed-payment (dunning) emails via Resend
  (required before bumping trial to 30 — decision 2).

### 1d. Paywall placement — 🟡 Games gated (worlds still open)
- **Done 2026-07-20:** Half the games are now premium. `PAID_GAME_IDS` (server
  `entitlements.js` + client `games.js`) = `dragon-munchers`, `dragon-spelling`,
  `proving-grounds`. Free = Hatchery, Stepping Stones, Phonics. Built to dist +
  API reloaded; verified free↔premium lock resolution.
- **Still open:** gating Worlds 3–6 on the map + parent-insight depth, and
  contextual upgrade nudges at the "aha" moment. These give the free→paid
  downgrade real teeth so the 14-day trial actually converts.

### 1e. No referral / word-of-mouth loop — ⬜ Not started
- Kids' apps grow via parent referral + classroom spread. Tribes and classroom
  join codes exist but no incentivized referral mechanic.

---

## 2. Retention & habit

### 2a. No daily streak / habit loop — ⬜ Not started
- No daily-login-streak retention system (streak only exists inside Stepping
  Stones gameplay). Habit loop is the foundation of a learning-app subscription.
- Substrate exists: dragon-collection reward economy is perfect for daily rewards.

### 2b. No re-engagement nudges — ⬜ Not started
- No push notifications or lifecycle "come back" emails to kid or parent.
- Only email that exists is the Monday weekly digest.

### 2c. Free-tier digest — ⬜ Not started
- Weekly digest is paid-only. A lightweight free digest could drive retention
  and conversion for free users.

---

## 3. Content depth / breadth

### 3a. Content–market fit breaks at older ages — ⬜ Not started
- Targets grades 2–8 but math is only the 4 operations + fact mastery. Realistic
  fit is ~grades 2–5. No fractions, decimals, ratios, integers, algebra,
  geometry, word problems. Spelling stops at grade 6; phonics is early-elementary.
- **Decision needed:** narrow the marketed age band, or commit to a content roadmap.

### 3b. No adaptive / personalized learning path — ⬜ Not started
- Beyond mastery tiers + Trial placement, no real adaptivity. Adaptivity is a
  core EdTech differentiator.

---

## 4. Go-to-market / distribution (schools)

### 4a. No curriculum standards alignment — ⬜ Not started
- No Common Core / TEKS mapping anywhere. Hard blocker for the classroom/school
  sales motion; also builds parent trust.

### 4b. No roster SSO — ⬜ Not started
- No Clever / ClassLink / Google Classroom roster sync. Manual join codes don't
  scale past a single enthusiast teacher.

### 4c. No app store presence — ⬜ Not started
- PWA only; limited iOS discoverability. Parents search the App Store.

---

## 5. Trust, safety & compliance

### 5a. COPPA data minimization — ✅ Done (strong)
- Guest = zero server footprint until parent consents by issuing invite code;
  pre-consent history deliberately not imported. Genuinely well designed.

### 5b. Verifiable parental consent (VPC) / legal docs — ⬜ Not started
- Confirm published privacy policy, ToS, and that "parent issues invite code"
  meets COPPA's VPC standard for the data-collecting path. FERPA + signable DPA
  needed for districts.

### 5c. Social surface moderation — ⬜ Not started
- Kid-created handles + Tribes names + live PvP = safety surface. Confirm
  profanity/handle filter and that there's no free-text kid-to-kid chat.

---

## 6. Business intelligence (for the founder)

### 6a. No founder-facing product analytics — ⬜ Not started
- Analytics engine is all parent/teacher-facing. No funnel / activation /
  trial→paid conversion / cohort retention / churn / LTV tracking (no
  PostHog/Amplitude/Mixpanel). Can't fix conversion or churn without measuring.

---

## 7. Housekeeping / operational

### 7a. Misleading .env comment — ⬜ Not started
- `.env` header says "Stripe (TEST / sandbox)" but key is `sk_live_`. Fix before
  it causes a real-money mistake.

### 7b. dragonmath-api restarts — ⬜ Not started
- PM2 shows 20 restarts on `dragonmath-api`. Probably unrelated to billing;
  check logs for crash-looping.

### 7c. Stripe test→live account switch fallout — ✅ Fixed 2026-07-20
- `users.comped` column was missing in Supabase → `/api/parent/me` 500'd →
  HTML → dashboard "Unexpected token '<'". Fixed by pushing schema (comped +
  comp_invites).
- Pre-switch test accounts held stripe_customer_ids from the old (test) account
  → "No such customer" on portal/checkout. Hardened billing.js:
  `getOrCreateCustomer` now verifies the stored customer and re-creates if
  `resource_missing`/deleted; portal self-heals a stale id and returns clean JSON.
- Cleared plan/Stripe fields on the 4 non-comped test accounts (10025, 10055,
  10056, 10061) → all back to `free`. Deployed.
