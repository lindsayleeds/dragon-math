// Run through deploy/admin-account.sh so target and production guards apply.
const fs = require('node:fs');
const { Client } = require('pg');
const dotenv = require('dotenv');

async function changeAdmin(client, email, action) {
  if (!['grant', 'revoke'].includes(action)) throw new Error('Action must be grant or revoke');
  await client.query('BEGIN');
  try {
    // Serialize role changes, including concurrent attempts to revoke the last admin.
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query('SELECT id, account_type, email_verified, password_hash, google_sub FROM users WHERE email = $1', [email]);
    if (rows.length !== 1) throw new Error('Expected exactly one existing account for this email');
    const user = rows[0];
    if (!['parent', 'admin'].includes(user.account_type)) throw new Error('Only adult accounts can become admins');
    if (action === 'grant' && (!user.email_verified || (!user.password_hash && !user.google_sub))) {
      throw new Error('Verify the email and configure password or Google sign-in before granting admin');
    }
    if (action === 'revoke' && user.account_type === 'admin') {
      const count = await client.query("SELECT count(*)::int AS count FROM users WHERE account_type = 'admin'");
      if (count.rows[0].count <= 1) throw new Error('Cannot revoke the last admin; grant another first');
    }
    const type = action === 'grant' ? 'admin' : 'parent';
    if (user.account_type !== type) {
      await client.query('UPDATE users SET account_type = $1, login_token = NULL, family_login_token = NULL WHERE id = $2', [type, user.id]);
      await client.query('UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    }
    await client.query('COMMIT');
    return { id: user.id, email, account_type: type };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  const { DM_ADMIN_EMAIL, DM_ADMIN_ACTION, DM_EXPECTED_DB_REF, DM_ENV_FILE } = process.env;
  if (!DM_ADMIN_EMAIL || !DM_EXPECTED_DB_REF || !DM_ENV_FILE) throw new Error('Use deploy/admin-account.sh');
  const raw = fs.readFileSync(DM_ENV_FILE, 'utf8');
  if (raw.split(/\r?\n/).filter(line => /^\s*(export\s+)?DATABASE_URL\s*=/.test(line)).length !== 1) {
    throw new Error('Expected exactly one DATABASE_URL assignment');
  }
  const url = dotenv.parse(raw).DATABASE_URL;
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url) throw new Error('Conflicting ambient DATABASE_URL');
  if (decodeURIComponent(new URL(url).username) !== `postgres.${DM_EXPECTED_DB_REF}`) throw new Error('Database project does not match target');
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query("SET statement_timeout = '10s'");
    console.log(JSON.stringify(await changeAdmin(client, DM_ADMIN_EMAIL.trim().toLowerCase(), DM_ADMIN_ACTION)));
  } finally { await client.end(); }
}

module.exports = { changeAdmin, main };
if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });
