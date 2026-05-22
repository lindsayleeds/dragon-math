#!/usr/bin/env node
// Migrate Dragon Math's local SQLite database to Supabase Postgres.
//
// - Reads ./dragon-math.db via better-sqlite3 (read-only).
// - Writes to Supabase via the pg pool exported from server/db.js.
// - Wipes target tables (TRUNCATE ... RESTART IDENTITY CASCADE) before each
//   load — idempotent, safe to re-run during iteration.
// - Preserves original IDs so existing foreign-key references stay intact;
//   bumps serial sequences with setval() after each load.
// - Converts SQLite 0/1 ints to Postgres booleans and SQLite TEXT timestamps
//   to JS Date for `timestamptz` columns.
//
// Usage: node scripts/migrate-sqlite-to-postgres.js [--sqlite path]

const path = require('path');
const Database = require('better-sqlite3');
const { pool } = require('../server/db');

const sqlitePathArg = (() => {
  const i = process.argv.indexOf('--sqlite');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return path.join(__dirname, '..', 'dragon-math.db');
})();

// FK-safe insert order. users first; everything else FKs users (no inter-child
// FKs). TRUNCATE ... CASCADE handles cleanup in a single statement.
const ALL_TABLES = [
  'users',
  'node_progress',
  'node_config',
  'problem_attempts',
  'wrong_taps',
  'user_companions',
  'play_minutes',
  'matches',
  'parent_child_links',
  'parent_claim_codes',
  'weekly_report_log',
  'dragon_trial_results',
];

// SQLite stores datetime('now') as 'YYYY-MM-DD HH:MM:SS' in UTC (no tz marker).
// Some columns (dragon_trial_results.taken_at) hold ISO strings written from
// JS — those already have 'T' and a 'Z' suffix.
function parseTs(s) {
  if (s == null || s === '') return null;
  if (typeof s !== 'string') return s;
  if (s.includes('T')) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}

const bool = (v) => v === 1 || v === true || v === '1';

// Per-table row transformers: SQLite row in, Postgres-ready row out.
// Keys must match Postgres column names exactly.
const TRANSFORMS = {
  users: (r) => ({
    id: r.id,
    username: r.username,
    current_node_id: r.current_node_id,
    avatar: r.avatar,
    created_at: parseTs(r.created_at),
    account_type: r.account_type,
    email: r.email,
    password_hash: r.password_hash,
    google_sub: r.google_sub,
    email_verified: bool(r.email_verified),
    weekly_report_enabled: bool(r.weekly_report_enabled),
    adult_role: r.adult_role,
    active_companion_id: r.active_companion_id,
    dragon_trial_completed: bool(r.dragon_trial_completed),
  }),
  node_progress: (r) => ({
    id: r.id,
    user_id: r.user_id,
    node_id: r.node_id,
    completed: bool(r.completed),
    stars: r.stars,
    completed_at: parseTs(r.completed_at),
  }),
  node_config: (r) => ({
    node_id: r.node_id,
    grid_size: r.grid_size,
    ops: r.ops,
    range_min: r.range_min,
    range_max: r.range_max,
    ai_seconds: r.ai_seconds,
    shape_id: r.shape_id,
  }),
  problem_attempts: (r) => ({
    id: r.id,
    user_id: r.user_id,
    node_id: r.node_id,
    operand_a: r.operand_a,
    operand_b: r.operand_b,
    operator: r.operator,
    answer: r.answer,
    outcome: r.outcome,
    time_ms: r.time_ms,
    created_at: parseTs(r.created_at),
  }),
  wrong_taps: (r) => ({
    id: r.id,
    user_id: r.user_id,
    node_id: r.node_id,
    operand_a: r.operand_a,
    operand_b: r.operand_b,
    operator: r.operator,
    correct_answer: r.correct_answer,
    tapped_value: r.tapped_value,
    time_ms: r.time_ms,
    created_at: parseTs(r.created_at),
  }),
  user_companions: (r) => ({
    id: r.id,
    user_id: r.user_id,
    companion_id: r.companion_id,
    acquired_at: parseTs(r.acquired_at),
  }),
  // `minute` is local-time 'YYYY-MM-DD HH:MM' by design — stays text, no parse.
  play_minutes: (r) => ({
    user_id: r.user_id,
    minute: r.minute,
  }),
  matches: (r) => ({
    id: r.id,
    user_id: r.user_id,
    node_id: r.node_id,
    started_at: parseTs(r.started_at),
    ended_at: parseTs(r.ended_at),
    outcome: r.outcome,
    player_score: r.player_score,
    ai_score: r.ai_score,
  }),
  parent_child_links: (r) => ({
    parent_id: r.parent_id,
    child_id: r.child_id,
    created_at: parseTs(r.created_at),
  }),
  parent_claim_codes: (r) => ({
    child_id: r.child_id,
    code: r.code,
    expires_at: parseTs(r.expires_at),
  }),
  // period_start / period_end are date strings ('YYYY-MM-DD') — stay text.
  weekly_report_log: (r) => ({
    id: r.id,
    parent_id: r.parent_id,
    period_start: r.period_start,
    period_end: r.period_end,
    sent_at: parseTs(r.sent_at),
    status: r.status,
    error: r.error,
  }),
  dragon_trial_results: (r) => ({
    user_id: r.user_id,
    taken_at: parseTs(r.taken_at),
    target_node_id: r.target_node_id,
    highest_op: r.highest_op,
    add_score: r.add_score,
    add_band:  r.add_band,
    add_asked: r.add_asked,
    sub_score: r.sub_score,
    sub_band:  r.sub_band,
    sub_asked: r.sub_asked,
    mul_score: r.mul_score,
    mul_band:  r.mul_band,
    mul_asked: r.mul_asked,
    div_score: r.div_score,
    div_band:  r.div_band,
    div_asked: r.div_asked,
  }),
};

// Tables whose `id` column is a Postgres serial — their sequence needs setval
// after we insert with explicit IDs, otherwise the next nextval() will collide.
const SERIAL_ID_TABLES = [
  'users',
  'node_progress',
  'problem_attempts',
  'wrong_taps',
  'user_companions',
  'matches',
  'weekly_report_log',
];

async function insertRows(client, table, rows) {
  if (rows.length === 0) return 0;
  const cols = Object.keys(rows[0]);
  const placeholders = [];
  const values = [];
  let p = 1;
  for (const row of rows) {
    placeholders.push('(' + cols.map(() => '$' + (p++)).join(', ') + ')');
    for (const c of cols) values.push(row[c]);
  }
  const sql = `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES ${placeholders.join(', ')}`;
  const res = await client.query(sql, values);
  return res.rowCount;
}

async function main() {
  console.log(`Source: ${sqlitePathArg}`);
  const sqlite = new Database(sqlitePathArg, { readonly: true, fileMustExist: true });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('Truncating target tables (RESTART IDENTITY CASCADE)…');
    await client.query(
      `TRUNCATE ${ALL_TABLES.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`
    );

    const counts = {};
    for (const table of ALL_TABLES) {
      const src = sqlite.prepare(`SELECT * FROM "${table}"`).all();
      const rows = src.map(TRANSFORMS[table]);

      // Insert in batches of 200 to stay well under Postgres's 65535 bound-
      // parameter limit even on wide tables.
      const BATCH = 200;
      let total = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        total += await insertRows(client, table, rows.slice(i, i + BATCH));
      }
      counts[table] = total;
      console.log(`  ${table.padEnd(22)} ${total} rows`);
    }

    console.log('Bumping serial sequences…');
    for (const table of SERIAL_ID_TABLES) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'),
                       COALESCE((SELECT MAX(id) FROM "${table}"), 1),
                       (SELECT MAX(id) IS NOT NULL FROM "${table}"))`
      );
    }

    await client.query('COMMIT');
    console.log('\n✅ Migration committed.');
    console.log('Row counts:');
    for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(22)} ${n}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed; rolled back.');
    throw err;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
