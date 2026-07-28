#!/usr/bin/env bash
#
# Remove the Supabase Data API's access to a target's database, so the only way
# in is the app's own `postgres` connection.
#
# WHY THIS EXISTS
#
# Both Supabase projects expose a PostgREST Data API. Authorisation for it is
# ordinary Postgres privilege: a request carrying the project's anon key acts as
# the `anon` role. The test project grants `anon` nothing, so its API can reach
# nothing. Production was created with the old permissive default and grants
# `anon`/`authenticated` full DML on every table in `public`, plus USAGE on the
# schema, plus — the part that matters most — DEFAULT privileges that hand the
# same rights to every table created in future. That is why `rate_limits` was
# born readable by `anon` the moment drizzle created it.
#
# Nothing in this app uses the Data API: `@supabase/supabase-js` is not a
# dependency, no anon key exists in any env, and the server connects as
# `postgres` (table owner, `bypassrls`). So revoking costs nothing here and the
# test project is the live proof — it has run this way all along.
#
# This script makes a target match test. It is idempotent: run it twice and the
# second run changes nothing.
#
# ROLLBACK
#
# Before changing anything it writes the GRANT statements that would restore the
# current state to $DM_ROOT/db-harden-rollback-<timestamp>.sql on the target, and
# prints the path. Feed that file back through psql/node to undo.
#
# Usage:
#   deploy/db-harden.sh -t prod [--dry-run]
#
#   --dry-run   run every guard, report the current state and the statements that
#               would be issued, then stop without touching privileges.
#
# The guard is the same allow-list as db-push.sh: DATABASE_URL must name the
# project ref in targets/<target>.env, resolved ON the target from its own
# shared/.env, or nothing runs.

. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

TARGET=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    -t|--target)  TARGET="${2:?}"; shift 2 ;;
    --dry-run)    DRY=1; shift ;;
    -h|--help)    sed -n '2,45p' "$0"; exit 0 ;;
    *)            die "unknown argument '$1'" ;;
  esac
done
[ -n "$TARGET" ] || die "usage: $0 -t <target> [--dry-run]"

load_target "$TARGET"
require_ssh

[ -n "${DM_EXPECTED_DB_REF:-}" ] \
  || die "target '$TARGET' does not set DM_EXPECTED_DB_REF — refusing to touch privileges"

say "hardening database privileges on target '$TARGET' (expected project: $DM_EXPECTED_DB_REF)"
[ "$DRY" = "1" ] && warn "--dry-run: no privileges will be changed"

# The payload runs on the target so the operator's shell can never supply the
# connection string, and reads shared/.env explicitly — the same file the app
# uses. NODE_PATH points at the live release's node_modules because a release is
# immutable: nothing is installed into it and no file is written inside it.
PAYLOAD="$DM_ROOT/.db-harden.cjs"
rsh "umask 077 && cat > $(qq "$PAYLOAD")" <<'PAYLOAD_EOF'
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const SHARED_ENV = process.env.DM_SHARED_ENV;
const EXPECTED_REF = process.env.DM_EXPECTED_DB_REF;
const APPLY = process.env.DM_APPLY === '1';
const ROLLBACK_PATH = process.env.DM_ROLLBACK_PATH;

// Last assignment wins, matching dotenv, which is what the app resolves.
const parsed = dotenv.parse(fs.readFileSync(SHARED_ENV));
const url = parsed.DATABASE_URL;
if (!url) { console.error('FAIL DATABASE_URL missing from ' + SHARED_ENV); process.exit(1); }

// Guard before anything else touches the database.
const m = /^postgres(?:ql)?:\/\/([^:]+):/.exec(url);
const user = m ? m[1] : '';
const refMatch = /^postgres\.([a-z0-9]+)$/.exec(user);
const ref = refMatch ? refMatch[1] : '';
if (!ref) { console.error('FAIL could not read a project ref from the DATABASE_URL user (' + user + ')'); process.exit(1); }
if (ref !== EXPECTED_REF) {
  console.error(`FAIL project ref mismatch: DATABASE_URL names '${ref}', target expects '${EXPECTED_REF}'`);
  process.exit(1);
}
console.log('     project ref ' + ref + ' matches the allow-list');

const { Pool } = require('pg');
const pool = new Pool({ connectionString: url, max: 1 });
const ROLES = ['anon', 'authenticated', 'service_role'];

