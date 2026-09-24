// Contract for the dragon collection reads in server/routes/dragons.js: the
// signed-in child's collection (GET /api/dragons) and the active catalog games
// award from (GET /api/dragons/catalog). Collecting a dragon is a kid action, so
// iOS records it through the sync event queue (ADR 0003), not POST /collect.
const { z } = require('zod');
const { defineRoute, errors } = require('./route');

// Rarity is a db check constraint (common … mythic), but a string here so a
// rarity added later does not break an older app's decoding (see ./schemas.js).
const Rarity = z.string().meta({ description: 'common, uncommon, rare, very_rare, legendary or mythic.' });

const CatalogDragon = z
  .object({
    dragon_id: z.number().int(),
    name: z.string().nullable(),
    rarity: Rarity,
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
];

module.exports = { routes };
