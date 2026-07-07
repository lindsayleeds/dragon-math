// The mini-games available in the Learning Lair, plus which math skills each one
// can practice. `skills` lists the operation keys (see data/operations.js) a
// game supports — used both to filter the game chooser down to a chosen skill,
// and to offer the right skills when a game is picked first.
//
// A game with its own dedicated page (not tied to a math operation) sets
// `route` and leaves `skills` empty: it's shown in the "Choose a game" grid but
// stays out of the per-operation game chooser. Dragon Spelling works this way.
export const GAME_TYPES = [
  {
    id: 'dragon-egg-hatchery',
    name: 'Dragon Egg Hatchery',
    emoji: '🥚',
    description: 'Help dragon eggs hatch by solving facts quickly!',
    skills: ['add', 'sub', 'mul', 'div'],
  },
  {
    id: 'dragon-munchers',
    name: 'Dragon Munchers',
    emoji: '🐉',
    description: 'Navigate the grid and avoid the dragons! Keep your muncher safe.',
    skills: ['mul'],
  },
  {
    id: 'stepping-stones',
    name: 'Stepping Stones',
    emoji: '🪨',
    description: 'Cross the river by tapping lily pads in skip-counting order!',
    skills: ['mul'],
  },
  {
    id: 'proving-grounds',
    name: 'Proving Grounds',
    emoji: '🏆',
    description: 'Prove your × and ÷ facts against the clock — earn bronze, silver, or gold!',
    skills: [], // self-contained: picks its own operation + digit (see `route`)
    route: '/proving-grounds',
  },
  {
    id: 'dragon-spelling',
    name: 'Dragon Spelling',
    emoji: '🐲',
    description: 'Listen to a word, then spell it! Pick your grade and level.',
    skills: [], // not a math game — launches its own page (see `route`)
    route: '/dragon-spelling',
  },
];

export const GAME_BY_ID = Object.fromEntries(GAME_TYPES.map(g => [g.id, g]));

// Games that can practice a given operation key, in their listed order.
export function gamesForSkill(operationKey) {
  return GAME_TYPES.filter(g => g.skills.includes(operationKey));
}
