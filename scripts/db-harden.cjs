// Revoke the Supabase Data API's access to a database. Run through
// deploy/db-harden.sh, which supplies the environment below and applies the
// production guard. See that script's header for why this exists.
//
//   DM_ENV_FILE         file assigning DATABASE_URL (mode 600)
//   DM_EXPECTED_DB_REF  Supabase project ref the URL must name
//   DM_APPLY            "1" to issue statements; anything else is a dry run
//   DM_ROLLBACK_PATH    where to write the restoring GRANTs before changing
const fs = require('fs');
const dotenv = require('dotenv');

const ENV_FILE = process.env.DM_ENV_FILE;
const EXPECTED_REF = process.env.DM_EXPECTED_DB_REF;
const APPLY = process.env.DM_APPLY === '1';
const ROLLBACK_PATH = process.env.DM_ROLLBACK_PATH;

// Last assignment wins, matching dotenv, which is what the app resolves.
const parsed = dotenv.parse(fs.readFileSync(ENV_FILE));
const url = parsed.DATABASE_URL;
if (!url) { console.error('FAIL DATABASE_URL missing from ' + ENV_FILE); process.exit(1); }

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
