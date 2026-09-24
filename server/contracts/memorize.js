// Contract for the Dragon Memorize read iOS uses from
// server/routes/memoryPassages.js: a child's assigned passages. Authoring them
// is web-only (ADR 0002), and practice progress is a kid action that iOS sends
// through the sync event queue (ADR 0003), so neither has a contract here.
const { z } = require('zod');
const { defineRoute, errors } = require('./route');
const { ChildIdQuery } = require('./spelling');

const MemoryPassage = z
  .object({
    id: z.number().int(),
    title: z.string(),
    category: z.string().meta({ description: 'What kind of text it is, verse, poem, quote, speech, definition or other.' }),
    body: z.string().meta({ description: 'The text to learn, exactly as the grown-up entered it.' }),
    mastery_level: z.number().int().meta({ description: 'Hardest level practised: 0 none, 1 easy, 2 medium, 3 hard.' }),
    last_practiced_at: z.string().nullable().meta({ description: 'ISO 8601 timestamp, or null if never practised.' }),
    created_at: z.string().nullable().meta({ description: 'ISO 8601 timestamp.' }),
    updated_at: z.string().meta({
      description: 'ISO 8601 timestamp of the last edit; identifies the revision a practice session was of.',
    }),
  })
  .meta({ id: 'MemoryPassage' });

const MemoryPassagesResponse = z.object({ passages: z.array(MemoryPassage) }).meta({ id: 'MemoryPassagesResponse' });

const routes = [
  defineRoute({
    method: 'get',
    path: '/api/memory-passages',
    operationId: 'listMemoryPassages',
    summary: "A child's memorize passages, oldest first.",
    tags: ['memorize'],
    auth: true,
    query: ChildIdQuery,
    responses: {
      200: { description: 'The passages.', schema: MemoryPassagesResponse },
      ...errors(400, 401, 403),
    },
  }),
];

module.exports = { routes };
