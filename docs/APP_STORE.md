# App Store subscriptions and plan status

How iOS in-app purchases become a plan on the server, and how that plan is
combined with Stripe, comps and classroom plans into one plan status per family.
The decision is [ADR 0008](adr/0008-ios-storekit-and-education-category.md);
the Stripe side is [STRIPE.md](STRIPE.md) and is unchanged by any of this.

**How it works:** a parent buys Premium in the iOS app with StoreKit 2. Apple
sends an **App Store Server Notification V2** to `POST /api/appstore/notifications`
every time that subscription changes (bought, renewed, failed to renew, expired,
refunded…). The server verifies Apple's signature, updates its copy of the
subscription, and every plan check then sees it through one resolver. Until the
env vars below are set, the endpoint returns `503` and nothing else changes.

---

## Linking a purchase to a family: `appAccountToken`

StoreKit lets the app attach a UUID, `appAccountToken`, to a purchase. Apple
repeats it on every transaction of that subscription, including renewals, so it
is how a notification finds its account.

- Each adult has one token, `users.app_account_token`, minted the first time
  they call `GET /api/plan/status` and never changed afterwards.
- `GET /api/plan/status` returns it as `app_account_token` for a **parent**
  session only (kids never buy; the purchase is behind the parental gate in the
  parent view). It is `null` for kids.
- The iOS app must pass it on every purchase:
  `product.purchase(options: [.appAccountToken(token)])`. A purchase without it,
  or with a token that matches no adult, is still recorded but grants nothing.
- The token is an identifier, not a credential. Someone who learned it could only
  pay for that family's premium.
- The subscription belongs to the **parent** who bought it. Their kids, and any
  other guardian's view of those kids, get it through the normal guardian rule:
  a child's plan is the best plan among their parents and classroom teachers.

A user id could not be used directly: ids are integers and StoreKit needs a
UUID.

## What each notification does

State lives in `app_store_subscriptions`, one row per
`(original_transaction_id, in_app_ownership_type)`. The purchaser's copy and a
Family Sharing member's copy are separate rows, so revoking one leaves the other.
The rules are in [server/lib/appStoreNotifications.js](../server/lib/appStoreNotifications.js).

| Notification | Row status | Grants premium? |
|---|---|---|
| `SUBSCRIBED` (INITIAL_BUY, RESUBSCRIBE), `DID_RENEW` (incl. BILLING_RECOVERY), `OFFER_REDEEMED`, `RENEWAL_EXTENDED`, `REFUND_REVERSED` | `active` | until `expires_at` |
| `DID_FAIL_TO_RENEW` / GRACE_PERIOD | `grace_period` | until the grace period ends |
| `DID_FAIL_TO_RENEW` (no subtype), `GRACE_PERIOD_EXPIRED` | `billing_retry` | no |
| `EXPIRED` | `expired` | no |
| `REFUND` | `refunded` | no |
| `REVOKE` (Family Sharing ended) | `revoked` | no |
| `DID_CHANGE_RENEWAL_STATUS`, `DID_CHANGE_RENEWAL_PREF`, `PRICE_INCREASE` | unchanged | unchanged (updates `will_renew`) |
| anything else (`TEST`, `CONSUMPTION_REQUEST`, …) | — | recorded, not applied |

Two properties matter:

- **Access is decided at read time.** An `active` row only grants premium while
  `expires_at` is in the future, so a lost `EXPIRED` notification still lets
  access end on time.
- **Exactly once, in order.** Every notification's `notificationUUID` goes into
  `app_store_notifications` in the same transaction as the subscription update.
  A redelivery is answered `200` and not applied again. A failure rolls both
  back and returns `5xx`, so Apple's retry is processed properly. A notification
  signed earlier than the state already stored is recorded as `stale` and not
  applied, because Apple does not guarantee delivery order.

## One plan status per family

[server/lib/planStatus.js](../server/lib/planStatus.js) turns everything that can
grant a plan into **grants**, and the highest plan wins
(`classroom` > `premium` > `free`):

| Source | Comes from |
|---|---|
| `stripe` | `users.plan`, written by the Stripe webhook, with an active/trialing/past_due subscription |
| `app_store` | an entitled `app_store_subscriptions` row |
| `comp` | a comped account's hand-granted `users.plan` |
| `manual` | a plan an admin set by hand |
| `classroom` | for a child: a classroom teacher's plan |