(async () => {
  const q = async (s, a = []) => (await pool.query(s, a)).rows;

  const state = async () => {
    const tables = await q(
      `select count(distinct table_name)::int n from information_schema.role_table_grants
        where table_schema='public' and grantee = any($1)`, [ROLES]);
    const seqs = await q(
      `select count(*)::int n from information_schema.role_usage_grants
        where object_schema='public' and grantee = any($1)`, [ROLES]);
    const schemaAcl = await q(
      `select coalesce(array_to_string(nspacl, ' | '), '(none)') acl
         from pg_namespace where nspname='public'`);
    const defs = await q(
      `select count(*)::int n from (
         select unnest(defaclacl)::text acl from pg_default_acl da
           join pg_namespace n on n.oid = da.defaclnamespace where n.nspname='public'
       ) x where ${ROLES.map((_, i) => `acl like $${i + 1}`).join(' or ')}`,
      ROLES.map(r => r + '=%'));
    return { tables: tables[0].n, seqs: seqs[0].n, schemaAcl: schemaAcl[0].acl, defs: defs[0].n };
  };

  const before = await state();
  console.log('     BEFORE  tables=' + before.tables + '  sequence/usage=' + before.seqs +
              '  default-privilege entries=' + before.defs);
  console.log('     BEFORE  public ACL: ' + before.schemaAcl);

  // Roles that own DEFAULT privileges in this schema. Objects inherit the
  // defaults of whichever role creates them, so the grantor matters: drizzle
  // connects as postgres, so postgres's defaults are the ones that gave
  // rate_limits its grants. supabase_admin's are included when we are allowed to
  // change them, and skipped without failing when we are not.
  const grantors = (await q(
    `select distinct pg_get_userbyid(defaclrole) g from pg_default_acl da
       join pg_namespace n on n.oid = da.defaclnamespace where n.nspname='public'`
  )).map(r => r.g);

  const stmts = [];
  for (const r of ROLES) {
    stmts.push(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`);
    stmts.push(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${r}`);
    stmts.push(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${r}`);
    stmts.push(`REVOKE ALL ON SCHEMA public FROM ${r}`);
    for (const g of grantors) {
      stmts.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${g} IN SCHEMA public REVOKE ALL ON TABLES FROM ${r}`);
      stmts.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${g} IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${r}`);
      stmts.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${g} IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM ${r}`);
    }
  }
  // PUBLIC holds USAGE on the schema too (the `=U/...` entry); test has none.
  stmts.push('REVOKE ALL ON SCHEMA public FROM PUBLIC');

  if (!APPLY) {
    console.log('     would issue ' + stmts.length + ' statements, e.g.:');
    stmts.slice(0, 6).forEach(s => console.log('       ' + s));
    console.log('       … and ' + (stmts.length - 6) + ' more');
    await pool.end();
    return;
  }

  // Rollback file first, so the restore path exists before anything changes.
  const restore = [];
  for (const r of ROLES) {
    restore.push(`GRANT USAGE ON SCHEMA public TO ${r};`);
    restore.push(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${r};`);
    restore.push(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${r};`);
    restore.push(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${r};`);
    for (const g of grantors) {
      restore.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${g} IN SCHEMA public GRANT ALL ON TABLES TO ${r};`);
      restore.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${g} IN SCHEMA public GRANT ALL ON SEQUENCES TO ${r};`);
      restore.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${g} IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${r};`);
    }
  }
  restore.push('GRANT USAGE ON SCHEMA public TO PUBLIC;');
  fs.writeFileSync(ROLLBACK_PATH,
    '-- Restores the Data API privileges as they were before deploy/db-harden.sh ran.\n' +
    '-- Generated from the live state; apply only if revoking broke something.\n' +
    restore.join('\n') + '\n', { mode: 0o600 });
  console.log('     rollback written to ' + ROLLBACK_PATH);

  let failed = 0;
  for (const s of stmts) {
    try { await pool.query(s); }
    catch (e) {
      // A grantor we are not a member of (supabase_admin) is expected and not
      // fatal: its defaults only apply to objects IT creates, not ours.
      failed++;
      console.log('     skipped (' + e.code + '): ' + s);
    }
  }
  console.log('     applied ' + (stmts.length - failed) + '/' + stmts.length + ' statements');

  const after = await state();
  console.log('     AFTER   tables=' + after.tables + '  sequence/usage=' + after.seqs +
              '  default-privilege entries=' + after.defs);
  console.log('     AFTER   public ACL: ' + after.schemaAcl);
  await pool.end();
})().catch(e => { console.error('FAIL ' + e.message); process.exit(1); });
PAYLOAD_EOF

STAMP="$(rsh 'date +%Y%m%dT%H%M%S')"
ROLLBACK="$DM_ROOT/db-harden-rollback-$STAMP.sql"

say "checking which database this will affect"
rbash payload="$PAYLOAD" apply="$([ "$DRY" = "1" ] && echo 0 || echo 1)" \
      expected="$DM_EXPECTED_DB_REF" rollback="$ROLLBACK" <<'REMOTE' \
  || die "hardening failed — no privileges were changed unless the log above says otherwise"
cd "$DM_CURRENT"
NODE_PATH="$DM_CURRENT/node_modules" \
DM_SHARED_ENV="$DM_SHARED/.env" \
DM_EXPECTED_DB_REF="$expected" \
DM_APPLY="$apply" \
DM_ROLLBACK_PATH="$rollback" \
  node "$payload"
REMOTE

rsh "rm -f $(qq "$PAYLOAD")"

if [ "$DRY" = "1" ]; then
  warn "--dry-run: nothing was changed"
else
  ok "privileges hardened on '$TARGET' (rollback: $ROLLBACK)"
  say "re-run deploy/verify.sh -t $TARGET to confirm the app is unaffected"
fi
