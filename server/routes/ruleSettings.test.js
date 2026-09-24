// GET /api/rule-settings — the versioned rule-settings document both apps
// read their tunables from.
//
// The route is CommonJS and reaches the database through the `db` object
// nodeConfig.js destructured from ../db, so the fake is wired the plain Node
// way: that same object's `select` is replaced in place (vi.mock cannot reach
// require() inside a CJS module here). Nothing below opens a connection.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let server;
let baseUrl;
let rows;
let selectError;
let orderedBy;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';

  const dbModule = require('../db.js');
  dbModule.db.select = () => ({
    from: () => ({
      orderBy: async (column) => {
        orderedBy = column;
        if (selectError) throw selectError;
        return rows;
      },
    }),
  });

  const express = require('express');
  const app = express();
  app.use('/api/node-config', require('./nodeConfig.js'));
  app.use('/api/rule-settings', require('./ruleSettings.js'));
  // Express 5 forwards a rejected async handler here.
  app.use((err, _req, res, next) => { void next; res.status(500).json({ error: 'failed' }); });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  selectError = null;
  orderedBy = null;
  rows = [
    { node_id: 1, grid_size: 5, ops: '["add"]', range_min: 1, range_max: 3, ai_seconds: 10, shape_id: 'diamond' },
    { node_id: 2, grid_size: 5, ops: 'not json', range_min: 1, range_max: 5, ai_seconds: 9, shape_id: null },
  ];
});

const getSettings = () => fetch(`${baseUrl}/api/rule-settings`);

describe('GET /api/rule-settings', () => {
  it('returns the versioned document without authentication', async () => {
    const res = await getSettings();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema_version).toBe(1);
    expect(body.version).toMatch(/^[0-9a-f]{16}$/);
    expect(Object.keys(body).sort()).toEqual(['battle', 'nodes', 'schema_version', 'version']);
  });

  it('serves the node rows in node order, ops parsed', async () => {
    const { schema } = require('../db.js');
    const body = await (await getSettings()).json();
    expect(orderedBy).toBe(schema.nodeConfig.nodeId);
    expect(body.nodes).toEqual([
      { node_id: 1, grid_size: 5, ops: ['add'], range_min: 1, range_max: 3, ai_seconds: 10, shape_id: 'diamond' },
      { node_id: 2, grid_size: 5, ops: ['add'], range_min: 1, range_max: 5, ai_seconds: 9, shape_id: null },
    ]);
  });

  it('serves the battle opponent pace and timings at today\'s values', async () => {
    const body = await (await getSettings()).json();
    expect(body.battle).toEqual({
      opponent: { jitter_fraction: 0.35, min_delay_ms: 1500 },
      timings: { grid_blank_ms: 500, grid_blank_ai_ms: 2000, grid_lock_ms: 4000, wrong_flash_ms: 350 },
    });
  });

  it('changes version when a node row changes, and only then', async () => {
    const first = (await (await getSettings()).json()).version;
    expect((await (await getSettings()).json()).version).toBe(first);

    rows[0] = { ...rows[0], ai_seconds: 8 };
    expect((await (await getSettings()).json()).version).not.toBe(first);
  });

  it('serves the same node rows as GET /api/node-config', async () => {
    const settings = await (await getSettings()).json();
    const legacy = await (await fetch(`${baseUrl}/api/node-config`)).json();
    expect(settings.nodes).toEqual(legacy.configs);
  });

  it('fails with a 500 rather than a partial document when the database errors', async () => {
    selectError = new Error('db down');
    const res = await getSettings();
    expect(res.status).toBe(500);
  });
});
