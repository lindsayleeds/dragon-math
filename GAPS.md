# Dragon Math — Business & Product Gaps

Living tracker of functionality/business gaps identified in advisory review.
Status legend: ✅ Done · 🟡 Partial / in progress · ⬜ Not started

_Last updated: 2026-08-03_

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
- **Copy defect found and fixed 2026-08-03 — and the class of bug closed with
  it.** The modal no longer contains any plan facts. It renders from
  `GET /api/billing/plans`, which derives prices from Stripe, child limits from
  `CHILD_LIMIT` and unlocked games from `PAID_GAME_IDS`
  ([server/lib/planCatalog.js](server/lib/planCatalog.js), tested). Game *names*
  come from `src/data/games.js`, which already owns them. The rule going forward:
  if you are about to type a number or a game name into `UpgradeModal`, add it to
  the endpoint instead. What was wrong:
  [ParentDashboardPage.jsx:697](src/pages/ParentDashboardPage.jsx) and `:713`
  both read `up to 9 children · weekly digest · Dragon Munchers`:
  - **Overstates children — 9 advertised, 6 enforced** (`CHILD_LIMIT.premium`,
    [server/lib/entitlements.js](server/lib/entitlements.js)). The cap was
    deliberately cut 9→6 here; the code is right and the copy is stale, so a
    parent who buys Premium for 9 kids hits a 402 at 6. This is the live defect.
  - **Understates games — 1 named, 3 unlocked.** `PAID_GAME_IDS` gates
    `dragon-munchers`, `dragon-spelling` and `proving-grounds` (1d), but the
    modal only credits Premium with Dragon Munchers.
  - No price is shown anywhere in the modal either — see 1c for the disclosure gap.
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

### 1c. No free trial — ✅ trial LIVE 2026-07-20 · warning + dunning + disclosure shipped 2026-08-03
- `subscription_data: { trial_period_days: 14 }` on the Checkout session,
  deployed. Webhook grants access on `trialing`.
- **Confirmed shape 2026-08-03:** `payment_method_collection` is left unset, and
  Stripe defaults it to `always` in subscription mode — so the trial **requires a
  card up front and auto-charges on day 14** unless the parent cancels in the
  portal. Free-forever (1 kid, 3 games) still needs no card; the trial is opt-in.
- **Done 2026-08-03 — webhook.** `customer.subscription.trial_will_end` and
  `invoice.payment_failed` are now handled in
  [server/routes/billing.js](server/routes/billing.js), each sending a branded
  email ([server/lib/billingEmails.js](server/lib/billingEmails.js), tested) via
  the card shell extracted to `server/lib/emailShell.js`.
- **Done 2026-08-03 — disclosure.** The trial was previously *never mentioned
  anywhere in the UI* (every "trial" string in `src/` was the unrelated Dragon's
  Trial placement test), so Stripe's checkout page was the first place a parent
  heard about the card. `UpgradeModal` now states the trial length, that a card
  is collected, the renewal price and that cancelling before the date costs
  nothing; the CTA reads "Start N-day free trial". `TRIAL_PERIOD_DAYS` in
  `entitlements.js` is the single source for N, read by both the Checkout session
  and the copy, so the promise and the charge cannot diverge. The signup form
  now carries the Terms/Privacy agreement (5b).
- **`past_due` is still deliberately access-granting** (`activeish` in
  `billing.js`) — a family whose card expired should not lose the app mid-week —
  but it is no longer silent: the dunning email plus a dashboard banner make the
  retry window visible.
- **⬜ ACTION REQUIRED in the Stripe dashboard — the code is live but two events
  may not be arriving.** The webhook now consumes
  `customer.subscription.trial_will_end` and `invoice.payment_failed`, and Stripe
  only delivers the event types an endpoint is *subscribed to*. The endpoint was
  created for `checkout.session.completed` + `customer.subscription.*`
  ([docs/MONETIZATION.md](docs/MONETIZATION.md) step 3), so unless it was set to
  "all events", the trial-ending warning and the dunning email will silently never
  fire — and `trial_ending` / `payment_failed` will never appear in the funnel.
  Add both to the endpoint at
  https://dashboard.stripe.com/webhooks, then confirm with
  `stripe trigger customer.subscription.trial_will_end`. Nothing in the code or
  the deploy can detect this; only the dashboard shows it.
- **Still open:** decision 2, whether to move the trial to 30 days. The emails
  that gated that decision now exist.

### 1d. Paywall placement — 🟡 Three gates live; worlds declined; insight depth is the open call
- **Done 2026-07-20:** Half the games are now premium. `PAID_GAME_IDS` (server
  `entitlements.js` + client `games.js`) = `dragon-munchers`, `dragon-spelling`,
  `proving-grounds`. Free = Hatchery, Stepping Stones, Phonics. Built to dist +
  API reloaded; verified free↔premium lock resolution.
