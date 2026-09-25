// The `boss-battles` golden fixture (golden/boss-battles.json): matchOutcome()
// in ./bossBattle.js — stars, the boss's crown, and the companion a first boss
// win befriends — for every node the app plays (those with a default battle
// config), plus ids not on the map. No draws. Registered in buildGoldenFiles()
// in ./golden.js; the Swift port (GameRules BossBattle.swift) must match every
// case.

import { MAP_NODES } from '../data/mapData.js';
import { DEFAULT_BATTLE_CONFIGS, PROBLEMS_TO_WIN } from '../data/battleData.js';
import { COMPANIONS, NODE_TO_COMPANION } from '../data/companions.js';
import { matchOutcome, isBossNode } from './bossBattle.js';

const ALL_COMPANIONS = Object.keys(COMPANIONS);

function outcomeCase(nodeId, won, aiScore, target, ownedCompanionIds) {
  return {
    input: { nodeId, won, aiScore, target, ownedCompanionIds },
    expected: matchOutcome({ nodeId, won, aiScore, target, ownedCompanionIds }),
  };
}

function casesForNode(nodeId) {
  const t = PROBLEMS_TO_WIN;
  const cases = [
    // Every star threshold at the usual target, and one off-target (7) where
    // the thresholds fall between whole scores.
    ...[0, 4, 5, 7, 8, 9].map(ai => outcomeCase(nodeId, true, ai, t, ['pip'])),
    ...[3, 4, 5, 6].map(ai => outcomeCase(nodeId, true, ai, 7, ['pip'])),
    outcomeCase(nodeId, false, t, t, ['pip']),
  ];
  const companion = NODE_TO_COMPANION[nodeId];
  if (isBossNode(nodeId)) {
    cases.push(
      outcomeCase(nodeId, true, 2, t, []),
      outcomeCase(nodeId, true, 2, t, companion ? ['pip', companion] : ['pip']),
      outcomeCase(nodeId, true, 2, t, ALL_COMPANIONS),
      outcomeCase(nodeId, false, t, t, []),
    );
  }
  return cases;
}

export function bossBattlesFixture() {
  const nodeIds = MAP_NODES.map(n => n.id).filter(id => DEFAULT_BATTLE_CONFIGS[id]);
  return {
    fixture: 'boss-battles',
    version: 1,
    description:
      'matchOutcome() in src/rules/bossBattle.js for every node with a default battle config, plus ids not ' +
      'on the map (0, 999). expected.stars is null for a loss; crowned is a won boss; befriendsCompanionId is ' +
      "the boss's companion (NODE_TO_COMPANION) when won and not in ownedCompanionIds, else null. bossNodeIds " +
      'lists the boss nodes among them.',
    bossNodeIds: nodeIds.filter(isBossNode),
    cases: [...nodeIds, 0, 999].flatMap(casesForNode),
  };
}
