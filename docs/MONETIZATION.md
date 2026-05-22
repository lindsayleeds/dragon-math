# Dragon Math — Monetization Notes

Exploratory notes on how to bring in revenue. Two ideas under consideration:

1. **Paid custom avatars** (cosmetic microtransactions for kids)
2. **Parent-account subscription** ($X/year)

## Recommendation

Lead with the **parent subscription** as the primary play. Treat avatars as a
perk *inside* that tier rather than a standalone purchase.

## Reasoning

- **Parent subscription aligns incentives.** Parents pay because they see
  educational value — progress reports, multi-child support, detailed stats
  (the kind of thing the existing `ParentChildStatsPage` already hints at).
  Predictable ARR, clean optics.
- **Paid avatars for kids in an ed-app risks looking predatory.** App Store
  reviewers, parent reviews, and press are sensitive to monetization aimed at
  kids in K–12 products. Revenue is also lumpy. Works for Fortnite; weird fit
  for a math tutor.

## Tradeoff

A paywall on parent features could slow word-of-mouth growth. Mitigate by:

- Keeping the **kid experience generous and free** (battles, map, Dragon's
  Trial, normal progression).
- Gating only **parent-facing** features behind the subscription (analytics,
  multi-child, custom content, weekly reports).
- The kid never hits a wall mid-fun; the parent decides whether the extra
  visibility is worth paying for.

## Concrete shape worth considering

- **Free tier:** one child, basic parent view.
- **Family tier (~$30–50/yr):** multi-child, deeper stats, weekly email
  reports, and cosmetic packs (avatars, dragon skins) bundled as a sweetener.

## Open questions

- Pricing point — $30 vs $50/yr; monthly option?
- One-time "unlock" alternative for parents who hate subscriptions?
- Should cosmetic packs ever be purchasable à la carte, or strictly bundled?
- How does this interact with school/classroom use cases (if any)?
