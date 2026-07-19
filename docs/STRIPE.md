# Setting up Stripe

Step-by-step guide to switch on paid subscriptions for My Dragon Math. The code
is already built (see [MONETIZATION.md](MONETIZATION.md)); this doc is the
operator checklist for wiring it to a real Stripe account.

**How it works:** the app never stores card data. A grown-up upgrades via Stripe's
**hosted Checkout**, manages/cancels via the **Customer Portal**, and Stripe tells
us the result through a **webhook** that writes the plan onto their account. Until
the env vars below are set, billing is dormant — checkout/portal/webhook return
`503` and the rest of the app is unaffected.

Do the whole thing in **Test mode** first, then repeat the keys/prices/webhook in
**Live mode** (they're separate — test keys and live keys never mix).

---

## 1. Create a Stripe account

1. Sign up at <https://dashboard.stripe.com>.
2. Leave the toggle in the top-left on **Test mode** while you set this up.
3. (For live payments later) complete **business/bank details** under Settings →
   Business — required before Live mode will accept real charges.

## 2. Create the products & prices

Dashboard → **Product catalog** → **+ Add product**. Create **two** products:

| Product | Prices to add |
|---|---|
| **Premium** | one **Monthly** recurring price, one **Yearly** recurring price |
| **Classroom** | one **Monthly** recurring price, one **Yearly** recurring price |

For each price: type **Recurring**, pick the billing period (monthly / yearly),
set the amount and currency. After saving, click each price and copy its
**Price ID** — it looks like `price_1QAbc...`. You'll need all four:

- Premium Monthly → `STRIPE_PRICE_PREMIUM_MONTHLY`
- Premium Yearly → `STRIPE_PRICE_PREMIUM_YEARLY`
- Classroom Monthly → `STRIPE_PRICE_CLASSROOM_MONTHLY`
- Classroom Yearly → `STRIPE_PRICE_CLASSROOM_YEARLY`

> Pricing amounts are your call (still an open question in MONETIZATION.md). The
> app maps **Price ID → plan**, so you can change amounts later by creating new
> prices and swapping the IDs in `.env` — no code change.

## 3. Enable the Customer Portal

Dashboard → Settings → **Billing** → **Customer portal** →  **Activate**. Turn on:

- **Cancel subscriptions** (so parents can self-cancel)
- **Update payment method**
- Optionally **Switch plans** — and add the Premium/Classroom products to the
  list of allowed products if you want in-portal upgrades/downgrades.

This is what the dashboard's **Manage billing** button opens; no custom UI needed.

## 4. Get the API keys

Dashboard → **Developers** → **API keys**:

- **Secret key** (`sk_test_...` in test, `sk_live_...` in live) → `STRIPE_SECRET_KEY`

The publishable key is **not** needed — the hosted Checkout + Portal flow is
entirely server-driven.

## 5. Create the webhook endpoint

The server exposes **`POST /api/billing/webhook`**. Stripe must be told to call it.

**Production (Live/Test on the real host):** Dashboard → Developers → **Webhooks**
→ **+ Add endpoint**:
- URL: `https://mydragonmath.com/api/billing/webhook`
- Events to send:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Save, then reveal the endpoint's **Signing secret** (`whsec_...`) →
  `STRIPE_WEBHOOK_SECRET`.

**Local development:** use the Stripe CLI instead (see [§8](#8-test-it)); it prints
its own `whsec_...` to use while testing.

## 6. Put the values in `.env`

Add to the server's `.env` (never commit it — it's gitignored;
`.env.example` lists the same keys as blanks):

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PREMIUM_MONTHLY=price_...
STRIPE_PRICE_PREMIUM_YEARLY=price_...
STRIPE_PRICE_CLASSROOM_MONTHLY=price_...
STRIPE_PRICE_CLASSROOM_YEARLY=price_...
```

Also confirm **`APP_PUBLIC_URL`** is set to the site's real origin (e.g.
`https://mydragonmath.com`) — it's used for the Checkout success/cancel and
Portal return URLs. Leave any price blank to keep that specific plan/interval
unpurchasable (checkout returns 503 for it).

## 7. Deploy

```bash
pm2 reload dragonmath-api --update-env
```

`--update-env` is required so the process picks up the new variables. No frontend
rebuild is needed for keys — the UI already ships the checkout buttons.

## 8. Test it

Install the CLI (<https://stripe.com/docs/stripe-cli>), then in test mode:

```bash
stripe login
# Forward live events to your local/staging server; prints a whsec_ to use:
stripe listen --forward-to localhost:4070/api/billing/webhook
```

Put that `whsec_...` in `STRIPE_WEBHOOK_SECRET`, reload, then:

1. Sign in as a parent → **Upgrade** → pick a plan → you land on Stripe Checkout.
2. Pay with the test card **`4242 4242 4242 4242`**, any future expiry, any CVC/ZIP.
3. Back on `/parent`: the plan flips to Premium/Classroom within a second or two
   (via the webhook), the child limit lifts, and the weekly digest + Dragon
   Munchers unlock.
4. Click **Manage billing** → cancel in the portal → the account returns to Free
   and the paid features re-lock.

You can also fire events directly:

```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.deleted
```

## 9. Go live

1. Flip the Dashboard to **Live mode** and redo: products/prices (§2), portal
   (§3), secret key (§4), webhook endpoint + signing secret (§5).
2. Replace the `sk_test_/whsec_/price_` values in production `.env` with the
   **live** equivalents.
3. `pm2 reload dragonmath-api --update-env`.
4. Do one real upgrade + cancel with a genuine card to confirm the end-to-end
   path, then refund it from the Dashboard.

---

## How it maps to the code

| Piece | Where |
|---|---|
| Price ID → plan mapping | [server/lib/entitlements.js](../server/lib/entitlements.js) (`PLAN_PRICES`, `priceIdFor`, `planForPriceId`) |
| Checkout / Portal / Webhook routes | [server/routes/billing.js](../server/routes/billing.js) |
| Raw-body carve-out for the webhook | [server/index.js](../server/index.js) (JSON parser skips `/api/billing/webhook`) |
| Plan status surfaced to the dashboard | [server/routes/parent.js](../server/routes/parent.js) (`GET /api/parent/me`) |
| Upgrade / Manage-billing UI | [src/pages/ParentDashboardPage.jsx](../src/pages/ParentDashboardPage.jsx) |
| Schema columns | [server/db/schema.js](../server/db/schema.js) (`stripe_customer_id`, `stripe_subscription_id`, `plan_status`, `plan_renews_at`) |

## Troubleshooting

- **Everything returns `503 "Billing is not configured."`** — `STRIPE_SECRET_KEY`
  isn't set, or you reloaded without `--update-env`.
- **Webhook `400 "No signatures found…"`** — `STRIPE_WEBHOOK_SECRET` doesn't match
  the endpoint (test vs live mismatch, or you used the CLI's secret in production).
- **Checkout succeeds but the plan doesn't change** — the webhook isn't reaching
  the server. Check the endpoint URL, that the four events are subscribed, and the
  delivery log in Dashboard → Webhooks. Confirm the raw-body carve-out is intact.
- **`503 "That plan is not available for purchase yet."`** — the matching
  `STRIPE_PRICE_*` env var is blank.
- **Plan flips but a paid feature stays locked** — features read the *current* DB
  plan; the parent's browser may hold a stale `/me`. A refresh fixes it (kids read
  their guardian's plan on next `/api/auth/me`).

## Security notes

- The secret key and webhook signing secret live only in server `.env`. Never ship
  them to the client.
- The webhook is public but authenticated by Stripe's **signature** — the
  signing-secret check is mandatory and already enforced.
- Stripe is the source of truth; `users.plan` is a cache the webhook writes. The
  admin manual plan toggle (`/api/admin/users/:id/plan`) stays as a comp/support
  override and doesn't touch Stripe — use it only for freebies, not paying users.
