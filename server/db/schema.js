// Drizzle ORM schema for Dragon Math's Postgres (Supabase) database.
//
// This mirrors the prior SQLite schema (see DB_MIGRATION.md for the
// SQLite→Postgres type translations). The citext extension must be created
// before `drizzle-kit push` runs — see drizzle.config.cjs / migration notes.

const {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  real,
  timestamp,
  customType,
  index,
  uniqueIndex,
  primaryKey,
  check,
} = require('drizzle-orm/pg-core');
const { sql } = require('drizzle-orm');

// Case-insensitive text — replaces SQLite's `COLLATE NOCASE` on usernames.
const citext = customType({
  dataType() { return 'citext'; },
});

const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: citext('username').notNull().unique(),
  currentNodeId: integer('current_node_id').notNull().default(1),
  avatar: text('avatar').notNull().default('⚔️'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  accountType: text('account_type').notNull().default('child'),
  email: text('email'),
  passwordHash: text('password_hash'),
  googleSub: text('google_sub'),
  emailVerified: boolean('email_verified').notNull().default(false),
  weeklyReportEnabled: boolean('weekly_report_enabled').notNull().default(true),
  adultRole: text('adult_role').notNull().default('parent'),
  activeCompanionId: text('active_companion_id'),
  dragonTrialCompleted: boolean('dragon_trial_completed').notNull().default(false),
}, (t) => ({
  emailIdx:    uniqueIndex('idx_users_email').on(t.email).where(sql`${t.email} IS NOT NULL`),
  googleIdx:   uniqueIndex('idx_users_google_sub').on(t.googleSub).where(sql`${t.googleSub} IS NOT NULL`),
}));

const nodeProgress = pgTable('node_progress', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  nodeId: integer('node_id').notNull(),
  completed: boolean('completed').notNull().default(false),
  stars: integer('stars'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => ({
  userNodeUq: uniqueIndex('node_progress_user_node_unique').on(t.userId, t.nodeId),
}));

const nodeConfig = pgTable('node_config', {
  nodeId: integer('node_id').primaryKey(),
  gridSize: integer('grid_size').notNull(),
  ops: text('ops').notNull().default('["add"]'),
  rangeMin: integer('range_min').notNull().default(1),
  rangeMax: integer('range_max').notNull().default(10),
  aiSeconds: real('ai_seconds').notNull().default(6.0),
  shapeId: text('shape_id'),
}, (t) => ({
  gridSizeRange: check('node_config_grid_size_check', sql`${t.gridSize} BETWEEN 2 AND 10`),
}));

const problemAttempts = pgTable('problem_attempts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  nodeId: integer('node_id').notNull(),
  operandA: integer('operand_a').notNull(),
  operandB: integer('operand_b').notNull(),
  operator: text('operator').notNull(),
  answer: integer('answer').notNull(),
  outcome: text('outcome').notNull(),
  timeMs: integer('time_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userTimeIdx: index('idx_attempts_user_time').on(t.userId, t.createdAt),
  userOpIdx:   index('idx_attempts_user_op').on(t.userId, t.operator),
  outcomeChk:  check('problem_attempts_outcome_check', sql`${t.outcome} IN ('child', 'ai')`),
}));

const wrongTaps = pgTable('wrong_taps', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  nodeId: integer('node_id').notNull(),
  operandA: integer('operand_a').notNull(),
  operandB: integer('operand_b').notNull(),
  operator: text('operator').notNull(),
  correctAnswer: integer('correct_answer').notNull(),
  tappedValue: integer('tapped_value').notNull(),
  timeMs: integer('time_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userTimeIdx: index('idx_wrong_taps_user_time').on(t.userId, t.createdAt),
}));

const userCompanions = pgTable('user_companions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  companionId: text('companion_id').notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userCompUq: uniqueIndex('user_companions_user_comp_unique').on(t.userId, t.companionId),
}));

// One row per (user, local-minute) the user was actively in a battle. Minute
// is stored as local-time 'YYYY-MM-DD HH:MM'; PK enforces idempotency.
const playMinutes = pgTable('play_minutes', {
  userId: integer('user_id').notNull().references(() => users.id),
  minute: text('minute').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.minute] }),
  userDayIdx: index('idx_play_minutes_user_day').on(t.userId, t.minute),
}));

const matches = pgTable('matches', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  nodeId: integer('node_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  outcome: text('outcome'),
  playerScore: integer('player_score').notNull().default(0),
  aiScore: integer('ai_score').notNull().default(0),
}, (t) => ({
  userStartedIdx: index('idx_matches_user_started').on(t.userId, t.startedAt),
  userNodeIdx:    index('idx_matches_user_node').on(t.userId, t.nodeId),
  outcomeChk:     check('matches_outcome_check', sql`${t.outcome} IN ('child', 'ai', 'incomplete')`),
}));

const parentChildLinks = pgTable('parent_child_links', {
  parentId: integer('parent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  childId:  integer('child_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.parentId, t.childId] }),
  childIdx: index('idx_pcl_child').on(t.childId),
}));

const parentClaimCodes = pgTable('parent_claim_codes', {
  childId: integer('child_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// period_start/period_end are stored as TEXT (e.g. 'YYYY-MM-DD') in SQLite —
// keep as text to avoid touching call sites that format/compare them.
const weeklyReportLog = pgTable('weekly_report_log', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  status: text('status').notNull().default('pending'),
  error: text('error'),
}, (t) => ({
  parentPeriodUq: uniqueIndex('weekly_report_parent_period_unique').on(t.parentId, t.periodStart),
}));

// Dragon's Trial placement-test summary. One row per child; replaced on retake.
// Per-op score is 0-1000; band is one of 'fluent' | 'capable' | 'developing' |
// 'emerging' | 'not_ready' (rendered as 5★ → 1★). '*_asked' tracks how many
// problems were posed for that op. highest_op = highest fluent op among
// add/sub/mul; placement target = start of first non-fluent op.
const dragonTrialResults = pgTable('dragon_trial_results', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
  targetNodeId: integer('target_node_id').notNull(),
  highestOp: text('highest_op'),
  addScore: integer('add_score').notNull().default(0),
  addBand:  text('add_band').notNull().default('not_ready'),
  addAsked: integer('add_asked').notNull().default(0),
  subScore: integer('sub_score').notNull().default(0),
  subBand:  text('sub_band').notNull().default('not_ready'),
  subAsked: integer('sub_asked').notNull().default(0),
  mulScore: integer('mul_score').notNull().default(0),
  mulBand:  text('mul_band').notNull().default('not_ready'),
  mulAsked: integer('mul_asked').notNull().default(0),
  divScore: integer('div_score').notNull().default(0),
  divBand:  text('div_band').notNull().default('not_ready'),
  divAsked: integer('div_asked').notNull().default(0),
});

module.exports = {
  users,
  nodeProgress,
  nodeConfig,
  problemAttempts,
  wrongTaps,
  userCompanions,
  playMinutes,
  matches,
  parentChildLinks,
  parentClaimCodes,
  weeklyReportLog,
  dragonTrialResults,
};
