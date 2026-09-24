// POST /api/diagnostics/metrickit, driven over HTTP and checked against its
// contract (server/contracts/diagnostics.js) with no database. The fake
// `db.execute` records each statement (rendered through drizzle's PgDialect) so
// the tests can see exactly what would be stored — and, as importantly, what
// would not: no account, no IP. metricKit.pg.test.js runs the statement against
// a real Postgres.
//
// Server code is CommonJS, so fakes are wired the plain Node way (see CLAUDE.md,
// Tests): Module._load for the rate limiter, and a method replaced on the object
// `require('../db')` returns.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('module');
const { PgDialect } = require('drizzle-orm/pg-core');

const PATH = '/api/diagnostics/metrickit';
const fixture = name => JSON.parse(readFileSync(
  fileURLToPath(new URL(`../../ios/Packages/Diagnostics/Tests/DiagnosticsTests/Fixtures/${name}`, import.meta.url)), 'utf8'));

let server;
let baseUrl;
let originalLoad;
let signToken;
let expectContract;
let executed;
let rateCalls;
let rateAllowed;

function post(body, headers = {}) {
  return fetch(`${baseUrl}${PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const report = (overrides = {}) => ({
  id: randomUUID().toUpperCase(),
  kind: 'metric',
  app_version: '0.1.0 (1)',
  os_version: 'Version 18.6 (Build 22G86)',
  payload: fixture('metric-payload.json'),
  ...overrides,
});

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'diagnostics-contract-test-secret';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../lib/rateLimit') {
      return {
        rateLimit: async (opts) => {
          rateCalls.push(opts);
          return { allowed: rateAllowed(opts) };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const dialect = new PgDialect();
  const dbModule = require('../db.js');
  dbModule.db.execute = async (query) => {
    executed.push(dialect.sqlToQuery(query));
    return { rows: [] };
  };

  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/auth.js');
  signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });
  ({ expectContract } = require('../contracts/testing.js'));

  // Mounted the way server/index.js mounts it: behind the global 100kb parser,
  // which skips this path.
  const express = require('express');
  const app = express();
  const jsonParser = express.json();
  app.use((req, res, next) => (req.path === PATH ? next() : jsonParser(req, res, next)));
  app.use('/api/diagnostics', require('./diagnostics.js'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (originalLoad) Module._load = originalLoad;
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  executed = [];
  rateCalls = [];
  rateAllowed = () => true;
});

// The row the INSERT would write, by column.
function storedRow() {
  expect(executed).toHaveLength(1);
  const { sql, params } = executed[0];
  const columns = sql.match(/INSERT INTO metrickit_payloads \(([^)]+)\)/)[1].split(',').map(c => c.trim());
  // The sweep's two parameters (retention days, batch size) come first.
  const values = params.slice(2);
  expect(values).toHaveLength(columns.length);
  return Object.fromEntries(columns.map((c, i) => [c, values[i]]));
}

describe('POST /api/diagnostics/metrickit contract', () => {
  it('stores a metric report and answers 202', async () => {
    const body = report();
    const res = await post(body);
    expect(res.status).toBe(202);
    expect(await expectContract(res, 'post', PATH)).toEqual({ accepted: true });

    const row = storedRow();
    expect(row).toMatchObject({
      id: body.id,
      kind: 'metric',
      app_version: '0.1.0 (1)',
      os_version: 'Version 18.6 (Build 22G86)',
    });
    const stored = JSON.parse(row.payload);
    expect(stored.applicationLaunchMetrics).toEqual(body.payload.applicationLaunchMetrics);
    expect(row.payload_bytes).toBe(Buffer.byteLength(row.payload));
  });

  it('stores a diagnostic report with its call stacks', async () => {
    const body = report({ kind: 'diagnostic', payload: fixture('diagnostic-payload.json') });
    const res = await post(body);
    expect(res.status).toBe(202);
    const stored = JSON.parse(storedRow().payload);
    expect(stored.crashDiagnostics[0].callStackTree).toEqual(body.payload.crashDiagnostics[0].callStackTree);
  });

  it('drops the region setting wherever MetricKit put it', async () => {
    const body = report({ kind: 'diagnostic', payload: fixture('diagnostic-payload.json') });
    expect(JSON.stringify(body.payload)).toContain('regionFormat');
    await post(body);
    expect(storedRow().payload).not.toContain('regionFormat');
  });

  it('stores nothing that identifies the sender, and ignores a session', async () => {
    const token = signToken({ id: 4242, username: 'grownup', account_type: 'parent' });
    const res = await post(report(), { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(202);
    const row = storedRow();
    expect(Object.keys(row).sort()).toEqual(['app_version', 'id', 'kind', 'os_version', 'payload', 'payload_bytes']);
    const everything = JSON.stringify(executed[0].params);
    expect(everything).not.toContain('4242');
    expect(everything).not.toContain('127.0.0.1');
  });

  it('accepts a report whose Authorization header is garbage', async () => {
    const res = await post(report(), { Authorization: 'Bearer not-a-jwt' });
    expect(res.status).toBe(202);
  });

  it('rate limits per sender and server-wide, keyed on the IP but never storing it', async () => {
    await post(report());
    expect(rateCalls.map(c => c.key)).toEqual(['metrickit:127.0.0.1', 'metrickit-all:global']);

    rateCalls = [];
    rateAllowed = ({ key }) => key !== 'metrickit:127.0.0.1';
    let res = await post(report());
    expect(res.status).toBe(429);
    await expectContract(res, 'post', PATH);
    // A sender over its own limit doesn't eat into everyone's.
    expect(rateCalls.map(c => c.key)).toEqual(['metrickit:127.0.0.1']);

    rateAllowed = ({ key }) => key !== 'metrickit-all:global';
    res = await post(report());
    expect(res.status).toBe(429);
    expect(executed).toHaveLength(1); // only the first report was stored
  });

  it.each([
    ['a missing id', { id: undefined }, 'id must be a UUID'],
    ['an id that is not a UUID', { id: 'device-1' }, 'id must be a UUID'],
    ['an unknown kind', { kind: 'crash' }, 'kind must be metric or diagnostic'],
    ['an empty app version', { app_version: '  ' }, 'app_version must not be empty'],
    ['an overlong OS version', { os_version: 'x'.repeat(65) }, 'os_version must be at most 64 characters'],
    ['a payload that is not an object', { payload: [1, 2] }, 'payload must be an object'],
  ])('rejects %s with a 400', async (_label, overrides, error) => {
    const res = await post(report(overrides));
    expect(res.status).toBe(400);
    expect(await expectContract(res, 'post', PATH)).toEqual({ error });
    expect(executed).toHaveLength(0);
  });

  it('answers malformed JSON with a JSON 400', async () => {
    const res = await post('{"kind": ');
    expect(res.status).toBe(400);
    expect(await expectContract(res, 'post', PATH)).toEqual({ error: 'The body is not valid JSON' });
  });

  it('refuses a body over 256 KB with a JSON 413, before storing anything', async () => {
    const res = await post(report({ payload: { blob: 'x'.repeat(256 * 1024) } }));
    expect(res.status).toBe(413);
    expect(await expectContract(res, 'post', PATH)).toEqual({ error: 'A report may be at most 256 KB' });
    expect(executed).toHaveLength(0);
  });

  it('takes a report bigger than the global 100kb parser allows', async () => {
    const res = await post(report({ payload: { blob: 'x'.repeat(200 * 1024) } }));
    expect(res.status).toBe(202);
  });

  it('refuses a payload nested too deeply to walk', async () => {
    let payload = {};
    for (let i = 0; i < 2100; i += 1) payload = { a: payload };
    const res = await post(report({ payload }));
    expect(res.status).toBe(400);
    expect((await expectContract(res, 'post', PATH)).error).toMatch(/nested more than 2000 levels/);
    expect(executed).toHaveLength(0);
  });
});
