# My Dragon Math — Monetization

**Status:** Phase 1 (entitlements + gating + manual admin billing) **and** Phase 2
(Stripe self-serve billing) are both **built and deployed**. Phase 2 runs dormant
until Stripe keys are added to `.env` — checkout/portal/webhook return 503 and the
rest of the app is unaffected. See the [Activation checklist](#activation-checklist)
to switch it on.

The sections below document what shipped; Phase 2 text doubles as the operator
guide for turning it on.

## Activation checklist

Phase 2 code is done. To go live:
1. In the Stripe Dashboard: create the **Premium** and **Classroom** products +
   their monthly/yearly Prices, and enable the **Customer Portal**.
2. Put the keys/price IDs in production `.env` (see [§2](#2-dependencies--env)):
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the four `STRIPE_PRICE_*`.
3. Add a webhook endpoint in Stripe → `https://mydragonmath.com/api/billing/webhook`,
   subscribed to `checkout.session.completed` and `customer.subscription.*`; copy
   its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. `pm2 reload dragonmath-api --update-env`. Verify with the Stripe CLI
   (see [§8](#8-testing)).

Everything below already exists in the codebase — file paths are noted inline.

The kid experience stays generous and free (battles, map, Dragon's Trial, normal
progression). We gate **parent-facing value** and a couple of extras. The kid
never hits a wall mid-fun; the grown-up decides whether the extra reach is worth
paying for.

---

## Tier model

Plans live on the adult `users` row (`users.plan`) and are gated by **child
count**, applied uniformly to parents *and* teachers. Stable internal values are
`free` / `premium` / `classroom`; UI labels are Free / Premium / Classroom.

| Plan (DB) | Label | Children | Weekly digest | Dragon Munchers |
|---|---|---|---|---|
| `free` | Free | 1 | ❌ | ❌ |
| `premium` | Premium | up to 9 | ✅ | ✅ |
| `classroom` | Classroom | unlimited (10+) | ✅ | ✅ |

Kids don't hold a plan. A child's **effective plan** is the highest-ranked plan
across their guardians (linked parents + classroom teachers).

Pricing is still open (see [Open questions](#open-questions)); Phase 2 wiring
below is priced-agnostic — you create the Prices in Stripe and map their IDs.

---

## Phase 1 — what's implemented (reference)

Central source of truth: **[server/lib/entitlements.js](../server/lib/entitlements.js)**
(mirrored client-side in **[src/data/games.js](../src/data/games.js)** — keep the
two in sync). Constants: `PLAN_RANK`, `CHILD_LIMIT`, `PAID_PLANS`,
`PAID_GAME_IDS`. Helpers: `childLimit`, `isPaid`, `canUseDigest`, `isGameLocked`,
`lockedGames`, `planForUser`, `effectivePlanForChild`, `effectivePlanForUser`,
`childCountForAdult`.

**Data model** — [server/db/schema.js](../server/db/schema.js), `users` table:
- `plan text NOT NULL DEFAULT 'free'`
- `plan_updated_at timestamptz` (nullable)

**Plan is intentionally NOT in the JWT.** Tokens live 30 days, so a plan baked
into the token would be stale after an upgrade. Every gate reads the current
plan from the DB by user id.

**Server enforcement (authoritative):**
| Gate | File | Behavior |
|---|---|---|
| Child limit — parent create | [routes/parent.js](../server/routes/parent.js) `POST /children` | `402 {code:'child_limit'}` at/over limit |
| Child limit — parent link | [routes/parent.js](../server/routes/parent.js) `POST /children/link` | same |
| Child limit — teacher add student | [routes/classroom.js](../server/routes/classroom.js) `POST /:classroomId/students` | same, counted across the teacher's classrooms |
| Child limit — kid self-join | [routes/classroom.js](../server/routes/classroom.js) `POST /join` | gated against the room's teacher plan |
| Weekly digest | [lib/weeklyReport.js](../server/lib/weeklyReport.js) | eligibility query filters `plan IN (paid)` |
| Dragon Munchers | [routes/leaderboard.js](../server/routes/leaderboard.js) `POST /:game` | `402 {code:'game_locked'}` for free effective plan |

> **Munchers caveat:** game logic is client-side, so the leaderboard gate blocks
> *score-saving/progress*, not loading the game. A fully tamper-proof lock would
> need the game moved server-authoritative — out of scope.

**Surfaced to the client:**
- `GET /api/auth/me` — adults carry `plan`; children carry `effective_plan` +
  `entitlements: { games_locked }` (via `shapeUser` in
  [routes/auth.js](../server/routes/auth.js)).
- `GET /api/parent/me` — returns `plan`, `child_limit` (null = unlimited),
  `can_add_child`, `can_use_digest`.
- `src/api.js` attaches `err.code` / `err.status` so the UI can branch on the
  402 codes.

**Frontend:** plan badge + `UpgradeModal` + digest lock + add-child gate in
[ParentDashboardPage.jsx](../src/pages/ParentDashboardPage.jsx); 🔒 lock + "ask a
grown-up" modal in [LearningLairPage.jsx](../src/pages/LearningLairPage.jsx) and
[GameChoiceModal.jsx](../src/components/GameChoiceModal.jsx).

**Phase-1 "billing" = manual admin toggle.** An admin sets a plan by hand:
`POST /api/admin/users/:userId/plan { plan }`
([routes/admin.js](../server/routes/admin.js), `VALID_PLANS`), plus a plan
dropdown in [AdminPage.jsx](../src/pages/AdminPage.jsx). This is what Phase 2
replaces with self-serve checkout.

---

## Phase 2 — Stripe self-serve billing

Goal: let a grown-up upgrade/downgrade themselves, and keep `users.plan` in sync
with Stripe automatically via webhooks. **Stripe stays the source of truth for
subscription state; `users.plan` is a cache Stripe writes through the webhook.**

### 1. Stripe dashboard setup (one-time)

1. Create two **Products**: "Premium" and "Classroom".
2. Under each, create the **Prices** you want to sell (e.g. monthly + yearly).
   Decide pricing first (see open questions). Note each Price ID (`price_...`).
3. Enable the **Customer Portal** (Settings → Billing → Customer portal) so users
   can change/cancel plans and update cards without us building billing UI.
4. Grab keys: **Secret key** (`sk_...`), **Publishable key** (`pk_...`), and —
   after step 4 below — the **Webhook signing secret** (`whsec_...`).

### 2. Dependencies & env

```bash
npm install stripe
```

Add to `.env` (and `.env.example` with placeholders):
```
STRIPE_SECRET_KEY=sk_live_or_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PREMIUM_MONTHLY=price_...
STRIPE_PRICE_PREMIUM_YEARLY=price_...
STRIPE_PRICE_CLASSROOM_MONTHLY=price_...
STRIPE_PRICE_CLASSROOM_YEARLY=price_...
# Publishable key is only needed if you use Stripe.js; the hosted Checkout +
# Portal flow below does not require it on the client.
```
Map Price ID → plan in one place (extend `entitlements.js`), so the webhook can
reverse-resolve a subscription's price to `'premium'` / `'classroom'`.

### 3. Schema additions

Add to the `users` table in [schema.js](../server/db/schema.js) (room was left
for these):
```js
stripeCustomerId:     text('stripe_customer_id'),
stripeSubscriptionId: text('stripe_subscription_id'),
planStatus:           text('plan_status'),      // 'active'|'trialing'|'past_due'|'canceled'|null
planRenewsAt:         timestamp('plan_renews_at', { withTimezone: true }),
```
Add a unique partial index on `stripe_customer_id` (like the existing
`email`/`google_sub` indexes). Push with
`npx drizzle-kit push --config=drizzle.config.cjs`.

### 4. Routes — new file `server/routes/billing.js`

Mount under `/api/billing` in [server/index.js](../server/index.js). All routes
except the webhook use `requireAuth, requireParent`.

- **`POST /api/billing/checkout`** `{ plan, interval }` →
  - Look up or lazily create the Stripe Customer for `req.user.id`; store
    `stripe_customer_id` on the user.
  - `stripe.checkout.sessions.create({ mode: 'subscription', customer,
    line_items: [{ price: <mapped price id>, quantity: 1 }], success_url,
    cancel_url, client_reference_id: String(req.user.id) })`.
  - Return `{ url }`; the client does `window.location = url`.
- **`POST /api/billing/portal`** →
  `stripe.billingPortal.sessions.create({ customer, return_url })`; return
  `{ url }`. This covers upgrade/downgrade/cancel/card updates — no custom UI.
- **`POST /api/billing/webhook`** — **must** receive the **raw request body**.
  In `server/index.js`, register this route with
  `express.raw({ type: 'application/json' })` *before* the global
  `express.json()` middleware, or it won't verify. Verify with
  `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`.

### 5. Webhook → plan sync (the important part)

Handle these events and write `users.plan` / `plan_status` /
`stripe_subscription_id` / `plan_renews_at` accordingly. Resolve the user by
`stripe_customer_id` (or `client_reference_id` on the checkout session).

| Event | Action |
|---|---|
| `checkout.session.completed` | Store `stripe_subscription_id`; set plan from the session's price. |
| `customer.subscription.created` / `.updated` | Set `plan` from the subscription's active price; set `plan_status` = subscription status; set `plan_renews_at` = `current_period_end`. On `past_due`/`unpaid`, keep the plan but flag status (grace) — or drop to free after a threshold; decide policy. |
| `customer.subscription.deleted` | Set `plan='free'`, `plan_status='canceled'`, clear `stripe_subscription_id`. |

Make the handler **idempotent** (Stripe retries): the writes above are all
last-write-wins upserts keyed by customer, so re-delivery is safe. Always return
`200` quickly; do heavy work after acking if needed.

### 6. Wire the frontend

- `UpgradeModal` in
  [ParentDashboardPage.jsx](../src/pages/ParentDashboardPage.jsx): the "Got it"
  placeholder CTA becomes plan/interval buttons → `POST /api/billing/checkout` →
  redirect to `url`.
- Add a **"Manage billing"** button (shown when `plan !== 'free'`) →
  `POST /api/billing/portal` → redirect.
- On return to `/parent`, `refresh()` already re-fetches `/api/parent/me`, so the
  new plan shows once the webhook has landed. (Webhooks are near-instant but
  async — if you want zero lag on the success page, optimistically read the
  Checkout session server-side on the success_url, or just show "updating…".)

### 7. Downgrade / over-limit policy (decide & document)

When a Premium parent with, say, 5 kids cancels → Free (limit 1):
- **We never delete children.** Existing kids stay fully playable.
- The child-limit gate only blocks **adding** new kids, so an over-limit parent
  simply can't add more until they're back under the limit or re-upgrade. This is
  already how the Phase-1 gate behaves (`count >= limit`), so no code change —
  just confirm this is the intended product behavior.
- Digest and Munchers lock immediately (they read effective plan live).
- Recommended: surface a gentle banner when `kid_count > child_limit` explaining
  they're over their new plan's limit but nothing was lost.

### 8. Testing

```bash
stripe login
stripe listen --forward-to localhost:4070/api/billing/webhook   # prints whsec_...
stripe trigger checkout.session.completed
stripe trigger customer.subscription.deleted
```
Use Stripe **test mode** keys + the `4242 4242 4242 4242` test card. Verify:
checkout → `users.plan` flips to premium via webhook → `/api/parent/me` reflects
it → child limit lifts; portal cancel → back to free → digest/Munchers relock.
Deploy per repo convention: `vite build` (frontend) + `pm2 reload dragonmath-api`
(server), and add the new env vars to production `.env`.

---

## Security & ops notes

- **Never trust the client for plan state.** All gates read the DB; the webhook
  is the only thing that writes paid plans in Phase 2. Keep the admin manual
  toggle as a support/comp tool.
- The webhook endpoint is **public** (no `requireAuth`) but authenticated by the
  Stripe signature — the signing-secret check is mandatory.
- Keep the raw-body carve-out narrow (only the webhook path) so the rest of the
  API still gets parsed JSON.
- Secrets live in `.env` (gitignored). `ADMIN_PASSWORD` also gates the manual
  plan toggle — keep it strong in production.

---

## Open questions

- **Pricing:** Premium and Classroom price points; monthly vs yearly; intro/trial
  period? Classroom likely wants per-seat or tiered-by-student-count pricing —
  the current model is flat-per-account with an unlimited student cap, which may
  undercharge large schools.
- **One-time unlock** alternative for subscription-averse parents?
- **Cosmetic packs** (avatars/dragon skins) — bundle into Premium as a sweetener
  (recommended) vs à la carte. Avoid kid-facing microtransactions in a K–12 app;
  reviewers and parents read those as predatory.
- **Annual → school** upsell path for teachers who outgrow Classroom.
