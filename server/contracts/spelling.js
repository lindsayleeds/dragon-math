// Contract for the Dragon Spelling reads iOS uses from server/routes/spelling.js:
// a child's custom word lists (GET /api/spelling/lists) and the spoken clip for
// each word (GET /api/spelling/audio/{word}). A list's audio URLs are not in the
// list: the client builds /api/spelling/audio/<word>.mp3 for each of `words`, and
// `audio_missing` says which of those will 404. Creating and editing lists is
// web-only (ADR 0002), so those routes have no contract.
const { z } = require('zod');
const { defineRoute, errors, binary } = require('./route');

const INVALID_CHILD = 'Invalid child id';
// Letters only, at most 24, with an optional .mp3 suffix in any case — the
// handler strips the suffix and lower-cases, exactly as before it had a schema.
const AUDIO_WORD_RE = /^[A-Za-z]{1,24}(\.[Mm][Pp]3)?$/;

const ChildIdQuery = z.object({
  child_id: z.coerce
    .number({ error: INVALID_CHILD })
    .int({ error: INVALID_CHILD })
    .positive({ error: INVALID_CHILD })
    .optional()
    .meta({ description: "Required for a grown-up (a linked child's id). A child may omit it, or pass their own id." }),
});

const AudioWordParams = z.object({
  word: z
    .string({ error: 'Invalid word' })
    .regex(AUDIO_WORD_RE, { error: 'Invalid word' })
    .meta({ description: 'The word, optionally with a .mp3 suffix (e.g. dragon.mp3). Case-insensitive.' }),
});

const SpellingList = z
  .object({
    id: z.number().int(),
    name: z.string(),
    child_id: z.number().int(),
    created_at: z.string().nullable().meta({ description: 'ISO 8601 timestamp.' }),
    updated_at: z.string().nullable().meta({ description: 'ISO 8601 timestamp. Changes on every edit.' }),
    created_by_self: z.boolean().meta({ description: 'True when the caller made the list (false: "added by a grown-up").' }),
    words: z.array(z.string()).meta({ description: 'Lower-case words, in the order the list was typed.' }),
    audio_missing: z.array(z.string()).meta({ description: 'Words with no recorded clip; their audio URL 404s.' }),
    example_sentences: z
      .record(z.string(), z.string())
      .meta({ description: 'Word → a sentence using it, for the words that have one.' }),
  })
  .meta({ id: 'SpellingList' });

const SpellingListsResponse = z.object({ lists: z.array(SpellingList) }).meta({ id: 'SpellingListsResponse' });

const routes = [
  defineRoute({
    method: 'get',
    path: '/api/spelling/lists',
    operationId: 'listSpellingLists',
    summary: "A child's custom spelling lists, oldest first.",
    tags: ['spelling'],
    auth: true,
    query: ChildIdQuery,
    responses: {
      200: { description: 'The lists.', schema: SpellingListsResponse },
      ...errors(400, 401, 403),
    },
  }),
  defineRoute({
    method: 'get',
    path: '/api/spelling/audio/{word}',
    operationId: 'getSpellingAudio',
    summary: 'The spoken clip for one spelling word. Public, and cacheable for a week.',
    tags: ['spelling'],
    params: AudioWordParams,
    responses: {
      200: binary('The MP3 clip.', 'audio/mpeg'),
      ...errors(400, 404),
    },
  }),
];

module.exports = { routes, ChildIdQuery, AudioWordParams };
