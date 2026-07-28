# Dragon Math — Pricing Strategy Proposal

_Drafted 2026-07-20. Status: proposal for review — nothing changed in Stripe yet._

Companion to [MONETIZATION.md](MONETIZATION.md) (the *implemented* system) and
[../GAPS.md](../GAPS.md) items 1a–1d. This doc is the *recommendation*.

---

## TL;DR — proposed price card

| Tier | Buyer | Monthly | Annual | Annual = /mo | Kids | Change vs today |
|---|---|---|---|---|---|---|
| **Free** | sampler | $0 | — | — | 1 | (repackage — Phase 2) |
| **Premium (Family)** | parents | **$7.99** | **$59.99** | $5.00 (–37%) | up to 6 | $2.99 → **$7.99** (+167%) |
| **Classroom** | teachers | $9.99 | **$79/yr** | $6.58 | up to 35 | $4.99 → per-class annual |
| **School / District** | admins | — | Custom | — | unlimited | NEW — "Contact us" lead capture |

Headline moves:
1. **Premium $2.99 → $7.99/mo** (annual $59.99). Into the engagement-game band.
2. **Lead with annual.** Kids-learning is seasonal; annual lock-in is the single
   biggest lever on churn (your #1 risk). Deep ~37% discount is intentional.
3. **Widen the Premium↔Classroom gap** by making them *different buyers*, not
   adjacent tiers — kills the cannibalization problem.
4. **Reprice Classroom to per-classroom/year** and add a **School/District**
   "Contact us" tier so heavy users stop paying $0.15/student.
5. **Grandfather every existing subscriber** at their current price.

---

## Positioning principles (the "why")

- **IXL is not our comp.** IXL's ~$10 consumer price is a loss-leader subsidized
  by district site licenses (a B2B business we don't have yet), and it's their
  *single-subject* price — the all-subjects family plan is ~$20/mo. IXL sells a
  *utility* (assigned worksheets); we sell *engagement* (a game the kid asks to
  play). Do not anchor our price to a scaled incumbent's subsidized floor.
- **Our comp set is the engagement-game category:** Prodigy Math (~$8–13/mo
  premium — our closest analog), SplashLearn (~$12), Duolingo (~$7–13), Beast
  Academy (~$15). It clusters **$8–15**. $7.99 places us at the accessible end,
  honestly reflecting that we're younger and narrower than the leaders while
  still ~2.5× today's price.
- **Don't fight the giant on price.** A small indie cannot win a price war
  against a scaled incumbent — cheaper just signals "lesser" and starves the
  margin needed to ever close the content gap. Price to category + differentiation.
- **Turn generosity into a feature.** Unlike IXL (which charges per additional
  child), Premium covers **up to 6 kids for one price** — a concrete marketing
  asset for multi-kid families. (Down from today's 9; 6 is plenty for a family
  and stops extended-family/co-op sharing from cannibalizing Classroom.)

---

## Tier detail

### Free — the hook
Purpose: get the *kid* hooked so the kid becomes the salesperson to the parent.
Keep it genuinely fun; gate **breadth**, **parent value**, and **extra kids** —
never gate the core fun-loop hard enough to kill top-of-funnel virality.
- 1 child.
- A **sampler of every game type** (hatchery, spelling, phonics, etc.) so the kid
  discovers what they like — but map progression capped at **Worlds 1–2** of 6.
- No weekly digest; only basic "last played" for the parent.

> Phase 2 change. Today's free tier gives away almost everything (all 6 worlds,
> all games except Munchers). That's why there's no reason to pay. Gating
> Worlds 3–6 + parent insight is the real conversion lever — see Rollout Phase 2.

### Premium (Family) — the core B2C product — **$7.99/mo · $59.99/yr**
Everything unlocked:
- Up to **6 children**, one price, no per-child fees.
- All 6 worlds, all mini-games, **Dragon Munchers**, Tribes.
- **Weekly digest + full parent insights** (mastery, hardest facts, time-on-task).
- This is where the paid *value story* lives: "your kid begs to do math **and**
  you get a real report card." Build the upgrade prompts around the parent-insight
  moment (after the first weekly-digest teaser, after a mastery milestone).

### Classroom — for individual teachers — **$9.99/mo · $79/yr** (up to 35 students)
- Reprice off the $39.99/yr floor. At 35 students, $79/yr ≈ $2.25/student/yr —
  still cheap for a school, but ~2× today and it finally monetizes the heaviest
  users instead of losing money on them.
- Annual is the natural default (aligns to the school year). Keep a monthly
  option for trial-minded teachers.
- Includes class management, join codes, class-level analytics, and (future)
  standards alignment — the features teachers actually buy for (see GAPS 4a).

### School / District — **Custom / "Contact us"** (NEW)
- Don't build billing for this yet — just a **lead-capture** button. This is
  where the real money is later (site licenses, SSO, DPA). Capturing the lead now
  costs nothing and tells you whether the school motion is real before you invest
  in GAPS 4a/4b (standards + roster SSO).

---

## Annual anchoring

- **Present annual as the default / "Best value."** Show monthly as the
  fallback. Most successful kids-learning apps convert the majority to annual.
- Premium annual $59.99 = **$5.00/mo, ~37% off** (≈ 4.5 months free). Steeper
  than typical SaaS (~2 months free) on purpose: annual prepay slashes churn and
  smooths cash flow, and churn is the biggest threat to a subscription with a
  seasonal, kid-driven use pattern.
- If you'd rather protect margin over conversion, $69.99/yr ($5.83/mo, –27%) is
  the more conservative anchor. Pick one before wiring Stripe.

---

## Illustrative revenue impact

Assumptions (illustrative — replace with your real funnel once GAPS 6a analytics
exist): a cohort of **100 paying Premium families**, and a new-plan mix of
50% monthly / 50% annual (annual counted at its $5.00/mo equivalent).

| | Blended ARPU / family / mo | Monthly | Annualized |
|---|---|---|---|
| **Today** (all $2.99) | $2.99 | $299 | $3,588 |
| **Proposed** (½ @ $7.99, ½ @ $5.00) | $6.50 | $650 | $7,800 |
| **Delta** | **+$3.51 (+117%)** | **+$351** | **+$4,212** |

Per 100 paying families you roughly **double revenue on price alone** — before
counting (a) the trial lifting *conversion*, (b) annual lifting *LTV/retention*,
and (c) Classroom repricing capturing school revenue that is ~$0 today. The LTV
uplift is materially larger than the 2.2× headline because annual prepay changes
the retention curve, not just the sticker.

Risk of raising price: near-zero on *existing* revenue if you **grandfather**
(below). New-subscriber conversion may dip a few points at $7.99 vs $2.99, but
ARPU more than compensates — and there's little evidence $2.99 out-converts
$7.99 enough to matter.

---

## Migration & implementation notes

- **Stripe prices are immutable** — you can't edit an amount. Create **new Price
  objects** and point the `STRIPE_PRICE_*` env vars at them. Keep the old Price
  IDs alive so grandfathered subs keep billing.
- **Grandfather existing subscribers.** They stay on their current Price until
  they voluntarily change; only new checkouts use the new Prices. (Optional: a
  "your price is locked" email — loyalty goodwill.)
- **Child limit is a one-line config change** — `CHILD_LIMIT.premium` in
  [server/lib/entitlements.js](../server/lib/entitlements.js) (9 → 6). Existing
  families over the new cap are grandfathered by not enforcing retroactively.
- **Free trial** (GAPS 1c) — add `subscription_data: { trial_period_days: 7 }`
  (or 14) to the Checkout session in
  [server/routes/billing.js](../server/routes/billing.js); pair with a
  "trial ending" email via the existing Resend setup.
- **Copy/UI** — update the pricing/upgrade screens and the plan comparison in
  [src/data/games.js](../src/data/games.js) to match the new card.

---

## Rollout sequence (combined launch — per decision 4)

0. **Pre-req — stand up basic funnel analytics (GAPS 6a) first.** Because prices
   and packaging change together, you can't attribute which lever moved
   conversion without at least aggregate trial→paid tracking. Minimum: log
   trial-started / trial-converted / churned so the launch is measurable.
1. **Launch (single push):**
   - Create new Stripe Prices (Premium $7.99/mo · $59.99/yr; Classroom
     $9.99/mo · $79/yr); repoint `STRIPE_PRICE_*` env vars; keep old Price IDs
     live for grandfathered subs.
   - Add `trial_period_days: 14` to the Checkout session.
   - `CHILD_LIMIT.premium` 9 → 6.
   - Repackage the **Free tier** (gate Worlds 3–6 + parent insights) and update
     pricing/upgrade copy in [src/data/games.js](../src/data/games.js).
   - Add contextual upgrade prompts at the parent-insight moment.
2. **Fast-follow:** trial-ending + failed-payment (dunning) emails on the Resend
   stack. Required before considering a 30-day trial (decision 2).
3. **Later:** Stand up the **School/District** motion — standards alignment
   (GAPS 4a) + roster SSO (GAPS 4b) + "Contact us" → real quotes.

---

## Decisions (locked 2026-07-20)

1. **Premium annual = $59.99/yr** (–37%, $5.00/mo). Max conversion to annual /
   anti-churn lock-in.
2. **Free trial = 14 days.** Hybrid model (limited free demo + trial), ABCmouse-
   shaped. Chose 14 over 30 because 30-day trials depend on solid dunning +
   cancellation-reminder emails, which don't exist yet (default Stripe handling
   only) — 30 would manufacture forgot-to-cancel refunds/chargebacks/bad reviews.
   **Revisit to 30 as an acquisition play once trial-ending + dunning emails ship.**
3. **Premium child cap = 6** (down from 9).
4. **Rollout = prices + free-tier repackage together** (single push), not
   staged. See revised sequence above. Note: harder to attribute which change
   moved conversion — stand up GAPS 6a analytics first so the combined launch is
   at least measurable in aggregate.
