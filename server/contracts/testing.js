// Test helpers: check a real response against the route contract, the same
// schemas openapi.json is generated from. Test-only — the server never loads it.
//
// Stricter than the published document on purpose. The document leaves objects
// open so an older app build tolerates a newly added field (see ./schemas.js),
// but here a field the contract does not describe is a failure: it means the
// route changed and openapi.json did not, and iOS will never see that field.
const { isDeepStrictEqual } = require('util');
const contracts = require('./index');

function findRoute(method, path, routes = contracts.routes) {
  return routes.find(r => r.method === method.toLowerCase() && r.path === path) || null;
}

// Paths in `body` that `parsed` (the schema's stripped output) dropped.
function undocumentedFields(body, parsed, at = '') {
  if (Array.isArray(body) && Array.isArray(parsed)) {
    return body.flatMap((item, i) => undocumentedFields(item, parsed[i], `${at}[${i}]`));
  }
  if (body && typeof body === 'object' && parsed && typeof parsed === 'object') {
    return Object.keys(body).flatMap(key => {
      const here = at ? `${at}.${key}` : key;
      return key in parsed ? undocumentedFields(body[key], parsed[key], here) : [here];
    });
  }
  return [];
}

// → a list of human-readable problems; empty when the response matches.
function contractProblems({ method, path, status, body, routes }) {
  const route = findRoute(method, path, routes);
  if (!route) return [`No contract for ${method.toUpperCase()} ${path}`];
  const response = route.responses[status];
  if (!response) {
    return [`${route.operationId}: status ${status} is not documented (documented: ${Object.keys(route.responses).join(', ')})`];
  }
  const result = response.schema.safeParse(body);
  if (!result.success) {
    return result.error.issues.map(i => `${route.operationId} ${status}: ${i.path.join('.') || '(body)'}: ${i.message}`);
  }
  const extra = undocumentedFields(body, result.data);
  if (extra.length) return extra.map(p => `${route.operationId} ${status}: undocumented field ${p}`);
  if (!isDeepStrictEqual(body, result.data)) return [`${route.operationId} ${status}: schema altered the body`];
  return [];
}

// Reads a fetch Response, asserts it matches the contract for `method path`, and
// returns the parsed body so the test can make its own assertions too.
async function expectContract(res, method, path) {
  const body = await res.json();
  const problems = contractProblems({ method, path, status: res.status, body });
  if (problems.length) {
    throw new Error(`Response does not match the contract:\n  ${problems.join('\n  ')}\nBody: ${JSON.stringify(body)}`);
  }
  return body;
}

module.exports = { findRoute, contractProblems, expectContract };
