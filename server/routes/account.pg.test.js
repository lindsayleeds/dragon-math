// POST /api/account/delete against a real Postgres, over HTTP. What gets
// deleted is decided by foreign keys as much as by code — most child data goes
// by ON DELETE CASCADE, some by explicit deletes, some is kept anonymized by ON
// DELETE SET NULL — so only the real schema can answer it. The tables here are
// generated from server/db/schema.js itself (drizzle-kit's migration generator),
// not restated, and one row is seeded for every foreign key that points at
// users. So a table added later is covered without touching this file: if its
// rows would outlive a deleted parent or child, the sweep below fails.
//
// Opt-in, because there is no database in the default test environment:
//
//   TEST_DATABASE_URL=postgres://user@host:5432/dragon_math_test npm test
//
// Isolated like sync.pg.test.js: a schema of its own, selected for the pool by a
// search_path startup option, dropped at the end. Apple is faked at both ends —
// identity tokens are signed by a local key (setAppleKeySet) and the revoke
// endpoint is a stubbed fetch (setAppleRevokeFetch).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';

const require = createRequire(import.meta.url);

const TEST_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_URL ? describe : describe.skip;

const BUNDLE_ID = 'com.example.dragonacademy';

let admin;
let schemaName;
let server;
let baseUrl;
let pool;
let signToken;
let expectContract;
let appleKey;
let revokeCalls;
let foreignKeys; // [{ table, column, ref_table, ref_column, delete_rule }]

const q = async (text, params) => (await admin.query(text, params)).rows;
const count = async (table, where = 'true', params = []) =>
  (await q(`SELECT count(*)::int AS n FROM "${table}" WHERE ${where}`, params))[0].n;

// The users FK columns, i.e. everything that could still point at a deleted id.
const userRefs = () => foreignKeys.filter(fk => fk.ref_table === 'users');

async function schemaDDL() {
  process.env.DATABASE_URL ||= 'postgres://unused@127.0.0.1:1/unused';
  const { generateDrizzleJson, generateMigration } = require('drizzle-kit/api');
  const schema = require('../db/schema.js');
  const statements = await generateMigration(await generateDrizzleJson({}), await generateDrizzleJson(schema));
  // citext is an extension the scratch database may not have; nothing here
  // depends on usernames comparing case-insensitively. References are written
  // schema-qualified as "public"; they belong in this suite's schema.
  return statements.map(s => s.replace(/"citext"/g, 'text').replace(/"public"\./g, ''));
}

// Inserts one row into `table` with `values`, filling every other NOT NULL
// column that has no default: a referenced row is seeded first (its own user
// references go to `fallbackUser`), anything else gets a placeholder of its type.
// A few columns carry a CHECK and get a valid value instead.
const CHECKED = {
  problem_attempts: { outcome: 'child' },
  auth_tokens: { kind: 'email_verify' },
  proving_grounds_runs: { mode: 'mul', digit: 2, medal: 'gold' },
  phonics_attempts: { mode: 'choose' },
};
let placeholder = 100;
let requiredColumns; // table → [{ column_name, data_type }]
async function seed(table, values, fallbackUser) {
  const row = { ...CHECKED[table], ...values };
  for (const { column_name: col, data_type: type } of requiredColumns[table] || []) {
    if (col in row) continue;
    const fk = foreignKeys.find(f => f.table === table && f.column === col);
    if (fk?.ref_table === 'users') row[col] = fallbackUser;
    else if (fk) row[col] = (await seed(fk.ref_table, {}, fallbackUser))[fk.ref_column];
    else if (type === 'integer' || type === 'bigint' || type === 'smallint') row[col] = placeholder++;
    else if (type === 'boolean') row[col] = false;
    else if (type.startsWith('timestamp') || type === 'date') row[col] = new Date();
    else if (type === 'jsonb' || type === 'json') row[col] = {};
    else if (type === 'uuid') row[col] = randomUUID();
    else if (type === 'ARRAY') row[col] = ['x'];
    else row[col] = `x-${placeholder++}`;
  }
  const cols = Object.keys(row);
  const [inserted] = await q(
    `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    cols.map(c => row[c]),
  );
  return inserted;
}

// One row per users FK column naming `userId`. parent_child_links is left to
// the family setup, since a stray link would change who is whose child.
async function seedEverythingFor(userId, fallbackUser) {
  for (const fk of userRefs()) {
    if (fk.table === 'parent_child_links') continue;
    await seed(fk.table, { [fk.column]: userId }, fallbackUser);
  }
}

async function appleToken(sub, { nonce } = {}) {
  return new SignJWT({ email: `${sub}@privaterelay.appleid.com`, email_verified: 'true', ...(nonce ? { nonce } : {}) })
    .setProtectedHeader({ alg: 'RS256', kid: 'apple-test-key' })
    .setIssuer('https://appleid.apple.com')
    .setAudience(BUNDLE_ID)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(appleKey.privateKey);
}

function token(id, accountType = 'parent') {
  return signToken({ id, username: `user${id}`, account_type: accountType });
}

async function deleteAccount(as, body) {
  const res = await fetch(`${baseUrl}/api/account/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await expectContract(res, 'post', '/api/account/delete') };
}

