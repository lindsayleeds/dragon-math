// Battle-grid shape library.
//
// Each shape is an ASCII art block where 'X' = active cell (shows a number)
// and '.' = empty spacer. Parse with parseBattleLayout() in battleData.js.
//
// To attach a shape to a node/level, reference it by id from BATTLE_SHAPES.

export const BATTLE_SHAPES = {
  diamond: {
    name: 'Diamond',
    cells: 13, width: 5, height: 5,
    art: `\
..X..
.XXX.
XXXXX
.XXX.
..X..`,
  },

  'diamond-mini': {
    name: 'Mini Diamond',
    cells: 5, width: 3, height: 3,
    art: `\
.X.
XXX
.X.`,
  },

  hexagon: {
    name: 'Hexagon',
    cells: 16, width: 5, height: 4,
    art: `\
.XXX.
XXXXX
XXXXX
.XXX.`,
  },

  plus: {
    name: 'Plus',
    cells: 9, width: 5, height: 5,
    art: `\
..X..
..X..
XXXXX
..X..
..X..`,
  },

  'plus-big': {
    name: 'Big Plus',
    cells: 13, width: 7, height: 7,
    art: `\
...X...
...X...
...X...
XXXXXXX
...X...
...X...
...X...`,
  },

  'cross-x': {
    name: 'X Cross',
    cells: 9, width: 5, height: 5,
    art: `\
X...X
.X.X.
..X..
.X.X.
X...X`,
  },

  heart: {
    name: 'Heart',
    cells: 16, width: 5, height: 5,
    art: `\
.X.X.
XXXXX
XXXXX
.XXX.
..X..`,
  },

  flower: {
    name: 'Flower',
    cells: 17, width: 5, height: 5,
    art: `\
.X.X.
XXXXX
.XXX.
XXXXX
.X.X.`,
  },

  sun: {
    name: 'Sun',
    cells: 17, width: 5, height: 5,
    art: `\
X.X.X
.XXX.
XXXXX
.XXX.
X.X.X`,
  },

  'moon-crescent': {
    name: 'Crescent Moon',
    cells: 12, width: 5, height: 5,
    art: `\
.XXX.
XX...
XX...
XX...
.XXX.`,
  },

  butterfly: {
    name: 'Butterfly',
    cells: 19, width: 5, height: 5,
    art: `\
X.X.X
XXXXX
.XXX.
XXXXX
X.X.X`,
  },

  'bee-stripes': {
    name: 'Bee Stripes',
    cells: 18, width: 5, height: 5,
    art: `\
.XXX.
XXXXX
.X.X.
XXXXX
.XXX.`,
  },

  tree: {
    name: 'Tree',
    cells: 14, width: 5, height: 6,
    art: `\
..X..
.XXX.
XXXXX
.XXX.
..X..
..X..`,
  },

  mushroom: {
    name: 'Mushroom',
    cells: 15, width: 5, height: 5,
    art: `\
.XXX.
XXXXX
XXXXX
..X..
..X..`,
  },

  leaf: {
    name: 'Leaf',
    cells: 15, width: 5, height: 5,
    art: `\
....X
..XXX
.XXXX
XXXX.
XXX..`,
  },

  cloud: {
    name: 'Cloud',
    cells: 23, width: 7, height: 4,
    art: `\
.XX.XX.
XXXXXXX
XXXXXXX
.XXXXX.`,
  },

  mountain: {
    name: 'Mountain',
    cells: 16, width: 7, height: 4,
    art: `\
...X...
..XXX..
.XXXXX.
XXXXXXX`,
  },

  wave: {
    name: 'Wave',
    cells: 14, width: 7, height: 3,
    art: `\
XX...XX
XXXXXXX
..XXX..`,
  },

  fish: {
    name: 'Fish',
    cells: 17, width: 7, height: 3,
    art: `\
.XXXX.X
XXXXXXX
.XXXX.X`,
  },

  gem: {
    name: 'Gem',
    cells: 15, width: 5, height: 5,
    art: `\
.XXX.
XXXXX
.XXX.
.XXX.
..X..`,
  },

  crystal: {
    name: 'Crystal',
    cells: 14, width: 3, height: 6,
    art: `\
.X.
XXX
XXX
XXX
XXX
.X.`,
  },

  honeycomb: {
    name: 'Honeycomb',
    cells: 17, width: 5, height: 5,
    art: `\
.X.X.
XXXXX
X.X.X
XXXXX
.X.X.`,
  },

  star: {
    name: 'Star',
    cells: 15, width: 5, height: 5,
    art: `\
..X..
XXXXX
.XXX.
XX.XX
X...X`,
  },

  crown: {
    name: 'Crown',
    cells: 22, width: 7, height: 4,
    art: `\
X..X..X
X.XXX.X
XXXXXXX
XXXXXXX`,
  },

  'arrow-up': {
    name: 'Arrow Up',
    cells: 11, width: 5, height: 5,
    art: `\
..X..
.XXX.
XXXXX
..X..
..X..`,
  },

  ring: {
    name: 'Ring',
    cells: 12, width: 5, height: 5,
    art: `\
.XXX.
X...X
X...X
X...X
.XXX.`,
  },

  staircase: {
    name: 'Staircase',
    cells: 12, width: 6, height: 4,
    art: `\
XXX...
.XXX..
..XXX.
...XXX`,
  },

  'anchor-t': {
    name: 'Anchor (I-beam)',
    cells: 13, width: 5, height: 5,
    art: `\
XXXXX
..X..
..X..
..X..
XXXXX`,
  },

  'letter-h': {
    name: 'Letter H',
    cells: 13, width: 5, height: 5,
    art: `\
X...X
X...X
XXXXX
X...X
X...X`,
  },

  'zigzag-z': {
    name: 'Zigzag Z',
    cells: 15, width: 5, height: 5,
    art: `\
XXXXX
...XX
..X..
XX...
XXXXX`,
  },

  // ─── Small shapes (5–10 cells) ────────────────────────────────────────────

  'triangle-up': {
    name: 'Triangle Up',
    cells: 9, width: 5, height: 3,
    art: `\
..X..
.XXX.
XXXXX`,
  },

  'triangle-down': {
    name: 'Triangle Down',
    cells: 9, width: 5, height: 3,
    art: `\
XXXXX
.XXX.
..X..`,
  },

  'letter-l': {
    name: 'Letter L',
    cells: 5, width: 3, height: 3,
    art: `\
X..
X..
XXX`,
  },

  'letter-t': {
    name: 'Letter T',
    cells: 5, width: 3, height: 3,
    art: `\
XXX
.X.
.X.`,
  },

  bowtie: {
    name: 'Bowtie',
    cells: 5, width: 3, height: 3,
    art: `\
X.X
.X.
X.X`,
  },

  chevron: {
    name: 'Chevron',
    cells: 5, width: 5, height: 3,
    art: `\
X...X
.X.X.
..X..`,
  },

  'kite-small': {
    name: 'Small Kite',
    cells: 6, width: 3, height: 4,
    art: `\
.X.
XXX
.X.
.X.`,
  },

  boat: {
    name: 'Boat',
    cells: 8, width: 5, height: 2,
    art: `\
.XXX.
XXXXX`,
  },

  acorn: {
    name: 'Acorn',
    cells: 7, width: 3, height: 3,
    art: `\
XXX
XXX
.X.`,
  },

  berries: {
    name: 'Berries',
    cells: 7, width: 5, height: 2,
    art: `\
.X.X.
XXXXX`,
  },
};

// Convenience array form, useful for admin UI lists.
export const BATTLE_SHAPES_LIST = Object.entries(BATTLE_SHAPES).map(
  ([id, shape]) => ({ id, ...shape }),
);
