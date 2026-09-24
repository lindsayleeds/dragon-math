// Validate a request body (or params/query) against a contract schema from
// server/contracts/. Returns { ok: true, data } with the parsed, trimmed and
// coerced values, or { ok: false, error } carrying the first issue's message —
// the message the contract wrote for the client, so a handler can reply with
// `res.status(400).json({ error })` exactly as its hand-written checks did.
//
// A body that is not a JSON object is treated as `{}`, matching the
// `req.body?.field` reads the routes used before they had schemas.
function parseInput(schema, input) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message || 'Invalid request' };
}

module.exports = { parseInput };
