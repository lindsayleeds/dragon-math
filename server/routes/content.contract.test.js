// The content routes iOS reads — rule settings, node config, the dragon
// collection and catalog, custom spelling lists and their audio, memorize
// passages, and the versions of all of those — driven over HTTP and checked
// against their contracts
// (server/contracts/{settings,content,dragons,spelling,memorize}.js), the schemas
// openapi.json and the Swift client are generated from. Also pins that parsing
// child_id and the audio word through those schemas kept the routes' behaviour.
//
// Server code is CommonJS, so fakes are wired the plain Node way (see CLAUDE.md,
// Tests): Module._load for the spelling audio cache and the libraries the
// spelling write paths pull in, and methods replaced on the object
// `require('../db')` returns.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

let server;
let baseUrl;
let originalLoad;
let selectRows;
let executeRows;
let audioRows;
let signToken;
let expectContract;
const contractRoutes = [];
const checked = new Set();

const NODE_ROWS = [
  { node_id: 1, grid_size: 3, ops: '["add"]', range_min: 1, range_max: 10, ai_seconds: 6, shape_id: null },
  { node_id: 2, grid_size: 4, ops: '["add","sub"]', range_min: 1, range_max: 20, ai_seconds: 5.5, shape_id: 'heart' },
];

const CATALOG = [
  { dragon_id: 1, name: 'Ember', rarity: 'common' },
  { dragon_id: 2, name: null, rarity: 'mythic' },
];

const OWNED = [
  { dragon_id: 1, count: 3, first_acquired_at: new Date('2026-09-01T10:00:00.000Z'), name: 'Ember', rarity: 'common' },
  { dragon_id: 99, count: 1, first_acquired_at: null, name: null, rarity: 'common' },
];

const LIST_ROW = {
  id: 5,
  name: 'Week 1',
  child_id: 11,
  created_by_id: 7,
  created_at: new Date('2026-09-02T08:00:00.000Z'),
  updated_at: new Date('2026-09-03T08:00:00.000Z'),
};

const PASSAGE_ROW = {
  id: 3,
  childId: 11,
  createdById: 7,
  title: 'The Tyger',
  category: 'poem',
  body: 'Tyger Tyger, burning bright',
  masteryLevel: 1,
  lastPracticedAt: null,
  createdAt: new Date('2026-09-04T08:00:00.000Z'),
  updatedAt: new Date('2026-09-04T08:00:00.123Z'),
};

