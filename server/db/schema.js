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
  font: text('font').notNull().default('handwritten'),
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
  // Permanent, password-equivalent "login by URL" secret for kids whose parent
  // created their account. The child visits /k/<login_token> to sign in — no
  // password. NULL for parents and for kids who self-signed-up by username.
  loginToken: text('login_token'),
  // True between parent-creation and the moment the kid picks their own handle.
  needsHandle: boolean('needs_handle').notNull().default(false),
}, (t) => ({
  emailIdx:    uniqueIndex('idx_users_email').on(t.email).where(sql`${t.email} IS NOT NULL`),
  googleIdx:   uniqueIndex('idx_users_google_sub').on(t.googleSub).where(sql`${t.googleSub} IS NOT NULL`),
  loginTokenIdx: uniqueIndex('idx_users_login_token').on(t.loginToken).where(sql`${t.loginToken} IS NOT NULL`),
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
  // Live PvP fields. For an AI match these stay null/'ai'. For a PvP match the
  // server writes one row per player: opponentUserId is the other kid, matchKind
  // is 'pvp', and pvpMatchUid correlates the two rows of the same battle. The
  // outcome enum is reused as-is — 'child' = this row's user won, 'ai' = lost,
  // 'incomplete' = neither finished (e.g. both disconnected).
  opponentUserId: integer('opponent_user_id').references(() => users.id),
  matchKind: text('match_kind').notNull().default('ai'),
  pvpMatchUid: text('pvp_match_uid'),
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

// A teacher-owned classroom. Teachers are adult accounts (account_type 'parent')
// with adult_role 'teacher'. joinCode is a short, human-typeable code kids enter
// to join the class themselves; it's unique so a code resolves to one classroom.
const classrooms = pgTable('classrooms', {
  id: serial('id').primaryKey(),
  teacherId: integer('teacher_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  joinCode: text('join_code').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  teacherIdx: index('idx_classrooms_teacher').on(t.teacherId),
}));

// Roster join table: one row per (classroom, child). A kid may belong to more
// than one classroom; the UI treats a single classroom as the common case.
const classroomMembers = pgTable('classroom_members', {
  classroomId: integer('classroom_id').notNull().references(() => classrooms.id, { onDelete: 'cascade' }),
  childId:     integer('child_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.classroomId, t.childId] }),
  childIdx: index('idx_classroom_members_child').on(t.childId),
}));

// A kid-owned tribe — a peer group of adventurers. Mirrors `classrooms` but the
// owner is a child (account_type 'child'), not a teacher. joinCode is the short,
// human-typeable code friends enter to join; unique so a code resolves to one
// tribe. The owner is also inserted into tribe_members on creation, so roster /
// membership queries can treat the owner like any other member.
const tribes = pgTable('tribes', {
  id: serial('id').primaryKey(),
  ownerId: integer('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  joinCode: text('join_code').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  ownerIdx: index('idx_tribes_owner').on(t.ownerId),
}));

// Roster join table: one row per (tribe, child). A kid may belong to many tribes.
const tribeMembers = pgTable('tribe_members', {
  tribeId: integer('tribe_id').notNull().references(() => tribes.id, { onDelete: 'cascade' }),
  childId: integer('child_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tribeId, t.childId] }),
  childIdx: index('idx_tribe_members_child').on(t.childId),
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

// Rarity catalog for the collectible dragon art in public/dragon_pngs/N.png.
// One row per dragon image id (1..N). Every dragon starts 'common'; a keeper
// reclassifies them from the admin "Dragons" tab. Rows are created lazily on
// first classification — any dragon id with no row is treated as 'common', so
// the table only ever holds non-default overrides (plus anything explicitly
// set back to common). rarity is one of: common, uncommon, rare, very_rare,
// legendary, mythic.
const dragonCatalog = pgTable('dragon_catalog', {
  dragonId: integer('dragon_id').primaryKey(),
  rarity: text('rarity').notNull().default('common'),
}, (t) => ({
  rarityChk: check(
    'dragon_catalog_rarity_check',
    sql`${t.rarity} IN ('common','uncommon','rare','very_rare','legendary','mythic')`,
  ),
}));

// A child's collected dragons. One row per (user, dragon) the kid has hatched
// or otherwise earned; `count` tracks how many of that dragon they've caught
// (duplicates are common since games hand out random dragons). dragonId points
// at the public/dragon_pngs/<dragonId>.png art and joins to dragon_catalog for
// rarity.
const userDragons = pgTable('user_dragons', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  dragonId: integer('dragon_id').notNull(),
  count: integer('count').notNull().default(1),
  firstAcquiredAt: timestamp('first_acquired_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userDragonUq: uniqueIndex('user_dragons_user_dragon_unique').on(t.userId, t.dragonId),
}));

// One row per finished arcade-game run (Dragon Munchers, etc.). `game` keys the
// leaderboard so a single table serves every mini-game; the top-N query reads
// the best `score` per user for a given `game`. nodeId isn't relevant here —
// these are free-play games, not story nodes.
const gameScores = pgTable('game_scores', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  game: text('game').notNull(),
  score: integer('score').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  // Drives the leaderboard: best scores for one game, highest first.
  gameScoreIdx: index('idx_game_scores_game_score').on(t.game, t.score),
}));

module.exports = {
  users,
  gameScores,
  dragonCatalog,
  userDragons,
  nodeProgress,
  nodeConfig,
  problemAttempts,
  wrongTaps,
  userCompanions,
  playMinutes,
  matches,
  parentChildLinks,
  classrooms,
  classroomMembers,
  tribes,
  tribeMembers,
  parentClaimCodes,
  weeklyReportLog,
  dragonTrialResults,
};
