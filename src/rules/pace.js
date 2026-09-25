// The game pace: a per-child parent setting (the iOS parent area, stored on the
// server as users.game_pace) that slows down or turns off the clocks a child
// races against in a battle and in Dragon Munchers. It is an input to the pure
// reducers (src/rules/battle.js, src/rules/munchers.js), fixed for a game, and
// the Swift ports (GameRules Pace.swift) copy it.
//
//   normal  the rules as they have always been (the web always plays this)
//   slow    every race clock runs SLOW_PACE_FACTOR times slower:
//             battle   the opponent's solve delay (base and jitter; the
//                      aiMinDelayMs floor is not scaled)
//             munchers the spawn interval, the monster step interval and the
//                      telegraph before each step
//           Presentation beats (grid blanks, flashes, the grid lock, the
//           gobble beat) are not races and keep their served lengths.
//   off     untimed: nothing races the child.
//             battle   the opponent never runs (no solve timer, no draw for
//                      one), so the match is first to `target` for the child
//                      alone; Bond Powers still work
//             munchers no monsters: spawn, plan and commit timers never arm,
//                      so the board is a calm hunt for the right answers and
//                      only wrong answers cost lives
//
// Unknown values read as normal, so a newer server's pace can't break play.

export const PACE = Object.freeze({ NORMAL: 'normal', SLOW: 'slow', OFF: 'off' });
export const PACES = Object.freeze([PACE.NORMAL, PACE.SLOW, PACE.OFF]);

export const SLOW_PACE_FACTOR = 2;

export function normalizePace(pace) {
  return PACES.includes(pace) ? pace : PACE.NORMAL;
}

// How many times slower the race clocks run (1 when untimed: nothing runs).
export function paceFactor(pace) {
  return normalizePace(pace) === PACE.SLOW ? SLOW_PACE_FACTOR : 1;
}

export function isUntimed(pace) {
  return normalizePace(pace) === PACE.OFF;
}