- **Audit 2026-08-03 — the free tier is not as ungated as this entry implied.**
  Three gates exist and all are enforced server-side:
  | Gate | Free | Enforced at |
  |---|---|---|
  | Games | 3 of 6 locked | `PAID_GAME_IDS` / `isGameLocked` |
  | Children | **1** | `CHILD_LIMIT.free` |
  | Weekly digest | off | `canUseDigest()` |
  The child limit returns a 402 with `code: 'child_limit'` at all three write
  paths — parent create and parent link-existing-kid
  ([server/routes/parent.js](server/routes/parent.js) `checkChildLimit`), and
  teacher add-student (`checkTeacherStudentLimit`,
  [server/routes/classroom.js](server/routes/classroom.js)). `GET
  /api/parent/me` also returns `child_limit`/`can_add_child` so the UI pre-empts it.
- **World gating: DECLINED 2026-08-03 (owner).** All six map worlds stay free.
  Worlds are the core progression kids play for and cutting it mid-map is the
  wrong first paywall. `PRICING_STRATEGY.md`'s world-gating step is **declined,
  not pending** — don't re-open it.
- **Still open — parent-insight depth (the one unbuilt piece, and a yes/no).**
  Parent insights are currently ungated: nothing in
  [server/lib/analytics.js](server/lib/analytics.js) or the parent stats routes
  reads plan at all (plan is read only for the child limit and the digest). The
  natural lever is the `?days` query param on `GET
  /api/parent/children/:childId/stats` ([parent.js:307](server/routes/parent.js)),
  which the server currently honors verbatim — clamp free to 7 days and leave
  30+ to paid. A stronger variant also locks the per-operator breakdown and the
  proving-grounds run history, but that needs real locked-state UI.
- **Still open:** contextual upgrade nudges at the "aha" moment.

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

### 5a. COPPA data minimization — 🟡 Partial
- Covered: no child can self-create an account, parent-created children always
  get a `parent_child_links` row in the same transaction, and guest play is
  fully ephemeral (in-memory only, no server row, gone on refresh).
- Still open: **teacher-created and school-created** students. Those rows
  accumulate server-side history with no linked parent, leaning on school
  consent we haven't confirmed our notice/DPA posture supports — see
  [docs/COPPA.md](docs/COPPA.md).

### 5b. Verifiable parental consent (VPC) / legal docs — 🟡 Pages LIVE 2026-08-03, still awaiting legal review
- Confirm published privacy policy, ToS, and that a parent creating the child
  account directly meets COPPA's VPC standard. FERPA + signable DPA needed for
  districts, which is also what 5a's school-created students depend on.
- **Was: neither document existed at all** — a live public site with under-13
  users and live Stripe keys and no policy of either kind.
- **Deployed to production 2026-08-03** (release `4addc57`): both pages render at
  https://mydragonmath.com/privacy and `/terms`, anonymously, with the draft
  banner showing and **zero** `[NEEDS: …]` markers — verified in a browser against
  the live site, not just built.
- **Done 2026-08-03:** [PrivacyPolicyPage](src/pages/PrivacyPolicyPage.jsx) and
  [TermsPage](src/pages/TermsPage.jsx), lazy-routed at `/privacy` and `/terms`
  (public and session-independent, so a school or app-store reviewer can read
  them without an account). Linked from the signup form and the upgrade modal.
  The content was written **against the code, not from a template** — the data
  table mirrors `server/db/schema.js`, the processor list is the real one
  (Stripe, Supabase, Resend, Google Fonts, Google sign-in, Anthropic for handle
  screening), the retention section describes the real 30-day orphan sweep, and
  the billing section states the actual auto-charge mechanic.
- **Operator details live in one file:**
  [src/data/legalEntity.js](src/data/legalEntity.js). Set 2026-08-03 to
  `Lindsay Leeds`, `4375 University Drive, Ooltewah, TN 37363` — a sole
  proprietorship, no entity — with governing law inferred as Tennessee. Both
  pages read from it, so forming an LLC or moving to a virtual mailbox is a
  one-file edit.
- **✅ Every operator field is filled (2026-08-03).** Contact email
  `mydragonmath@gmail.com` (privacy + support), phone `(423) 225-4275`, refund
  policy stated as cancel-anytime / no refund of a period already begun — which
  is what the code actually does. COPPA's name/address/phone/email set is
  complete, and the pages render with no `[NEEDS: …]` markers.
