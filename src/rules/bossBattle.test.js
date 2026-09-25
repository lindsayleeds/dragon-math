import { describe, expect, it } from 'vitest';
import { matchOutcome, isBossNode, matchStars } from './bossBattle';

describe('bossBattle', () => {
  it('knows the boss nodes', () => {
    expect([8, 16, 25, 33, 41].every(isBossNode)).toBe(true);
    expect(isBossNode(1)).toBe(false);
    expect(isBossNode(999)).toBe(false);
  });

  it('gives stars by how far the opponent got', () => {
    expect(matchStars(4, 10)).toBe(3);
    expect(matchStars(5, 10)).toBe(2);
    expect(matchStars(7, 10)).toBe(2);
    expect(matchStars(8, 10)).toBe(1);
  });

  it('crowns a won boss and befriends its companion once', () => {
    expect(matchOutcome({ nodeId: 8, won: true, aiScore: 2, target: 10, ownedCompanionIds: ['pip'] }))
      .toEqual({ stars: 3, crowned: true, befriendsCompanionId: 'forest_dragon' });
    expect(matchOutcome({ nodeId: 8, won: true, aiScore: 2, target: 10, ownedCompanionIds: ['pip', 'forest_dragon'] }))
      .toEqual({ stars: 3, crowned: true, befriendsCompanionId: null });
  });

  it('neither crowns nor befriends on a loss or a regular node', () => {
    expect(matchOutcome({ nodeId: 8, won: false, aiScore: 10, target: 10 }))
      .toEqual({ stars: null, crowned: false, befriendsCompanionId: null });
    expect(matchOutcome({ nodeId: 7, won: true, aiScore: 9, target: 10 }))
      .toEqual({ stars: 1, crowned: false, befriendsCompanionId: null });
  });
});
