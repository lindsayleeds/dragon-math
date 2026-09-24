// Contract for GET /api/content/versions (server/routes/contentVersions.js): one
// short hash per content document the iOS app caches, so a device can tell which
// of its copies are stale and download only those (ADR 0003). Each hash changes
// whenever anything in that document's response body does.
//
// Public, like /api/rule-settings: the game-wide versions are the same for
// everyone and a guest needs them too. A session (optional) adds the versions of
// one child's own content — their spelling lists and memorize passages — under
// `child`, with the same access rule as those routes (resolveChildAccess).
const { z } = require('zod');
const { defineRoute, errors } = require('./route');
const { ChildIdQuery } = require('./spelling');

const version = (description) => z.string().meta({ description });

const ChildContentVersions = z
  .object({
    child_id: z.number().int(),
    spelling_lists: version('Hash of GET /api/spelling/lists?child_id=… as this caller sees it.'),
    memory_passages: version('Hash of GET /api/memory-passages?child_id=….'),
  })
  .meta({
    id: 'ChildContentVersions',
    description: "One child's content versions: sent for a child session, or for a grown-up who passes a linked child_id.",
  });

const ContentVersions = z
  .object({
    rule_settings: version('The `version` of GET /api/rule-settings.'),
    node_config: version('Hash of GET /api/node-config.'),
    dragon_catalog: version('Hash of GET /api/dragons/catalog.'),
    child: ChildContentVersions.optional(),
  })
  .meta({ id: 'ContentVersions' });

const ContentVersionsQuery = ChildIdQuery.extend({
  child_id: ChildIdQuery.shape.child_id.meta({
    description: "Adds that child's versions under `child`. Needs a session: a child may pass their own id (or omit it), a grown-up a linked child's.",
  }),
});

const routes = [
  defineRoute({
    method: 'get',
    path: '/api/content/versions',
    operationId: 'getContentVersions',
    summary: 'A version hash per cached content document, to check which ones changed.',
    tags: ['content'],
    query: ContentVersionsQuery,
    responses: {
      200: { description: 'The versions.', schema: ContentVersions },
      ...errors(400, 401, 403),
    },
  }),
];

module.exports = { routes, ContentVersionsQuery };