function fakeSelect() {
  return {
    from() { return this; },
    where() { return this; },
    orderBy() { return Promise.resolve(selectRows.shift() ?? []); },
    limit() { return Promise.resolve(selectRows.shift() ?? []); },
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'content-contract-test-secret';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../lib/spellingAudio') {
      return {
        getAudio: async word => audioRows[word] ?? null,
        cachedWords: async words => new Set(words.filter(w => w !== 'wyvern')),
        cachedPrompts: async words => (words.includes('dragon') ? { dragon: 'The dragon slept.' } : {}),
        ensureAudio: async () => { throw new Error('writes are not under test'); },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const dbModule = require('../db.js');
  dbModule.db.select = fakeSelect;
  dbModule.db.execute = async () => ({ rows: executeRows.shift() ?? [] });

  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/auth.js');
  signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });
  ({ expectContract } = require('../contracts/testing.js'));
  for (const area of ['settings', 'content', 'dragons', 'spelling', 'memorize']) {
    contractRoutes.push(...require(`../contracts/${area}.js`).routes);
  }

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/node-config', require('./nodeConfig.js'));
  app.use('/api/rule-settings', require('./ruleSettings.js'));
  app.use('/api/content', require('./contentVersions.js'));
  app.use('/api/dragons', require('./dragons.js'));
  app.use('/api/spelling', require('./spelling.js'));
  app.use('/api/memory-passages', require('./memoryPassages.js'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (originalLoad) Module._load = originalLoad;
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  selectRows = [];
  executeRows = [];
  audioRows = {};
});

const childSession = () => signToken({ id: 11, username: 'sparky', account_type: 'child' });
const parentSession = () => signToken({ id: 7, username: 'grownup@example.com', account_type: 'parent' });

// Calls a route and checks the response against the contract for `path` (the
// OpenAPI template, e.g. /api/spelling/audio/{word}).
async function call(path, { url = path, token, authorization } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (authorization) headers.Authorization = authorization;
  const res = await fetch(`${baseUrl}${url}`, { headers });
  const body = await expectContract(res, 'get', path);
  checked.add(`get ${path} ${res.status}`);
  return { status: res.status, headers: res.headers, body };
}

describe('settings', () => {
  it('serves the rule-settings document', async () => {
    selectRows = [NODE_ROWS];
    const res = await call('/api/rule-settings');
    expect(res.status).toBe(200);
    expect(res.body.nodes.map(n => n.ops)).toEqual([['add'], ['add', 'sub']]);
    expect(res.body.battle.opponent.min_delay_ms).toBeGreaterThan(0);
    expect(res.body.trial.speed_bands.at(-1).max_ms).toBeNull();
    expect(res.body.munchers.starting_lives).toBeGreaterThan(0);
  });

  it('serves node config', async () => {
    selectRows = [NODE_ROWS];
    const res = await call('/api/node-config');
    expect(res.status).toBe(200);
    expect(res.body.configs[1]).toMatchObject({ node_id: 2, shape_id: 'heart', ops: ['add', 'sub'] });
  });
});

describe('GET /api/content/versions', () => {
  const path = '/api/content/versions';
  const words = [{ listId: 5, word: 'dragon' }, { listId: 5, word: 'wyvern' }];

  // The versions for these rows, and each document as its own route serves it.
  async function versionsAndDocuments(nodeRows = NODE_ROWS, catalog = CATALOG) {
    selectRows = [nodeRows];
    executeRows = [catalog];
    const versions = (await call(path)).body;
    selectRows = [nodeRows];
    const ruleSettings = (await call('/api/rule-settings')).body;
    return { versions, ruleSettings };
  }

  it('versions the game-wide documents for anyone, with no child section', async () => {
    const { versions, ruleSettings } = await versionsAndDocuments();
    expect(versions.rule_settings).toBe(ruleSettings.version);
    expect(versions.node_config).toMatch(/^[0-9a-f]{16}$/);
    expect(versions.dragon_catalog).toMatch(/^[0-9a-f]{16}$/);
    expect(versions.child).toBeUndefined();
  });

  it('changes a version exactly when its document changes', async () => {
    const before = (await versionsAndDocuments()).versions;
    const same = (await versionsAndDocuments()).versions;
    expect(same).toEqual(before);

    const tuned = [{ ...NODE_ROWS[0], ai_seconds: 4 }, NODE_ROWS[1]];
    const nodesChanged = (await versionsAndDocuments(tuned)).versions;
    expect(nodesChanged.rule_settings).not.toBe(before.rule_settings);
    expect(nodesChanged.node_config).not.toBe(before.node_config);
    expect(nodesChanged.dragon_catalog).toBe(before.dragon_catalog);

    const catalogChanged = (await versionsAndDocuments(NODE_ROWS, [CATALOG[0]])).versions;
    expect(catalogChanged.dragon_catalog).not.toBe(before.dragon_catalog);
    expect(catalogChanged.rule_settings).toBe(before.rule_settings);
  });

  it("adds a child session's own list and passage versions", async () => {
    selectRows = [NODE_ROWS, [LIST_ROW], words, [PASSAGE_ROW]];
    executeRows = [CATALOG];
    const first = await call(path, { token: childSession() });
    expect(first.status).toBe(200);
    expect(first.body.child).toMatchObject({ child_id: 11 });

    selectRows = [NODE_ROWS, [LIST_ROW], words, [{ ...PASSAGE_ROW, body: 'Tyger Tyger, burning brighter' }]];
    executeRows = [CATALOG];
    const edited = await call(path, { url: `${path}?child_id=11`, token: childSession() });
    expect(edited.body.child.spelling_lists).toBe(first.body.child.spelling_lists);
    expect(edited.body.child.memory_passages).not.toBe(first.body.child.memory_passages);
  });

  it("adds a linked child's versions for a grown-up who names them, and none otherwise", async () => {
    selectRows = [[{ parentId: 7 }], NODE_ROWS, [], []];
    executeRows = [CATALOG];
    const linked = await call(path, { url: `${path}?child_id=11`, token: parentSession() });
    expect(linked.status).toBe(200);
    expect(linked.body.child.child_id).toBe(11);

    selectRows = [NODE_ROWS];
    executeRows = [CATALOG];
    const unnamed = await call(path, { token: parentSession() });
    expect(unnamed.status).toBe(200);
    expect(unnamed.body.child).toBeUndefined();
  });

  it('403s a child_id the caller may not see', async () => {
    expect((await call(path, { url: `${path}?child_id=12`, token: parentSession() })).status).toBe(403);
    expect((await call(path, { url: `${path}?child_id=12`, token: childSession() })).status).toBe(403);
  });

  it('401s a child_id without a session, and a session header that does not verify', async () => {
    expect((await call(path, { url: `${path}?child_id=11` })).status).toBe(401);
    expect((await call(path, { authorization: 'Bearer not-a-jwt' })).status).toBe(401);
  });

  it('400s a malformed child_id', async () => {
    const res = await call(path, { url: `${path}?child_id=abc`, token: childSession() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid child id');
  });
});

describe('dragons', () => {
  it("returns the child's collection with the catalog", async () => {
    executeRows = [OWNED, CATALOG];
    const res = await call('/api/dragons', { token: childSession() });
    expect(res.status).toBe(200);
    expect(res.body.owned[0].first_acquired_at).toBe('2026-09-01T10:00:00.000Z');
    expect(res.body.total_dragons).toBe(2);
  });

  it('returns the catalog', async () => {
    executeRows = [CATALOG];
    const res = await call('/api/dragons/catalog', { token: childSession() });
    expect(res.body).toEqual({ dragons: CATALOG, total: 2 });
  });

  it('401s without a session', async () => {
    expect((await call('/api/dragons')).status).toBe(401);
    expect((await call('/api/dragons/catalog')).status).toBe(401);
  });
});

describe('GET /api/spelling/lists', () => {
  const path = '/api/spelling/lists';
  const words = [{ listId: 5, word: 'dragon' }, { listId: 5, word: 'wyvern' }];

  it("returns a child's own lists", async () => {
    selectRows = [[LIST_ROW], words];
    const res = await call(path, { token: childSession() });
    expect(res.status).toBe(200);
    expect(res.body.lists).toEqual([{
      id: 5,
      name: 'Week 1',
      child_id: 11,
      created_at: '2026-09-02T08:00:00.000Z',
      updated_at: '2026-09-03T08:00:00.000Z',
      created_by_self: false,
      words: ['dragon', 'wyvern'],
      audio_missing: ['wyvern'],
      example_sentences: { dragon: 'The dragon slept.' },
    }]);
  });

  it("returns a linked child's lists to a grown-up, with child_id as a numeric string", async () => {
    selectRows = [[{ parentId: 7 }], []];
    const res = await call(path, { url: `${path}?child_id=11`, token: parentSession() });
    expect(res.status).toBe(200);
    expect(res.body.lists).toEqual([]);
  });

  it('403s a grown-up without a linked child_id, and a child asking for a sibling', async () => {
    expect((await call(path, { token: parentSession() })).status).toBe(403);
    expect((await call(path, { url: `${path}?child_id=12`, token: parentSession() })).status).toBe(403);
    expect((await call(path, { url: `${path}?child_id=12`, token: childSession() })).status).toBe(403);
  });

  it('400s a malformed child_id and 401s without a session', async () => {
    for (const bad of ['abc', '-1', '1.5']) {
      const res = await call(path, { url: `${path}?child_id=${bad}`, token: childSession() });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid child id');
    }
    expect((await call(path)).status).toBe(401);
  });
});

describe('GET /api/spelling/audio/{word}', () => {
  const path = '/api/spelling/audio/{word}';
  const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

  it('serves the clip for a word, with or without .mp3, in any case', async () => {
    audioRows = { dragon: { mp3, byteLength: mp3.length } };
    for (const word of ['dragon', 'Dragon.MP3', 'dragon.mp3']) {
      const res = await call(path, { url: `/api/spelling/audio/${word}` });
      expect(res.status).toBe(200);
      expect(res.body.equals(mp3)).toBe(true);
      expect(res.headers.get('cache-control')).toBe('public, max-age=604800');
    }
  });

  it('404s a word with no clip', async () => {
    const res = await call(path, { url: '/api/spelling/audio/wyvern.mp3' });
    expect(res.status).toBe(404);
  });

  it('400s anything that is not a word of at most 24 letters', async () => {
    for (const word of ['dr4gon', 'a'.repeat(25), 'dragon.wav', '%C3%A9t%C3%A9']) {
      const res = await call(path, { url: `/api/spelling/audio/${word}` });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid word');
    }
  });
});

describe('GET /api/memory-passages', () => {
  const path = '/api/memory-passages';

  it("returns a child's passages", async () => {
    selectRows = [[PASSAGE_ROW]];
    const res = await call(path, { token: childSession() });
    expect(res.status).toBe(200);
    expect(res.body.passages).toEqual([{
      id: 3,
      title: 'The Tyger',
      category: 'poem',
      body: 'Tyger Tyger, burning bright',
      mastery_level: 1,
      last_practiced_at: null,
      created_at: '2026-09-04T08:00:00.000Z',
      updated_at: '2026-09-04T08:00:00.123Z',
    }]);
  });

  it("returns a linked child's passages to a grown-up", async () => {
    selectRows = [[{ parentId: 7 }], [PASSAGE_ROW]];
    const res = await call(path, { url: `${path}?child_id=11`, token: parentSession() });
    expect(res.body.passages).toHaveLength(1);
  });

  it('403s an unlinked child_id, 400s a malformed one, 401s without a session', async () => {
    expect((await call(path, { url: `${path}?child_id=12`, token: parentSession() })).status).toBe(403);
    const bad = await call(path, { url: `${path}?child_id=nope`, token: parentSession() });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Invalid child id');
    expect((await call(path)).status).toBe(401);
  });
});

describe('coverage', () => {
  it('checks every documented status of every content route against a real response', () => {
    const missing = contractRoutes
      .flatMap(r => Object.keys(r.responses).map(status => `${r.method} ${r.path} ${status}`))
      .filter(key => !checked.has(key));
    expect(missing).toEqual([]);
  });
});
