// What sets a boss battle apart once it ends: the stars a win earns, whether
// it's crowned (the 👑 and "The dragon bows to you!" in BattlePage.jsx's
// result), and which companion the win befriends — shown as the capture
// celebration the first time a boss is beaten. The match itself plays by the
// same reducer as any node (./battle.js); a boss's difficulty is only its
// node config.
//
// Pure, no draws. The Swift port is GameRules BossBattle.swift; the
// `boss-battles` golden fixture (./bossBattleGolden.js) is the check.

import { MAP_NODES, NODE_TYPE } from '../data/mapData.js';
import { NODE_TO_COMPANION } from '../data/companions.js';

// Whether `nodeId` is a boss node. An id not on the map is not.
export function isBossNode(nodeId) {
  return MAP_NODES.find(n => n.id === nodeId)?.type === NODE_TYPE.BOSS;
}

// Stars for a won match: 3 if the opponent got fewer than half the target,
// 2 if under three quarters, else 1.
export function matchStars(aiScore, target) {
  if (aiScore < target * 0.5) return 3;
  if (aiScore < target * 0.75) return 2;
  return 1;
}

// How a finished match on `nodeId` turns out.
//   won                 whether the player reached the target first
//   aiScore, target     the final opponent score and the target
//   ownedCompanionIds   the companions the player already has
// Returns { stars, crowned, befriendsCompanionId }: stars only for a win (else
// null); crowned for a won boss; befriendsCompanionId is the boss's companion
// when a win befriends one not yet owned, else null.
export function matchOutcome({ nodeId, won, aiScore, target, ownedCompanionIds = [] }) {
  const boss = isBossNode(nodeId);
  const companionId = boss ? NODE_TO_COMPANION[nodeId] ?? null : null;
  return {
    stars: won ? matchStars(aiScore, target) : null,
    crowned: won && boss,
    befriendsCompanionId:
      won && companionId && !ownedCompanionIds.includes(companionId) ? companionId : null,
  };
}