// The family: parent P deletes. Kid A is P's alone; kid B is shared with
// co-parent Q; kid C is Q's alone. R is an unrelated adult who owns the
// classrooms/tribes/schools the seeded memberships need.
let P, Q, R, A, B, C;

// Every test seeds a row per users FK (a few hundred inserts), so give them room.
suite('POST /api/account/delete against a real Postgres', { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const { Client } = require('pg');
    schemaName = `account_delete_${process.pid}_${Date.now()}`;
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}", public`);
    // Setup writes a few hundred rows per test; nothing needs them durable.
    await admin.query('SET synchronous_commit TO off');
    for (const stmt of await schemaDDL()) await admin.query(stmt);

    foreignKeys = await q(
      `SELECT kcu.table_name AS table, kcu.column_name AS column, ccu.table_name AS ref_table,
              ccu.column_name AS ref_column, rc.delete_rule
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = rc.constraint_name AND kcu.constraint_schema = rc.constraint_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = rc.constraint_name AND ccu.constraint_schema = rc.constraint_schema
        WHERE rc.constraint_schema = $1
        ORDER BY 1, 2`,
      [schemaName],
    );
    expect(userRefs().length).toBeGreaterThan(20);
    requiredColumns = {};
    for (const c of await q(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = $1 AND is_nullable = 'NO' AND column_default IS NULL`,
      [schemaName],
    )) (requiredColumns[c.table_name] ||= []).push(c);

    const url = new URL(TEST_URL);
    url.searchParams.set('options', `-c search_path=${schemaName},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'account-pg-test-secret';
    process.env.APPLE_CLIENT_IDS = BUNDLE_ID;

    appleKey = await generateKeyPair('RS256', { extractable: true });
    const jwk = { ...(await exportJWK(appleKey.publicKey)), kid: 'apple-test-key', alg: 'RS256', use: 'sig' };
    require('../lib/appleIdentity.js').setAppleKeySet(createLocalJWKSet({ keys: [jwk] }));

    ({ pool } = require('../db.js'));
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth.js');
    signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });
    ({ expectContract } = require('../contracts/testing.js'));

    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/account', require('./account.js'));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }, 120_000);

  afterAll(async () => {
    require('../lib/appleIdentity.js').setAppleKeySet(null);
    require('../lib/appleRevoke.js').setAppleRevokeFetch(null);
    for (const key of ['APPLE_CLIENT_IDS', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY']) delete process.env[key];
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    const tables = (await q(
      "SELECT tablename FROM pg_tables WHERE schemaname = $1", [schemaName],
    )).map(t => `"${t.tablename}"`);
    await admin.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
    placeholder = 100;

    const users = await q(`INSERT INTO users (username, account_type, apple_sub, login_token, family_login_token) VALUES
      ('p@example.com', 'parent', 'apple-p', NULL, 'family-p'),
      ('q@example.com', 'parent', 'apple-q', NULL, 'family-q'),
      ('r@example.com', 'parent', NULL, NULL, NULL),
      ('kid-a', 'child', NULL, 'login-a', NULL),
      ('kid-b', 'child', NULL, 'login-b', NULL),
      ('kid-c', 'child', NULL, 'login-c', NULL)
      RETURNING id`);
    [P, Q, R, A, B, C] = users.map(u => u.id);
    await q('INSERT INTO parent_child_links (parent_id, child_id) VALUES ($1, $3), ($1, $4), ($2, $4), ($2, $5)',
      [P, Q, A, B, C]);
    await admin.query('BEGIN');
    for (const id of [P, Q, A, B, C]) await seedEverythingFor(id, R);
    await admin.query('COMMIT');
  }, 60_000);

  beforeEach(() => {
    // Apple revocation configured, answering both calls.
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env.APPLE_TEAM_ID = 'TEAM123456';
    process.env.APPLE_KEY_ID = 'KEY7654321';
    process.env.APPLE_PRIVATE_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    revokeCalls = [];
    require('../lib/appleRevoke.js').setAppleRevokeFetch(async (url, init) => {
      revokeCalls.push({ url, form: Object.fromEntries(new URLSearchParams(init.body)) });
      const body = url.endsWith('/auth/token') ? { access_token: 'at', refresh_token: 'rt-p' } : {};
      return { ok: true, status: 200, json: async () => body };
    });
  });

  it('deletes the parent and their sole-guardian child, and leaves no row pointing at either', async () => {
    const survivors = [Q, R, B, C];
    const before = {};
    for (const fk of userRefs()) {
      before[`${fk.table}.${fk.column}`] = {
        survivors: await count(fk.table, `"${fk.column}" = ANY($1)`, [survivors]),
        // SET NULL rows naming P or A (seeded with survivors everywhere else).
        anonymize: fk.delete_rule === 'SET NULL'
          ? (await q(`SELECT id FROM "${fk.table}" WHERE "${fk.column}" = ANY($1)`, [[P, A]])).map(r => r.id)
          : [],
      };
    }

    const res = await deleteAccount(token(P), {
      identity_token: await appleToken('apple-p'),
      authorization_code: 'code-p',
    });

    expect(res).toEqual({
      status: 200,
      body: { deleted_child_ids: [A], unlinked_child_ids: [B], apple_token_revoked: true },
    });
    expect((await q('SELECT id FROM users ORDER BY id')).map(u => u.id)).toEqual([Q, R, B, C]);

    for (const fk of userRefs()) {
      const where = `${fk.table}.${fk.column}`;
      const was = before[where];
      expect(await count(fk.table, `"${fk.column}" = ANY($1)`, [[P, A]]), `${where} still names P or A`).toBe(0);
      if (fk.delete_rule === 'SET NULL') {
        // Kept, anonymized: the rows that named P or A are still there, naming no one.
        expect(was.anonymize.length, `${where} seeded`).toBeGreaterThan(0);
        expect(await count(fk.table, `id = ANY($1) AND "${fk.column}" IS NULL`, [was.anonymize]), `${where} anonymized`)
          .toBe(was.anonymize.length);
      }
      if (fk.table !== 'parent_child_links') {
        expect(await count(fk.table, `"${fk.column}" = ANY($1)`, [survivors]), `${where} survivors' rows`)
          .toBe(was.survivors);
      }
    }
  });

  it("keeps a co-parented child and their data, only unlinking the deleting parent", async () => {
    await q("INSERT INTO memory_passages (child_id, created_by_id, title, body) VALUES ($1, $2, 'From P', 'Hello')", [B, P]);
    const bRows = await count('node_progress', 'user_id = $1', [B]);

    await deleteAccount(token(P), { identity_token: await appleToken('apple-p') });

    expect(await q('SELECT parent_id FROM parent_child_links WHERE child_id = $1', [B])).toEqual([{ parent_id: Q }]);
    expect((await q('SELECT login_token FROM users WHERE id = $1', [B]))[0].login_token).toBe('login-b');
    expect(await count('node_progress', 'user_id = $1', [B])).toBe(bRows);
    expect(await q("SELECT created_by_id FROM memory_passages WHERE title = 'From P'")).toEqual([{ created_by_id: null }]);
  });

  it("clears the non-cascading child tables and un-names a deleted child in another kid's match", async () => {
    const [match] = await q("INSERT INTO matches (user_id, node_id, opponent_user_id, match_kind) VALUES ($1, 3, $2, 'pvp') RETURNING id", [C, A]);

    await deleteAccount(token(P), { identity_token: await appleToken('apple-p') });

    for (const table of ['node_progress', 'problem_attempts', 'wrong_taps', 'user_companions', 'play_minutes', 'matches']) {
      expect(await count(table, 'user_id = $1', [A]), table).toBe(0);
    }
    expect(await q('SELECT user_id, opponent_user_id FROM matches WHERE id = $1', [match.id]))
      .toEqual([{ user_id: C, opponent_user_id: null }]);
  });

  it('trades the authorization code for a token and revokes it at Apple, for the client the token was issued to', async () => {
    await deleteAccount(token(P), { identity_token: await appleToken('apple-p'), authorization_code: 'code-p' });

    expect(revokeCalls.map(c => c.url)).toEqual(['https://appleid.apple.com/auth/token', 'https://appleid.apple.com/auth/revoke']);
    expect(revokeCalls[0].form).toMatchObject({ client_id: BUNDLE_ID, code: 'code-p', grant_type: 'authorization_code' });
    expect(revokeCalls[1].form).toMatchObject({ client_id: BUNDLE_ID, token: 'rt-p', token_type_hint: 'refresh_token' });
  });

  it('still deletes, and says so, when revocation is not configured', async () => {
    delete process.env.APPLE_PRIVATE_KEY;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await deleteAccount(token(P), { identity_token: await appleToken('apple-p'), authorization_code: 'code-p' });

    expect(res.status).toBe(200);
    expect(res.body.apple_token_revoked).toBe(false);
    expect(revokeCalls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not revoked'));
    expect(await count('users', 'id = $1', [P])).toBe(0);
    warn.mockRestore();
  });

  it('leaves nothing for the old session to reach: a second attempt finds no account', async () => {
    const session = token(P);
    await deleteAccount(session, { identity_token: await appleToken('apple-p') });

    const again = await deleteAccount(session, { identity_token: await appleToken('apple-p') });
    expect(again).toEqual({ status: 404, body: { error: 'Account not found.' } });
    expect(await count('api_keys', 'user_id = $1', [P])).toBe(0);
    expect(await count('users', 'family_login_token = $1', ['family-p'])).toBe(0);
    expect(await count('users', 'login_token = $1', ['login-a'])).toBe(0);
  });

  it("refuses an Apple sign-in that isn't the parent's own, and deletes nothing", async () => {
    const res = await deleteAccount(token(P), { identity_token: await appleToken('apple-q') });
    expect(res).toEqual({ status: 401, body: { error: "That Apple Account isn't the one this account signs in with." } });
    expect(await count('users')).toBe(6);
  });

  it('checks the nonce like sign-in does', async () => {
    const { nonceHash } = require('../lib/appleIdentity.js');
    const signed = await appleToken('apple-p', { nonce: nonceHash('raw-1') });
    expect((await deleteAccount(token(P), { identity_token: signed, nonce: 'raw-2' })).status).toBe(401);
    expect((await deleteAccount(token(P), { identity_token: signed, nonce: 'raw-1' })).status).toBe(200);
  });

  it('turns away accounts without Apple, kids, missing tokens and missing sessions', async () => {
    expect(await deleteAccount(token(R), { identity_token: await appleToken('apple-r') })).toEqual({
      status: 403,
      body: { error: "This account doesn't use Sign in with Apple. Delete it from the parent dashboard on the website." },
    });
    expect((await deleteAccount(token(A, 'child'), { identity_token: await appleToken('apple-p') })).status).toBe(403);
    expect(await deleteAccount(token(P), {})).toEqual({
      status: 400, body: { error: 'Sign in with Apple again to delete your account.' },
    });
    expect((await deleteAccount(null, { identity_token: 'x' })).status).toBe(401);
    expect(await count('users')).toBe(6);
  });

  it('deletes a shared child when both parents delete at the same moment', async () => {
    const [p, q2] = await Promise.all([
      deleteAccount(token(P), { identity_token: await appleToken('apple-p') }),
      deleteAccount(token(Q), { identity_token: await appleToken('apple-q') }),
    ]);

    expect([p.status, q2.status]).toEqual([200, 200]);
    const deleted = [...p.body.deleted_child_ids, ...q2.body.deleted_child_ids].sort((x, y) => x - y);
    expect(deleted).toEqual([A, B, C]);
    expect((await q('SELECT id FROM users')).map(u => u.id)).toEqual([R]);
  });
});