When two grants give the same plan, the one reported first is chosen in the order
comp, stripe, app_store, manual, classroom. This only changes what is reported,
never access.

Every plan check goes through this: `planForUser`, `effectivePlanForChild` and
`effectivePlanForUser` in [server/lib/entitlements.js](../server/lib/entitlements.js)
(child limits, game locks, the weekly digest, `/api/auth/me`, `/api/parent/me`)
and `GET /api/plan/status`. So the web and the app always agree. `users.plan`
itself still holds only what Stripe and the admin tools write. An App Store
subscriber's `users.plan` stays `free`, so anything that needs the plan must ask
the resolver, not read the column.

`GET /api/plan/status` is described in [server/openapi.json](../server/openapi.json)
(`getPlanStatus` → `PlanStatus`):

```json
{
  "plan": "premium",
  "source": "app_store",
  "expires_at": "2026-10-23T12:00:00.000Z",
  "will_renew": true,
  "grants": [{ "source": "app_store", "plan": "premium", "expires_at": "…", "will_renew": true }],
  "entitlements": { "games_locked": [], "child_limit": 6, "can_use_digest": true },
  "app_account_token": "0f8fad5b-d9cb-469f-a165-70867728950e"
}
```

---

## Operator setup

1. **Schema.** This change adds `users.app_account_token` and the tables
   `app_store_subscriptions` and `app_store_notifications`. Push it with
   [deploy/db-push.sh](../deploy/db-push.sh) before deploying the code.
2. **App Store Connect → App → App Information → App Store Server
   Notifications:** set the Production URL to
   `https://mydragonmath.com/api/appstore/notifications`, **Version 2**. Point the
   Sandbox URL at a non-production deployment configured with
   `APPSTORE_ENVIRONMENT=Sandbox`. One server accepts exactly one environment.
3. **Env** (see `.env.example`):

   ```
   APPSTORE_BUNDLE_ID=<the app's bundle id>
   APPSTORE_ENVIRONMENT=Production        # or Sandbox
   APPSTORE_APP_APPLE_ID=<numeric Apple ID, required for Production>
   APPSTORE_PREMIUM_PRODUCT_IDS=<monthly id>,<yearly id>
   # APPSTORE_ONLINE_CHECKS=false          # only if OCSP to Apple is blocked
   ```

   Only `Production` and `Sandbox` are accepted. Apple's library skips signature
   verification for its `Xcode` and `LocalTesting` environments, so those are
   refused rather than configurable.
4. **Check it:** App Store Connect can send a test notification (or use the App
   Store Server API's *Request a Test Notification*). It arrives as `TEST` and the
   log shows `App Store notification … TEST -> ignored`.

## Trust anchor

The payload is a JWS. Its `x5c` header carries leaf → intermediate → root, and
[server/lib/appStoreVerifier.js](../server/lib/appStoreVerifier.js) uses Apple's
own [`@apple/app-store-server-library`](https://github.com/apple/app-store-server-library-node)
to check that chain against **Apple Root CA - G3**, pinned at
[server/certs/AppleRootCA-G3.pem](../server/certs/AppleRootCA-G3.pem). The library
also checks Apple's marker extensions on the chain, the signature, the bundle id
and the environment, and (online checks on) OCSP revocation. A test asserts the
pinned certificate's SHA-256 fingerprint. It is valid until 2039-04-30.

Tests never use Apple's certificates or the network.
[server/lib/appStoreTesting.js](../server/lib/appStoreTesting.js) generates a
throwaway chain per run and signs payloads with it, and the verifier is told to
trust that root.

## Not done yet

- **Immediate linking after purchase.** The server learns of a purchase from the
  `SUBSCRIBED` notification, usually within seconds. The app already has the
  entitlement locally from StoreKit, so nothing waits on this. An endpoint where
  the app posts the signed transaction would make it instant.
- **Double billing across stores.** Nothing stops a family paying through both
  Stripe and the App Store. `GET /api/plan/status` shows both grants, so the web
  upgrade button could hide itself when `source` is `app_store`.
- **Admin views** still show the stored `users.plan`, not the resolved plan.
