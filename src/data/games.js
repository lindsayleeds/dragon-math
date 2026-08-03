import { OPERATIONS } from './operations';

// The mini-games available in the Learning Lair. Each game declares two related
// but distinct things, and they are not interchangeable:
//
//   `skills`    — operation keys (see data/operations.js) the launch flow can
//                 hand this game, i.e. the skills it will *ask the player to
//                 pick between*. Also filters the per-number game chooser.
//   `practices` — what the game tests, for the lair's skill badges and skill
//                 filter. A superset of `skills`: a game that chooses its own
//                 operation internally still practices those skills, and the
//                 literacy games practice tags that aren't operations at all.
//
// A game with its own dedicated page (not tied to a math operation the lair
// picks) sets `route` and leaves `skills` empty: it's still listed and still
// filterable via `practices`, but stays out of the per-operation game chooser.
export const GAME_TYPES = [
  {
    id: 'dragon-egg-hatchery',
    name: 'Dragon Egg Hatchery',
    emoji: '🥚',
    description: 'Help dragon eggs hatch by solving facts quickly!',
    skills: ['add', 'sub', 'mul', 'div'],
    practices: ['add', 'sub', 'mul', 'div'],
  },
  {
    id: 'dragon-munchers',
    name: 'Dragon Munchers',
    emoji: '🐉',
    description: 'Navigate the grid and avoid the dragons! Keep your muncher safe.',
    skills: ['mul'],
    practices: ['mul'],
  },
  {
    id: 'stepping-stones',
    name: 'Stepping Stones',
    emoji: '🪨',
    description: 'Cross the river by tapping lily pads in skip-counting order!',
    skills: ['mul'],
    practices: ['mul'],
  },
  {
    id: 'proving-grounds',
    name: 'Proving Grounds',
    emoji: '🏆',
    description: 'Prove your × and ÷ facts against the clock — earn bronze, silver, or gold!',
    skills: [], // self-contained: picks its own operation + digit (see `route`)
    practices: ['mul', 'div'],
    route: '/proving-grounds',
  },
  {
    id: 'dragon-spelling',
    name: 'Dragon Spelling',
    emoji: '🐲',
    description: 'Listen to a word, then spell it! Pick your grade and level.',
    skills: [], // not a math game — launches its own page (see `route`)
    practices: ['spelling'],
    route: '/dragon-spelling',
  },
  {
    id: 'dragon-phonics',
    name: 'Dragon Phonics',
    emoji: '🔤',
    description: 'Listen to a word, then tap the missing sound! Vowels, blends, and more.',
    skills: [], // not a math game — launches its own page (see `route`)
    practices: ['phonics'],
    route: '/dragon-phonics',
  },
];

export const GAME_BY_ID = Object.fromEntries(GAME_TYPES.map(g => [g.id, g]));

// --- Skill tags (badges on a game card + the lair's filter row) ---

// The math tags ARE the operations, reused rather than re-typed so a color or
// label change lands in one place. The literacy tags exist only here: nothing
// stores mastery for them, so they never appear in data/operations.js.
const LITERACY_TAGS = [
  { key: 'spelling', label: 'Spelling', symbol: '✎', color: '#c79bb8' },
  { key: 'phonics',  label: 'Phonics',  symbol: '🔤', color: '#a07859' },
];

export const SKILL_TAGS = [
  ...OPERATIONS.map(({ key, label, symbol, color }) => ({ key, label, symbol, color })),
  ...LITERACY_TAGS,
];

export const SKILL_TAG_BY_KEY = Object.fromEntries(SKILL_TAGS.map(t => [t.key, t]));

// Tags at least one game practices, in SKILL_TAGS order — so adding a game with
// a new tag adds a filter chip, and dropping the last game that practices a tag
// removes the chip instead of leaving one that filters to nothing.
export function practisedSkillTags() {
  return SKILL_TAGS.filter(tag => GAME_TYPES.some(g => g.practices.includes(tag.key)));
}

// Games that can practice a given operation key, in their listed order.
export function gamesForSkill(operationKey) {
  return GAME_TYPES.filter(g => g.skills.includes(operationKey));
}

// --- Monetization (mirrors server/lib/entitlements.js — keep in sync) ---

// Games that require a paid plan. Kept identical to PAID_GAME_IDS on the server.
export const PAID_GAME_IDS = ['dragon-munchers', 'dragon-spelling', 'proving-grounds'];

const PAID_PLANS = ['premium', 'classroom'];

export function isPaidPlan(plan) {
  return PAID_PLANS.includes(plan);
}

// A game is locked when it's paid-only and the player's (effective) plan is free.
// `plan` is the child's effective_plan from the auth user object.
export function isGameLocked(gameId, plan) {
  return PAID_GAME_IDS.includes(gameId) && !isPaidPlan(plan);
}
