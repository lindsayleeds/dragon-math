import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = require('pg');
const { changeAdmin } = require('../../scripts/admin-account.cjs');
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
let client;
suite('admin role management in Postgres', () => {
  beforeAll(async () => {
    client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    // Temp tables isolate these tests from other suites sharing the scratch DB.
    await client.query(`CREATE TEMP TABLE users (
      id int PRIMARY KEY, email text UNIQUE, account_type text, email_verified boolean,
      password_hash text, google_sub text, login_token text, family_login_token text);
      CREATE TEMP TABLE auth_tokens (user_id int, used_at timestamptz)`);
  });
  afterAll(async () => { if (client) await client.end(); });
  beforeEach(async () => {
    await client.query(`TRUNCATE users, auth_tokens;
      INSERT INTO users VALUES
        (1, 'first@example.test', 'parent', true, 'hash', NULL, 'old-link', 'family-link'),
        (2, 'second@example.test', 'parent', true, NULL, 'google-id', NULL, NULL);
      INSERT INTO auth_tokens VALUES (1, NULL)`);
  });
  it('grants multiple admins, clears old credentials, and revokes independently', async () => {
    await changeAdmin(client, 'first@example.test', 'grant');
    await changeAdmin(client, 'second@example.test', 'grant');
    expect((await client.query("SELECT count(*)::int AS n FROM users WHERE account_type = 'admin'")).rows[0].n).toBe(2);
    const { rows: [user] } = await client.query('SELECT * FROM users WHERE id = 1');
    expect(user.login_token).toBeNull();
    expect(user.family_login_token).toBeNull();
    expect((await client.query('SELECT used_at FROM auth_tokens')).rows[0].used_at).not.toBeNull();
    await changeAdmin(client, 'first@example.test', 'revoke');
    expect((await client.query('SELECT account_type FROM users WHERE id = 1')).rows[0].account_type).toBe('parent');
    await expect(changeAdmin(client, 'second@example.test', 'revoke')).rejects.toThrow('last admin');
    expect((await client.query('SELECT account_type FROM users WHERE id = 2')).rows[0].account_type).toBe('admin');
  });
  it('is idempotent and rejects nonexistent, child, unverified and link-only accounts', async () => {
    await changeAdmin(client, 'first@example.test', 'grant');
    await expect(changeAdmin(client, 'first@example.test', 'grant')).resolves.toMatchObject({ account_type: 'admin' });
    await expect(changeAdmin(client, 'missing@example.test', 'grant')).rejects.toThrow('existing account');
    await client.query("UPDATE users SET account_type = 'child' WHERE id = 2");
    await expect(changeAdmin(client, 'second@example.test', 'grant')).rejects.toThrow('adult');
    await client.query("UPDATE users SET account_type = 'parent', email_verified = false WHERE id = 2");
    await expect(changeAdmin(client, 'second@example.test', 'grant')).rejects.toThrow('Verify');
    await client.query('UPDATE users SET email_verified = true, google_sub = NULL WHERE id = 2');
    await expect(changeAdmin(client, 'second@example.test', 'grant')).rejects.toThrow('Verify');
  });
});
