#!/usr/bin/env node
// Read-only SQL runner for Dragon Math's Supabase Postgres DB.
//
// Usage:
//   node .claude/skills/supabase/scripts/query.cjs "SELECT count(*) FROM users"
//   node .claude/skills/supabase/scripts/query.cjs --pretty "SELECT account_type, count(*) FROM users GROUP BY account_type"
//
// Prints result rows as JSON to stdout. Intentionally refuses anything that
// isn't a single read (SELECT / WITH) so it's safe to point at production when
// answering questions. For writes or schema changes, use the Drizzle migration
// workflow in SKILL.md — never this script.
//
// Requires DATABASE_URL (Supabase Session pooler string). It loads the same
// .env the server uses via dotenv, so if the app runs, this does too.

const path = require('path');

// Load .env from the repo root regardless of the cwd this is invoked from.
// scripts/query.cjs -> supabase -> skills -> .claude -> <repo root>
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
try {
  require(path.join(repoRoot, 'node_modules', 'dotenv')).config({
    path: path.join(repoRoot, '.env'),
  });
} catch {
  // dotenv not resolvable from the repo — fall back to the ambient env.
  try { require('dotenv').config(); } catch { /* no dotenv available */ }
}

const args = process.argv.slice(2);
const pretty = args.includes('--pretty');
const sqlText = args.filter((a) => a !== '--pretty').join(' ').trim();

if (!sqlText) {
  console.error('Usage: node query.cjs [--pretty] "SELECT ..."');
  process.exit(2);
}

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Add it to .env (see .env.example), or use the\n' +
      'Supabase MCP connector instead. See the skill for both options.',
  );
  process.exit(1);
}

// Guard: single read-only statement only. Strip a trailing semicolon, then
// reject multiple statements and any non-SELECT/WITH leading keyword.
const stripped = sqlText.replace(/;\s*$/, '');
if (stripped.includes(';')) {
  console.error('Refusing multiple statements — run one SELECT at a time.');
  process.exit(1);
}
if (!/^\s*(select|with)\b/i.test(stripped)) {
  console.error(
    'Refusing a non-read query. This helper only runs SELECT/WITH. For writes\n' +
      'or migrations use the Drizzle workflow (drizzle-kit push), not this script.',
  );
  process.exit(1);
}

let Pool;
try {
  ({ Pool } = require(path.join(repoRoot, 'node_modules', 'pg')));
} catch {
  ({ Pool } = require('pg'));
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const res = await pool.query(stripped);
    process.stdout.write(JSON.stringify(res.rows, null, pretty ? 2 : 0) + '\n');
  } catch (err) {
    console.error('Query failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
