// Contract for the public game-settings routes: GET /api/rule-settings (the
// versioned document the battle rules read, server/lib/ruleSettings.js) and
// GET /api/node-config (the same per-node rows on their own). Both are public:
// nothing in them is user-specific, and a guest or an offline-first client needs
// them before anyone signs in.
const { z } = require('zod');
const { defineRoute } = require('./route');

const NodeConfig = z
  .object({
    node_id: z.number().int(),
    grid_size: z.number().int().meta({ description: 'Battle grid is grid_size × grid_size cells (2–10).' }),
    ops: z.array(z.string()).meta({ description: 'Operations this node draws problems from: add, sub, mul, div.' }),
    range_min: z.number().int(),
    range_max: z.number().int(),
    ai_seconds: z.number().meta({ description: "The opponent's base seconds per solve on this node." }),
    shape_id: z.string().nullable().meta({ description: 'Grid shape id, or null for a plain square grid.' }),
  })
  .meta({ id: 'NodeConfig' });

const NodeConfigResponse = z.object({ configs: z.array(NodeConfig) }).meta({ id: 'NodeConfigResponse' });

const OpponentSettings = z
  .object({
    jitter_fraction: z.number().meta({ description: 'Solve delay is ai_seconds × 1000 jittered by ±(jitter_fraction / 2).' }),
    min_delay_ms: z.number().int().meta({ description: 'The opponent never solves faster than this.' }),
  })
  .meta({ id: 'OpponentSettings' });

const BattleTimings = z
  .object({
    grid_blank_ms: z.number().int().meta({ description: 'Grid blank time after the child solves a problem.' }),
    grid_blank_ai_ms: z.number().int().meta({ description: 'Grid blank time after the opponent solves one.' }),
    grid_lock_ms: z.number().int().meta({ description: 'How long a wrong tap locks the grid.' }),
    wrong_flash_ms: z.number().int().meta({ description: 'How long the tapped wrong cell flashes.' }),
  })
  .meta({ id: 'BattleTimings' });

const BattleSettings = z
  .object({ opponent: OpponentSettings, timings: BattleTimings })
  .meta({ id: 'BattleSettings' });

const RuleSettings = z
  .object({
    schema_version: z.number().int().meta({
      description: 'Shape of this document. Bumped only for a breaking change; new sections and fields are not breaking.',
    }),
    nodes: z.array(NodeConfig).meta({ description: 'Per-node config, in node_id order.' }),
    battle: BattleSettings,
    version: z.string().meta({ description: 'Hash of the content. Changes whenever any value does; compare to a cached copy.' }),
  })
  .meta({ id: 'RuleSettings' });

const routes = [
  defineRoute({
    method: 'get',
    path: '/api/rule-settings',
    operationId: 'getRuleSettings',
    summary: 'Every tunable the game rules read: per-node config plus game-wide battle settings.',
    tags: ['settings'],
    responses: { 200: { description: 'The rule-settings document.', schema: RuleSettings } },
  }),
  defineRoute({
    method: 'get',
    path: '/api/node-config',
    operationId: 'getNodeConfig',
    summary: 'Per-node battle config, in node_id order.',
    tags: ['settings'],
    responses: { 200: { description: 'Every node config row.', schema: NodeConfigResponse } },
  }),
];

module.exports = { routes };
