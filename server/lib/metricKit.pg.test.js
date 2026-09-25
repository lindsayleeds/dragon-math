// storeMetricKitPayload against a real Postgres: that the one statement stores a
// report, stores a resend once, and sweeps expired reports (oldest first, a
// bounded batch) — none of which a fake can prove. Everything decided before the
// statement is covered over HTTP by routes/diagnostics.contract.test.js.
//
// Opt-in, like the other *.pg.test.js files:
//
//   TEST_DATABASE_URL=postgres://user@host:5432/scratch_db npm test
//
// Runs in a schema of its own (search_path on every pooled connection), dropped
// at the end. The DDL restates server/db/schema.js's metrickit_payloads, and a
// check against schema.js's column list fails the suite if they drift apart.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);

const TEST_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_URL ? describe : describe.skip;

let admin;
let pool;
let db;
let schemaName;
let lib;

const q = async (text, params) => (await admin.query(text, params)).rows;

const report = (overrides = {}) => ({
  id: randomUUID(),
  kind: 'diagnostic',
  app_version: '0.1.0 (1)',
  os_version: 'iPhone OS 18.6 (22G86)',
  payload: { crashDiagnostics: [{ diagnosticMetaData: { regionFormat: 'US', signal: 11 } }], note: 'a\u0000b' },
  ...overrides,
});

suite('storeMetricKitPayload against a real Postgres', () => {
  beforeAll(async () => {
    const { Client, Pool } = require('pg');
    const { drizzle } = require('drizzle-orm/node-postgres');
    schemaName = `metrickit_${process.pid}_${Date.now()}`;
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    await admin.query(`SET search_path TO ${schemaName}`);
    await admin.query(`CREATE TABLE metrickit_payloads (
      id uuid PRIMARY KEY,
      kind text NOT NULL,
      app_version text NOT NULL,
      os_version text NOT NULL,
      payload jsonb NOT NULL,
      payload_bytes integer NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    )`);
    pool = new Pool({ connectionString: TEST_URL, options: `-c search_path=${schemaName}` });
    db = drizzle(pool);

    // Neither module loads ../db.js, so the pool above is the only connection.
    lib = require('./metricKit.js');

    const { getTableConfig } = require('drizzle-orm/pg-core');
    const { name, columns } = getTableConfig(require('../db/schema.js').metricKitPayloads);
    const rows = await q(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      [schemaName, name],
    );
    expect(rows.map(r => r.column_name).sort()).toEqual(columns.map(c => c.name).sort());
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await q('TRUNCATE metrickit_payloads');
  });

  it('stores a report, scrubbed, with its size', async () => {
    const r = report();
    await lib.storeMetricKitPayload(db, r);
    const [row] = await q('SELECT * FROM metrickit_payloads');
    expect(row).toMatchObject({ id: r.id, kind: 'diagnostic', app_version: '0.1.0 (1)', os_version: 'iPhone OS 18.6 (22G86)' });
    expect(row.payload).toEqual({ crashDiagnostics: [{ diagnosticMetaData: { signal: 11 } }], note: 'ab' });
    expect(row.payload_bytes).toBe(Buffer.byteLength(JSON.stringify(row.payload)));
  });

  it('stores a resent report once', async () => {
    const r = report();
    await lib.storeMetricKitPayload(db, r);
    await lib.storeMetricKitPayload(db, { ...r, app_version: 'changed' });
    expect(await q('SELECT app_version FROM metrickit_payloads')).toEqual([{ app_version: '0.1.0 (1)' }]);
  });

  it('sweeps expired reports oldest first, a bounded batch per insert', async () => {
    // Ages measured from one reference time, so the clock moving during the
    // test can't blur which rows are oldest.
    const [{ t }] = await q('SELECT now() AS t');
    await q(
      `INSERT INTO metrickit_payloads (id, kind, app_version, os_version, payload, payload_bytes, received_at)
       SELECT gen_random_uuid(), 'metric', 'v', 'os', '{}'::jsonb, 2,
              $1::timestamptz - make_interval(days => $2) - make_interval(mins => g)
       FROM generate_series(1, $3) AS g`,
      [t, lib.RETENTION_DAYS + 1, lib.SWEEP_BATCH + 5],
    );
    await q(
      `INSERT INTO metrickit_payloads (id, kind, app_version, os_version, payload, payload_bytes, received_at)
       VALUES ($1, 'metric', 'v', 'os', '{}'::jsonb, 2, $2::timestamptz - interval '1 day')`,
      [randomUUID(), t],
    );
    const expired = async () => (await q(
      `SELECT round(extract(epoch FROM ($1::timestamptz - make_interval(days => $2) - received_at)) / 60)::int AS mins
       FROM metrickit_payloads WHERE received_at < now() - make_interval(days => $3) ORDER BY 1`,
      [t, lib.RETENTION_DAYS + 1, lib.RETENTION_DAYS],
    )).map(r => r.mins);

    await lib.storeMetricKitPayload(db, report());
    // The oldest SWEEP_BATCH went; the 5 newest expired ones wait for the next insert.
    expect(await expired()).toEqual([1, 2, 3, 4, 5]);
    const [{ n }] = await q('SELECT count(*)::int AS n FROM metrickit_payloads');
    expect(n).toBe(5 + 2); // plus the unexpired row and the new report

    await lib.storeMetricKitPayload(db, report());
    expect(await expired()).toEqual([]);
  });
});
