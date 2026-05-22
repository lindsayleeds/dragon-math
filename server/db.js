const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'dragon-math.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    current_node_id INTEGER NOT NULL DEFAULT 1,
    avatar TEXT NOT NULL DEFAULT '⚔️',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS node_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    node_id INTEGER NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    stars INTEGER,
    completed_at TEXT,
    UNIQUE(user_id, node_id)
  );

  CREATE TABLE IF NOT EXISTS node_config (
    node_id INTEGER PRIMARY KEY,
    grid_size INTEGER NOT NULL CHECK (grid_size BETWEEN 2 AND 10),
    ops TEXT NOT NULL DEFAULT '["add"]',
    range_min INTEGER NOT NULL DEFAULT 1,
    range_max INTEGER NOT NULL DEFAULT 10,
    ai_seconds REAL NOT NULL DEFAULT 6.0
  );

  CREATE TABLE IF NOT EXISTS problem_attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    node_id    INTEGER NOT NULL,
    operand_a  INTEGER NOT NULL,
    operand_b  INTEGER NOT NULL,
    operator   TEXT    NOT NULL,
    answer     INTEGER NOT NULL,
    outcome    TEXT    NOT NULL CHECK (outcome IN ('child', 'ai')),
    time_ms    INTEGER,
    created_at TEXT    DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_attempts_user_time
    ON problem_attempts(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_attempts_user_op
    ON problem_attempts(user_id, operator);

  CREATE TABLE IF NOT EXISTS wrong_taps (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    node_id        INTEGER NOT NULL,
    operand_a      INTEGER NOT NULL,
    operand_b      INTEGER NOT NULL,
    operator       TEXT    NOT NULL,
    correct_answer INTEGER NOT NULL,
    tapped_value   INTEGER NOT NULL,
    time_ms        INTEGER,
    created_at     TEXT    DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_wrong_taps_user_time
    ON wrong_taps(user_id, created_at);

  CREATE TABLE IF NOT EXISTS user_companions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    companion_id TEXT    NOT NULL,
    acquired_at  TEXT    DEFAULT (datetime('now')),
    UNIQUE(user_id, companion_id)
  );

  -- One row per (user, local-minute) the user was actively in a battle.
  -- Minute is stored as local-time 'YYYY-MM-DD HH:MM' so substr(minute,1,10)
  -- gives the local calendar day. PK enforces idempotent inserts within a
  -- minute regardless of heartbeat frequency.
  CREATE TABLE IF NOT EXISTS play_minutes (
    user_id INTEGER NOT NULL REFERENCES users(id),
    minute  TEXT    NOT NULL,
    PRIMARY KEY (user_id, minute)
  );
  CREATE INDEX IF NOT EXISTS idx_play_minutes_user_day
    ON play_minutes(user_id, minute);

  -- One row per battle. Outcome is 'child' (player reached the target first),
  -- 'ai' (AI reached the target first), or 'incomplete' (player left mid-battle).
  -- Rows are created when a battle starts and finalized on win/loss/unmount.
  CREATE TABLE IF NOT EXISTS matches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    node_id       INTEGER NOT NULL,
    started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    ended_at      TEXT,
    outcome       TEXT    CHECK (outcome IN ('child', 'ai', 'incomplete')),
    player_score  INTEGER NOT NULL DEFAULT 0,
    ai_score      INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_matches_user_started
    ON matches(user_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_matches_user_node
    ON matches(user_id, node_id);

  CREATE TABLE IF NOT EXISTS parent_child_links (
    parent_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    child_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    DEFAULT (datetime('now')),
    PRIMARY KEY (parent_id, child_id)
  );
  CREATE INDEX IF NOT EXISTS idx_pcl_child ON parent_child_links(child_id);

  CREATE TABLE IF NOT EXISTS parent_claim_codes (
    child_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code       TEXT    NOT NULL,
    expires_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS weekly_report_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start TEXT    NOT NULL,
    period_end   TEXT    NOT NULL,
    sent_at      TEXT,
    status       TEXT    NOT NULL DEFAULT 'pending',
    error        TEXT,
    UNIQUE(parent_id, period_start)
  );

  -- Dragon's Trial placement-test summary. One row per child; replaced on
  -- retake (parent reset + redo). Per-op score is 0-1000; band is one of
  -- 'fluent' | 'capable' | 'developing' | 'emerging' | 'not_ready' (rendered
  -- as 5★ → 1★). '*_asked' tracks how many problems were posed for that op
  -- (adaptive flow varies it). highest_op = highest fluent op among
  -- add/sub/mul; placement target = start of first non-fluent op.
  CREATE TABLE IF NOT EXISTS dragon_trial_results (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    taken_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    target_node_id INTEGER NOT NULL,
    highest_op     TEXT,
    add_score      INTEGER NOT NULL DEFAULT 0,
    add_band       TEXT    NOT NULL DEFAULT 'not_ready',
    add_asked      INTEGER NOT NULL DEFAULT 0,
    sub_score      INTEGER NOT NULL DEFAULT 0,
    sub_band       TEXT    NOT NULL DEFAULT 'not_ready',
    sub_asked      INTEGER NOT NULL DEFAULT 0,
    mul_score      INTEGER NOT NULL DEFAULT 0,
    mul_band       TEXT    NOT NULL DEFAULT 'not_ready',
    mul_asked      INTEGER NOT NULL DEFAULT 0,
    div_score      INTEGER NOT NULL DEFAULT 0,
    div_band       TEXT    NOT NULL DEFAULT 'not_ready',
    div_asked      INTEGER NOT NULL DEFAULT 0
  );
`);

// Migration: parent-account columns on users.
const userColsForParent = db.prepare("PRAGMA table_info(users)").all();
const hasUserCol = (name) => userColsForParent.some(c => c.name === name);
if (!hasUserCol('account_type')) {
  db.exec("ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'child'");
}
if (!hasUserCol('email'))          db.exec("ALTER TABLE users ADD COLUMN email TEXT");
if (!hasUserCol('password_hash'))  db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
if (!hasUserCol('google_sub'))     db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
if (!hasUserCol('email_verified')) db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
if (!hasUserCol('weekly_report_enabled')) db.exec("ALTER TABLE users ADD COLUMN weekly_report_enabled INTEGER NOT NULL DEFAULT 1");
// Sub-type for adult accounts: 'parent' (parent/guardian) or 'teacher'. Only
// meaningful when account_type = 'parent'; ignored for child accounts.
if (!hasUserCol('adult_role')) db.exec("ALTER TABLE users ADD COLUMN adult_role TEXT NOT NULL DEFAULT 'parent'");

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email      ON users(email)      WHERE email IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
`);

// Migration: add `avatar` column to existing users tables that pre-date it.
const userCols = db.prepare("PRAGMA table_info(users)").all();
if (!userCols.some(c => c.name === 'avatar')) {
  db.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '⚔️'");
}
// Migration: add `active_companion_id` to users tables that pre-date companions.
if (!userCols.some(c => c.name === 'active_companion_id')) {
  db.exec("ALTER TABLE users ADD COLUMN active_companion_id TEXT");
}
// Migration: Dragon's Trial one-time placement test flag (0 = not yet taken).
if (!userCols.some(c => c.name === 'dragon_trial_completed')) {
  db.exec("ALTER TABLE users ADD COLUMN dragon_trial_completed INTEGER NOT NULL DEFAULT 0");
}

// Migration: add difficulty columns to node_config tables that pre-date them.
const nodeConfigCols = db.prepare("PRAGMA table_info(node_config)").all();
const hasCol = (name) => nodeConfigCols.some(c => c.name === name);
if (!hasCol('ops'))        db.exec("ALTER TABLE node_config ADD COLUMN ops TEXT NOT NULL DEFAULT '[\"add\"]'");
if (!hasCol('range_min'))  db.exec("ALTER TABLE node_config ADD COLUMN range_min INTEGER NOT NULL DEFAULT 1");
if (!hasCol('range_max'))  db.exec("ALTER TABLE node_config ADD COLUMN range_max INTEGER NOT NULL DEFAULT 10");
if (!hasCol('ai_seconds')) db.exec("ALTER TABLE node_config ADD COLUMN ai_seconds REAL NOT NULL DEFAULT 6.0");
// shape_id picks one of BATTLE_SHAPES (src/data/battleShapes.js) to determine
// the cell layout for this node's battle grid. Nullable so legacy rows fall
// back to the per-world default layout client-side.
if (!hasCol('shape_id'))   db.exec("ALTER TABLE node_config ADD COLUMN shape_id TEXT");

// Per-node defaults. Seeded with INSERT OR IGNORE so admin edits persist; the
// UPDATE below only fills *new* difficulty columns for rows that pre-existed
// the migration (detected by sentinel default values).
// Per-node defaults. shape_id references BATTLE_SHAPES in
// src/data/battleShapes.js; cell counts grow progressively by world (World 1:
// 5–9 cells, World 2: 9–13, World 3: 13–15, World 4: 15–17, World 5: 17–23).
// grid_size is legacy — kept to satisfy the NOT NULL column but no longer
// drives layout.
const NODE_DEFAULTS = [
  // [node_id, grid_size, ops_json, range_min, range_max, ai_seconds, shape_id]
  // World 1: Mushroom Forest — addition foundation, 1-12 (5–9 cells)
  [1,  3, '["add"]',                 1,  3, 10.0, 'letter-l'],
  [2,  3, '["add"]',                 1,  5,  9.0, 'letter-t'],
  [3,  3, '["add"]',                 1,  6,  8.0, 'bowtie'],
  [4,  3, '["add"]',                 1,  7,  7.5, 'kite-small'],
  [5,  3, '["add"]',                 1,  8,  7.0, 'acorn'],
  [6,  3, '["add"]',                 1, 10,  6.5, 'berries'],
  [7,  3, '["add"]',                 1, 12,  6.0, 'boat'],
  [8,  3, '["add"]',                 1, 12,  4.5, 'plus'],
  // World 2: Honeyfield Plains — addition mastery (9–13 cells)
  [9,  3, '["add"]',                 1, 14,  7.0, 'triangle-up'],
  [10, 3, '["add"]',                 1, 16,  6.5, 'triangle-down'],
  [11, 4, '["add"]',                 1, 18,  6.0, 'cross-x'],
  [12, 4, '["add"]',                 1, 20,  5.5, 'arrow-up'],
  [13, 4, '["add"]',                 5, 20,  5.0, 'ring'],
  [14, 4, '["add"]',                 5, 25,  5.0, 'moon-crescent'],
  [15, 4, '["add"]',                 8, 25,  4.5, 'staircase'],
  [16, 4, '["add"]',                 8, 30,  4.0, 'anchor-t'],
  // World 3: Crystal Caves — subtraction, then mixed +/− (13–15 cells)
  [17, 3, '["sub"]',                 1,  5,  9.0, 'letter-h'],
  [18, 3, '["sub"]',                 1,  7,  8.0, 'plus-big'],
  [19, 3, '["sub"]',                 1,  9,  7.0, 'diamond'],
  [20, 3, '["sub"]',                 1, 10,  6.5, 'wave'],
  [21, 3, '["sub"]',                 1, 12,  6.0, 'tree'],
  [22, 4, '["add","sub"]',           1,  8,  6.0, 'crystal'],
  [23, 4, '["add","sub"]',           1, 10,  5.5, 'gem'],
  [24, 4, '["add","sub"]',           1, 12,  5.0, 'mushroom'],
  [25, 4, '["add","sub"]',           1, 12,  4.0, 'leaf'],
  // World 4: Sakura Vale — multiplication intro, 2-12 tables (15–17 cells)
  [26, 3, '["mul"]',                 2,  3,  9.0, 'star'],
  [27, 3, '["mul"]',                 2,  4,  8.0, 'zigzag-z'],
  [28, 4, '["mul"]',                 2,  5,  7.0, 'hexagon'],
  [29, 4, '["mul"]',                 2,  7,  6.5, 'heart'],
  [30, 4, '["mul"]',                 2,  9,  6.0, 'mountain'],
  [31, 4, '["mul"]',                 2, 10,  5.5, 'flower'],
  [32, 4, '["mul"]',                 2, 12,  5.0, 'sun'],
  [33, 4, '["mul"]',                 2, 12,  4.0, 'fish'],
  // World 5: Cloudspire Heights — mixed all-ops mastery (17–23 cells)
  [34, 4, '["add","sub","mul"]',     1, 10,  6.0, 'honeycomb'],
  [35, 4, '["add","sub","mul"]',     1, 12,  5.5, 'bee-stripes'],
  [36, 4, '["add","sub","mul"]',     2, 12,  5.0, 'butterfly'],
  [37, 4, '["mul"]',                 3, 12,  4.5, 'crown'],
  [38, 4, '["add","sub","mul"]',     2, 12,  4.5, 'cloud'],
  [39, 4, '["add","sub","mul"]',     2, 12,  4.0, 'butterfly'],
  [40, 4, '["add","sub","mul"]',     3, 12,  3.5, 'crown'],
  [41, 4, '["add","sub","mul"]',     2, 15,  3.0, 'cloud'],
];

const seedInsert = db.prepare(
  'INSERT OR IGNORE INTO node_config (node_id, grid_size, ops, range_min, range_max, ai_seconds, shape_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
// Backfill difficulty columns on rows that pre-existed the migration. We can't
// tell "user-set default" from "migration default", so we only overwrite when
// ALL difficulty fields still match the column defaults — meaning the row was
// inserted before these columns existed.
const backfillIfDefault = db.prepare(`
  UPDATE node_config
  SET ops = ?, range_min = ?, range_max = ?, ai_seconds = ?
  WHERE node_id = ?
    AND ops = '["add"]' AND range_min = 1 AND range_max = 10 AND ai_seconds = 6.0
`);
// Backfill shape_id on any row missing it (covers both fresh seeds and rows
// that pre-existed the shape_id column).
const backfillShape = db.prepare(
  'UPDATE node_config SET shape_id = ? WHERE node_id = ? AND shape_id IS NULL'
);
const seedAll = db.transaction((rows) => {
  for (const [id, size, ops, rmin, rmax, ai, shape] of rows) {
    seedInsert.run(id, size, ops, rmin, rmax, ai, shape);
    backfillIfDefault.run(ops, rmin, rmax, ai, id);
    backfillShape.run(shape, id);
  }
});
seedAll(NODE_DEFAULTS);

module.exports = db;