- **⬜ One thing still holds these back: a lawyer has not read them.**
  `legallyReviewed: false` keeps a draft banner on both pages, and that flag is
  deliberately independent of the field checks — complete is not reviewed. Any
  null field would additionally render a loud inline `[NEEDS: …]` marker and list
  itself in the banner ([LegalPageShell](src/components/LegalPageShell.jsx)), so
  a future unfilled value cannot ship quietly either.
- **Before publishing, confirm the Anthropic processor bullet matches reality**
  (`ANTHROPIC_API_KEY` set or not — handle screening is dormant without it).
- **Consider an LLC.** Currently a private individual personally takes recurring
  payments and holds behavioural data on children, with no entity between a claim
  and personal assets. That exposure is independent of these pages and is the
  larger issue; it would also take the home address off the published policy.
- **Still open:** whether parent-created accounts meet COPPA's VPC standard, and
  a signable DPA for districts (which 5a's school-created students depend on).

### 5c. Social surface moderation — ⬜ Not started
- Kid-created handles + Tribes names + live PvP = safety surface. Confirm
  profanity/handle filter and that there's no free-text kid-to-kid chat.

---

## 6. Business intelligence (for the founder)

### 6a. No founder-facing product analytics — 🟡 Trial funnel LIVE in production 2026-08-03
- Analytics engine is all parent/teacher-facing. No funnel / activation /
  trial→paid conversion / cohort retention / churn / LTV tracking (no
  PostHog/Amplitude/Mixpanel). Can't fix conversion or churn without measuring.
- **Confirmed 2026-08-03:** nothing logs trial lifecycle anywhere. The combined
  $7.99 + 14-day-trial launch shipped un-instrumented, so there is currently no
  way to tell whether it is working. `PRICING_STRATEGY.md` rollout step 0 called
  for this *before* the launch; it was skipped.
- **Done 2026-08-03:** a `billing_events` append-only log
  ([server/db/schema.js](server/db/schema.js)) written by the same webhook
  handlers as 1c, with the derivation in
  [server/lib/billingEvents.js](server/lib/billingEvents.js) (pure + tested) and
  a `GET /api/admin/funnel` rollup behind the password-gated admin surface.
  Events: `trial_started`, `trial_ending`, `trial_converted`, `churned`,
  `payment_failed`.
  Two things worth knowing before touching it. **Stripe has no
  `trial_converted` event** — a conversion is only visible as the transition
  `trialing -> active`, so `applySubscription` reads `users.plan_status`
  *before* it writes; read it after and every conversion looks like a no-op.
  And **retries are deduped by `dedupe_key`, at a grain that differs per event**:
  lifecycle events key on the subscription (two different Stripe events describe
  one trial start), while `payment_failed` keys on the invoice, because that one
  legitimately repeats.
- **✅ Deployed and verified 2026-08-03 (release `4addc57`).** `billing_events`
  exists on both targets, and `/api/admin/funnel` returns 200 with
  `conversion_rate: null` (no trials yet) on test *and* production. It is read
  through **Admin ▸ Funnel**, not curl — a founder metric nobody opens doesn't
  change a pricing decision. The tab states the two ways to misread it: a null
  rate renders as "no trials yet" rather than "0%", and these are lifetime counts
  rather than a cohort, so the rate lags while signups grow.
- **The endpoint answers Postgres 42P01 with a 503 naming the fix**, because
  "deployed but not yet pushed" is a real state this repo can be in — there are no
  committed migrations.
- **Nothing will appear until a real Stripe event lands.** Every count is 0 now;
  the first row will be a `trial_started`. If a trial is taken and the funnel
  stays empty, suspect the webhook endpoint's subscribed events before suspecting
  this code — `trial_will_end` and `invoice.payment_failed` are newly consumed and
  have to be enabled on the Stripe endpoint to arrive at all.
- **Still open:** activation, cohort retention and LTV. This covers the trial
  funnel only — the question "is $7.99 + a trial working?" — not the rest of 6a.

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
- Follow-up 2026-07-24 — two holes in that first pass, now closed
  ([server/lib/stripeCustomers.js](server/lib/stripeCustomers.js), tested):
  - The self-heal keyed on `err.code === 'resource_missing'` alone. That code is
    also returned for other params (e.g. a missing Billing Portal
    `configuration`), so an unrelated failure would have deleted a **valid**
    `stripe_customer_id` — which silently unlinks the user from their
    subscription webhooks, since `applySubscription()` matches on that column.
    Now requires the error to actually be about the customer we passed.
  - The self-heal dropped the id but left the `plan`/`plan_status`/
    `stripe_subscription_id` cache it was backing, so an account whose Stripe
    customer had vanished stayed on a paid plan nobody was paying for. It now
    resets the cache the way `clearSubscription()` does — except for `comped`
    accounts, whose hand-granted plan is never Stripe-derived.
