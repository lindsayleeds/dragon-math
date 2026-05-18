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

// Migration: add difficulty columns to node_config tables that pre-date them.
const nodeConfigCols = db.prepare("PRAGMA table_info(node_config)").all();
const hasCol = (name) => nodeConfigCols.some(c => c.name === name);
if (!hasCol('ops'))        db.exec("ALTER TABLE node_config ADD COLUMN ops TEXT NOT NULL DEFAULT '[\"add\"]'");
if (!hasCol('range_min'))  db.exec("ALTER TABLE node_config ADD COLUMN range_min INTEGER NOT NULL DEFAULT 1");
if (!hasCol('range_max'))  db.exec("ALTER TABLE node_config ADD COLUMN range_max INTEGER NOT NULL DEFAULT 10");
if (!hasCol('ai_seconds')) db.exec("ALTER TABLE node_config ADD COLUMN ai_seconds REAL NOT NULL DEFAULT 6.0");

// Per-node defaults. Seeded with INSERT OR IGNORE so admin edits persist; the
// UPDATE below only fills *new* difficulty columns for rows that pre-existed
// the migration (detected by sentinel default values).
const NODE_DEFAULTS = [
  // [node_id, grid_size, ops_json, range_min, range_max, ai_seconds]
  // World 1: Mushroom Forest — addition foundation, 1-12
  [1,  3, '["add"]',                 1,  3, 10.0],
  [2,  3, '["add"]',                 1,  5,  9.0],
  [3,  3, '["add"]',                 1,  6,  8.0],
  [4,  3, '["add"]',                 1,  7,  7.5],
  [5,  3, '["add"]',                 1,  8,  7.0],
  [6,  3, '["add"]',                 1, 10,  6.5],
  [7,  3, '["add"]',                 1, 12,  6.0],
  [8,  3, '["add"]',                 1, 12,  4.5],
  // World 2: Honeyfield Plains — addition mastery with larger numbers
  [9,  3, '["add"]',                 1, 14,  7.0],
  [10, 3, '["add"]',                 1, 16,  6.5],
  [11, 4, '["add"]',                 1, 18,  6.0],
  [12, 4, '["add"]',                 1, 20,  5.5],
  [13, 4, '["add"]',                 5, 20,  5.0],
  [14, 4, '["add"]',                 5, 25,  5.0],
  [15, 4, '["add"]',                 8, 25,  4.5],
  [16, 4, '["add"]',                 8, 30,  4.0],
  // World 3: Crystal Caves — subtraction, then mixed +/− to 1-12 fluency
  [17, 3, '["sub"]',                 1,  5,  9.0],
  [18, 3, '["sub"]',                 1,  7,  8.0],
  [19, 3, '["sub"]',                 1,  9,  7.0],
  [20, 3, '["sub"]',                 1, 10,  6.5],
  [21, 3, '["sub"]',                 1, 12,  6.0],
  [22, 4, '["add","sub"]',           1,  8,  6.0],
  [23, 4, '["add","sub"]',           1, 10,  5.5],
  [24, 4, '["add","sub"]',           1, 12,  5.0],
  [25, 4, '["add","sub"]',           1, 12,  4.0],
  // World 4: Sakura Vale — multiplication intro, 2-12 tables
  [26, 3, '["mul"]',                 2,  3,  9.0],
  [27, 3, '["mul"]',                 2,  4,  8.0],
  [28, 4, '["mul"]',                 2,  5,  7.0],
  [29, 4, '["mul"]',                 2,  7,  6.5],
  [30, 4, '["mul"]',                 2,  9,  6.0],
  [31, 4, '["mul"]',                 2, 10,  5.5],
  [32, 4, '["mul"]',                 2, 12,  5.0],
  [33, 4, '["mul"]',                 2, 12,  4.0],
  // World 5: Cloudspire Heights — mixed all-ops mastery
  [34, 4, '["add","sub","mul"]',     1, 10,  6.0],
  [35, 4, '["add","sub","mul"]',     1, 12,  5.5],
  [36, 4, '["add","sub","mul"]',     2, 12,  5.0],
  [37, 4, '["mul"]',                 3, 12,  4.5],
  [38, 4, '["add","sub","mul"]',     2, 12,  4.5],
  [39, 4, '["add","sub","mul"]',     2, 12,  4.0],
  [40, 4, '["add","sub","mul"]',     3, 12,  3.5],
  [41, 4, '["add","sub","mul"]',     2, 15,  3.0],
];

const seedInsert = db.prepare(
  'INSERT OR IGNORE INTO node_config (node_id, grid_size, ops, range_min, range_max, ai_seconds) VALUES (?, ?, ?, ?, ?, ?)'
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
const seedAll = db.transaction((rows) => {
  for (const [id, size, ops, rmin, rmax, ai] of rows) {
    seedInsert.run(id, size, ops, rmin, rmax, ai);
    backfillIfDefault.run(ops, rmin, rmax, ai, id);
  }
});
seedAll(NODE_DEFAULTS);

module.exports = db;
