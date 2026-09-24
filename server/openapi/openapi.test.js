import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { buildDocument, serializeDocument, OPENAPI_PATH } = require('./document.js');
const { routes } = require('../contracts/index.js');
const { contractProblems } = require('../contracts/testing.js');

function operations(doc) {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, op]) => ({ path, method, op })),
  );
}

describe('openapi.json', () => {
  it('is up to date with server/contracts (run `npm run openapi` if this fails)', () => {
    const checkedIn = fs.readFileSync(OPENAPI_PATH, 'utf8');
    expect(checkedIn).toBe(serializeDocument());
  });

  it('targets OpenAPI 3.0.3 for swift-openapi-generator', () => {
    expect(buildDocument().openapi).toBe('3.0.3');
  });

  it('gives every operation a unique operationId', () => {
    const ids = operations(buildDocument()).map(({ op }) => op.operationId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(routes.length);
  });

  it('names every request and response body as a component', () => {
    const inline = [];
    for (const { path, method, op } of operations(buildDocument())) {
      const bodies = [
        ['request', op.requestBody],
        ...Object.entries(op.responses).map(([status, r]) => [status, r]),
      ];
      for (const [where, body] of bodies) {
        // A file download (binary() in server/contracts/route.js) has no JSON
        // body to name.
        const [[type, media] = []] = Object.entries(body?.content || {});
        if (type !== 'application/json' && media?.schema?.format === 'binary') continue;
        const schema = body?.content?.['application/json']?.schema;
        if (body && !schema?.$ref) inline.push(`${method.toUpperCase()} ${path} ${where}`);
      }
    }
    expect(inline).toEqual([]);
  });

  it('declares exactly the path parameters each path template uses', () => {
    for (const route of routes) {
      const inPath = [...route.path.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
      const declared = Object.keys(route.params?.shape || {}).sort();
      expect(declared, route.operationId).toEqual(inPath);
    }
  });
});

describe('contract response checks', () => {
  const child = {
    id: 1,
    username: 'sparky',
    account_type: 'child',
    current_node_id: 1,
    avatar: '🐉',
    font: 'clean',
    dragon_trial_completed: false,
    needs_handle: false,
    effective_plan: 'free',
    entitlements: { games_locked: [] },
  };
  const check = (status, body) =>
    contractProblems({ method: 'get', path: '/api/auth/me', status, body });

  it('accepts a response that matches', () => {
    expect(check(200, { user: child })).toEqual([]);
  });

  it('fails a missing or mistyped field', () => {
    const { needs_handle: _omit, ...missing } = child;
    expect(check(200, { user: missing })).not.toEqual([]);
    expect(check(200, { user: { ...child, id: '1' } })).not.toEqual([]);
  });

  it('fails a field the contract does not describe, however deep', () => {
    expect(check(200, { user: { ...child, entitlements: { games_locked: [], secret: 1 } } }))
      .toEqual(['getCurrentUser 200: undocumented field user.entitlements.secret']);
  });

  it('fails an undocumented status or route', () => {
    expect(check(500, { error: 'boom' })[0]).toMatch(/status 500 is not documented/);
    expect(contractProblems({ method: 'get', path: '/api/nope', status: 200, body: {} })[0])
      .toMatch(/No contract/);
  });
});
