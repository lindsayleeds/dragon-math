// One-shot migration: inserts a new world (Honeyfield Plains) between
// Mushroom Forest and Crystal Caves. Existing Caves nodes 9-17 are
// renumbered to 17-25 across every table that references node_id.
//
// Uses a "shift to high range, then back down" trick to avoid colliding
// with the existing rows while the UPDATE runs.
//
// Run once:  node scripts/migrate-insert-honey-world.cjs

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'dragon-math.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF'); // we'll shift FK targets too; turn back on after

const TABLES = [
  { table: 'node_progress',    col: 'node_id' },
  { table: 'node_config',      col: 'node_id' },
  { table: 'problem_attempts', col: 'node_id' },
  { table: 'wrong_taps',       col: 'node_id' },
  { table: 'users',            col: 'current_node_id' },
];

const SHIFT = 8;           // 9..17 → 17..25
const STAGING_OFFSET = 100; // avoid colliding with new Honey nodes (9..16)

function tableExists(name) {
  return db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name) != null;
}

function summarize(label) {
  console.log(`\n— ${label} —`);
  for (const { table, col } of TABLES) {
    if (!tableExists(table)) {
      console.log(`  ${table.padEnd(18)}  (missing)`);
      continue;
    }
    const rows = db.prepare(
      `SELECT ${col} AS n, COUNT(*) AS c FROM ${table} GROUP BY ${col} ORDER BY ${col}`
    ).all();
    const summary = rows.map(r => `${r.n}:${r.c}`).join(' ');
    console.log(`  ${table.padEnd(18)}  ${summary || '(empty)'}`);
  }
}

summarize('BEFORE');

const migrate = db.transaction(() => {
  for (const { table, col } of TABLES) {
    if (!tableExists(table)) continue;

    // Stage: 9..17  →  109..117  (clears the destination band 17..25)
    db.prepare(
      `UPDATE ${table} SET ${col} = ${col} + ${STAGING_OFFSET}
       WHERE ${col} BETWEEN 9 AND 17`
    ).run();

    // Land: 109..117  →  17..25
    db.prepare(
      `UPDATE ${table} SET ${col} = ${col} - ${STAGING_OFFSET - SHIFT}
       WHERE ${col} BETWEEN ${100 + 9} AND ${100 + 17}`
    ).run();
  }
});

migrate();
db.pragma('foreign_keys = ON');

summarize('AFTER');

console.log('\n✓ Migration complete. Caves nodes are now 17..25.');
console.log('  Honey (9..16), Sakura (26..33), Sky (34..41) defaults will be');
console.log('  seeded automatically the next time the server boots.');
