// The `companions` golden fixture (golden/companions.json): the companion
// catalog in src/data/companions.js — each companion and its Bond Power — in
// the order the collection shows them, for the Swift catalog
// (GameRules Companions.swift) to match exactly. No rules or draws; a drift
// check on data. Registered in buildGoldenFiles() in ./golden.js.
//
// Optional fields are null rather than missing, so the Swift decoder sees
// every key: capturedAtNodeId (null for Pip, the starter) and
// bondPower.durationMs (null for the untimed powers).

import { COMPANIONS } from '../data/companions.js';

export function companionsFixture() {
  return {
    fixture: 'companions',
    version: 1,
    description:
      'The companion catalog (COMPANIONS in src/data/companions.js), in collection order: Pip, the starter, ' +
      'then the boss companions in world order. capturedAtNodeId is the boss node that befriends one (null for ' +
      'Pip); bondPower is what the battle reducer takes (kind, cooldownMs, durationMs, highlightColor) plus its name.',
    companions: Object.values(COMPANIONS).map(c => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      tagline: c.tagline,
      capturedAtNodeId: c.capturedAtNodeId ?? null,
      bondPower: {
        name: c.bondPower.name,
        kind: c.bondPower.kind,
        cooldownMs: c.bondPower.cooldownMs,
        durationMs: c.bondPower.durationMs ?? null,
        highlightColor: c.bondPower.highlightColor,
      },
    })),
  };
}
