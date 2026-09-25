// Contract for the dragon collection reads in server/routes/dragons.js: the
// signed-in child's collection (GET /api/dragons), the active catalog games
// award from (GET /api/dragons/catalog) and each dragon's art
// (GET /api/dragons/art/{dragon_id}), which the app downloads for a dragon added
// after its release (#143). Collecting a dragon is a kid action, so iOS records
// it through the sync event queue (ADR 0003), not POST /collect.
const { z } = require('zod');
const { defineRoute, errors, binary } = require('./route');

// Rarity is a db check constraint (common … mythic), but a string here so a
// rarity added later does not break an older app's decoding (see ./schemas.js).
const Rarity = z.string().meta({ description: 'common, uncommon, rare, very_rare, legendary or mythic.' });

const CatalogDragon = z
  .object({
    dragon_id: z.number().int(),
    name: z.string().nullable(),
    rarity: Rarity,
    art_sha256: z
      .string()
      .nullable()
      .meta({ description: 'Hex SHA-256 of GET /api/dragons/art/{dragon_id}; null when the dragon has no art yet.' }),
    art_bytes: z.number().int().nullable().meta({ description: 'Size of that PNG in bytes; null with art_sha256.' }),
  })
  .meta({ id: 'CatalogDragon' });

const OwnedDragon = z
  .object({
    dragon_id: z.number().int(),
    count: z.number().int().meta({ description: 'How many of this dragon the child has caught.' }),
    first_acquired_at: z.string().nullable().meta({ description: 'ISO 8601 timestamp of the first catch.' }),
    name: z.string().nullable().meta({ description: 'Null when the dragon is not in the catalog.' }),
    rarity: Rarity,
  })
  .meta({ id: 'OwnedDragon' });

const DragonCollectionResponse = z
  .object({
    owned: z.array(OwnedDragon),
    catalog: z.array(CatalogDragon).meta({ description: 'Every non-retired dragon, in dragon_id order.' }),
    total_dragons: z.number().int().meta({ description: 'Length of catalog, for the "X / total collected" headline.' }),
  })
  .meta({ id: 'DragonCollectionResponse' });

const DragonCatalogResponse = z
  .object({
    dragons: z.array(CatalogDragon).meta({ description: 'Every non-retired dragon, in dragon_id order.' }),
    total: z.number().int(),
  })
  .meta({ id: 'DragonCatalogResponse' });

// A dragon id, optionally with a .png suffix (12 or 12.png).
const DRAGON_ART_RE = /^[1-9][0-9]{0,8}(\.png)?$/;

const DragonArtParams = z.object({
  dragon_id: z
    .string({ error: 'Invalid dragon id' })
    .regex(DRAGON_ART_RE, { error: 'Invalid dragon id' })
    .meta({ description: 'The dragon id, optionally with a .png suffix (e.g. 12.png).' }),
});

const routes = [
  defineRoute({
    method: 'get',
    path: '/api/dragons',
    operationId: 'getDragonCollection',
    summary: "The signed-in child's dragon collection, with the active catalog.",
    tags: ['dragons'],
    auth: true,
    responses: { 200: { description: 'The collection.', schema: DragonCollectionResponse }, ...errors(401) },
  }),
  defineRoute({
    method: 'get',
    path: '/api/dragons/catalog',
    operationId: 'getDragonCatalog',
    summary: 'The active dragon roster games award from.',
    tags: ['dragons'],
    auth: true,
    responses: { 200: { description: 'The catalog.', schema: DragonCatalogResponse }, ...errors(401) },
  }),
  defineRoute({
    method: 'get',
    path: '/api/dragons/art/{dragon_id}',
    operationId: 'getDragonArt',
    summary: "A dragon's art, the PNG the web shows. Public, and cacheable for a day.",
    tags: ['dragons'],
    params: DragonArtParams,
    responses: {
      200: binary('The PNG.', 'image/png'),
      ...errors(400, 404),
    },
  }),
];

module.exports = { routes, DragonArtParams };
