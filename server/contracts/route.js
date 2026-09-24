// The shape of one route in the HTTP contract, plus the helpers route files use
// to build it. Plain data on purpose: this module (and every contract file) is
// loaded by the running server for input validation, so it depends on zod only.
// Turning the contract into OpenAPI needs @asteasolutions/zod-to-openapi, which
// is a devDependency used solely by server/openapi/document.js.
const { ErrorResponse } = require('./schemas');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const OPERATION_ID_RE = /^[a-z][A-Za-z0-9]*$/;

const ERROR_DESCRIPTIONS = {
  400: 'The request was invalid.',
  401: 'Missing, malformed or expired credentials.',
  403: 'Signed in, but not allowed to do this.',
  404: 'Not found.',
  409: 'Conflicts with the current state.',
  429: 'Rate limited. Try again later.',
  502: 'An upstream service failed.',
  503: 'Not configured on this server.',
};

// `errors(400, 404)` → documented ErrorResponse bodies for those statuses.
function errors(...statuses) {
  const out = {};
  for (const status of statuses) {
    if (!ERROR_DESCRIPTIONS[status]) throw new Error(`No error description for status ${status}`);
    out[status] = { description: ERROR_DESCRIPTIONS[status], schema: ErrorResponse };
  }
  return out;
}

// defineRoute({
//   method: 'post',
//   path: '/api/auth/family/{token}',  // OpenAPI path syntax; {x} ↔ Express :x
//   operationId: 'familyLogin',        // unique, lowerCamel; becomes a Swift method
//   summary: '…',
//   tags: ['auth'],
//   auth: true,                        // requires Authorization: Bearer <JWT>
//   params: z.object({ … }),           // optional path parameters
//   body: z.object({ … }),             // optional JSON request body
//   responses: { 200: { description, schema }, ...errors(400) },
// })
function defineRoute(def) {
  if (!METHODS.includes(def.method)) throw new Error(`Unknown method ${def.method} for ${def.path}`);
  if (!def.path.startsWith('/api/')) throw new Error(`Contract path must be absolute (/api/…): ${def.path}`);
  if (!OPERATION_ID_RE.test(def.operationId || '')) {
    throw new Error(`operationId must be lowerCamelCase: ${def.method} ${def.path}`);
  }
  if (!def.summary) throw new Error(`Missing summary: ${def.operationId}`);
  if (!def.responses || Object.keys(def.responses).length === 0) {
    throw new Error(`No responses documented: ${def.operationId}`);
  }
  return Object.freeze({ auth: false, tags: [], ...def });
}

module.exports = { defineRoute, errors };
