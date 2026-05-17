// One-shot migration: retune all 17 node_config rows to the gentle +/− curve
// (addition 1-12 in world 1, subtraction then mixed +/− 1-12 in world 2).
//
// The seed in server/db.js uses INSERT OR IGNORE, so existing installs keep
// the old multiplication-heavy values. Run this once after pulling:
//
//   node scripts/retune-difficulty.cjs
//
// Safe to re-run — UPDATE is idempotent.

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'dragon-math.db');
const db = new Database(DB_PATH);

const NEW_CONFIG = [
  // [node_id, grid_size, ops_json, range_min, range_max, ai_seconds]
  [1,  3, '["add"]',        1,  3, 10.0],
  [2,  3, '["add"]',        1,  5,  9.0],
  [3,  3, '["add"]',        1,  6,  8.0],
  [4,  3, '["add"]',        1,  7,  7.5],
  [5,  3, '["add"]',        1,  8,  7.0],
  [6,  3, '["add"]',        1, 10,  6.5],
  [7,  3, '["add"]',        1, 12,  6.0],
  [8,  3, '["add"]',        1, 12,  4.5],
  [9,  3, '["sub"]',        1,  5,  9.0],
  [10, 3, '["sub"]',        1,  7,  8.0],
  [11, 3, '["sub"]',        1,  9,  7.0],
  [12, 3, '["sub"]',        1, 10,  6.5],
  [13, 3, '["sub"]',        1, 12,  6.0],
  [14, 4, '["add","sub"]',  1,  8,  6.0],
  [15, 4, '["add","sub"]',  1, 10,  5.5],
  [16, 4, '["add","sub"]',  1, 12,  5.0],
  [17, 4, '["add","sub"]',  1, 12,  4.0],
];

const upsert = db.prepare(`
  INSERT INTO node_config (node_id, grid_size, ops, range_min, range_max, ai_seconds)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(node_id) DO UPDATE SET
    grid_size  = excluded.grid_size,
    ops        = excluded.ops,
    range_min  = excluded.range_min,
    range_max  = excluded.range_max,
    ai_seconds = excluded.ai_seconds
`);

const run = db.transaction((rows) => {
  for (const row of rows) upsert.run(...row);
});
run(NEW_CONFIG);

const verify = db.prepare('SELECT node_id, grid_size, ops, range_min, range_max, ai_seconds FROM node_config ORDER BY node_id').all();
console.log(`Retuned ${verify.length} nodes:`);
for (const r of verify) {
  console.log(`  node ${String(r.node_id).padStart(2)}  grid=${r.grid_size}  ops=${r.ops.padEnd(15)}  range=[${r.range_min}-${r.range_max}]  ai=${r.ai_seconds}s`);
}
