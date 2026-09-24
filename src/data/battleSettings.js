// Game-wide battle tunables, served in the `battle` section of
// GET /api/rule-settings (server/lib/ruleSettings.js owns the document).
//
// DEFAULT_BATTLE_SETTINGS is the fallback used until that response arrives, or
// when it fails or is missing a field. It must equal the server's
// BATTLE_SETTINGS exactly — server/lib/ruleSettings.test.js asserts it — so a
// battle played offline is the same battle as one played online.

export const DEFAULT_BATTLE_SETTINGS = Object.freeze({
  // Opponent solve delay: aiSeconds * 1000, jittered by ±(aiJitterFraction / 2)
  // — 0.35 is ±17.5% — and never shorter than aiMinDelayMs.
  aiJitterFraction: 0.35,
  aiMinDelayMs: 1500,
  // Cells go blank for this long between problems before the next grid appears.
  gridBlankMs: 500,
  // When the opponent solves it, it "appears in the answer cell and eats the
  // number" (à la Dragon Munchers) — the window that animation plays in before
  // the next problem swaps in.
  gridBlankAiMs: 2000,
  // A wrong tap locks the whole grid for this long — a "think it through"
  // pause before the child can tap again.
  gridLockMs: 4000,
  // The tapped wrong cell flashes for this long.
  wrongFlashMs: 350,
});

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

// Build runtime battle settings from a /api/rule-settings document, falling
// back field by field so a partial or older document still plays.
export function battleSettingsFromServer(doc) {
  const d = DEFAULT_BATTLE_SETTINGS;
  const opponent = doc?.battle?.opponent ?? {};
  const timings = doc?.battle?.timings ?? {};
  return {
    aiJitterFraction: finiteOr(opponent.jitter_fraction, d.aiJitterFraction),
    aiMinDelayMs: finiteOr(opponent.min_delay_ms, d.aiMinDelayMs),
    gridBlankMs: finiteOr(timings.grid_blank_ms, d.gridBlankMs),
    gridBlankAiMs: finiteOr(timings.grid_blank_ai_ms, d.gridBlankAiMs),
    gridLockMs: finiteOr(timings.grid_lock_ms, d.gridLockMs),
    wrongFlashMs: finiteOr(timings.wrong_flash_ms, d.wrongFlashMs),
  };
}
