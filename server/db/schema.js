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
  // Monetization tier for adult accounts: 'free' | 'premium' | 'classroom'.
  // Kids don't hold a plan — their access is derived from their guardian(s)
  // (see server/lib/entitlements.js). Phase 2 will add Stripe columns here
  // (stripe_customer_id, stripe_subscription_id, plan_status, plan_renews_at).
  plan: text('plan').notNull().default('free'),
  planUpdatedAt: timestamp('plan_updated_at', { withTimezone: true }),
  // Stripe billing (Phase 2). Stripe is the source of truth for subscription
  // state; these are a write-through cache updated by the billing webhook.
  // NULL for accounts that have never opened checkout.
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  planStatus: text('plan_status'), // 'active'|'trialing'|'past_due'|'canceled'|null
  planRenewsAt: timestamp('plan_renews_at', { withTimezone: true }),
  // TRUE once a paid subscription is set to cancel at the end of the current
  // period: the plan stays active (and planRenewsAt holds the end date) until
  // then, but it won't renew. Lets the dashboard show "active until <date>"
  // instead of "renews <date>". Reset to false on resubscribe / new sub.
  planCancelAtPeriodEnd: boolean('plan_cancel_at_period_end').notNull().default(false),
  // TRUE for a comped ("lifetime free") account: the `plan` above is a permanent
  // hand-grant (see /api/admin/users/:id/comp and comp_invites). Stripe webhooks
  // must NOT downgrade a comped user (server/routes/billing.js guards on this),
  // and planStatus is set to 'comped' for display. Independent of Stripe state.
  comped: boolean('comped').notNull().default(false),
  activeCompanionId: text('active_companion_id'),
  dragonTrialCompleted: boolean('dragon_trial_completed').notNull().default(false),
  // TRUE for parent/child accounts created by an automated agent (e.g. Claude
  // during testing) rather than a real human. Lets those throwaway accounts be
  // found and cleaned up later: DELETE FROM users WHERE created_by_agent. Always
  // false for real signups.
  createdByAgent: boolean('created_by_agent').notNull().default(false),
  // Permanent, password-equivalent "login by URL" secret for kids whose parent
  // created their account. The child visits /k/<login_token> to sign in — no
  // password. NULL for parents and for kids who self-signed-up by username.
  loginToken: text('login_token'),
  // True between parent-creation and the moment the kid picks their own handle.
  needsHandle: boolean('needs_handle').notNull().default(false),
  // A child's real/legal name, for the roster views adults (teachers, school
  // admins, linked parents) see. Distinct from `username`, which is the public
  // handle every kid sees on rosters/leaderboards. NULL until an adult sets it.
  // NEVER exposed to other kids — kid-facing queries return `username` only.
  realName: text('real_name'),
  // When a child is left with NO guardian (their last/only parent deleted their
  // account), this is stamped with the moment they were orphaned. The account,
  // its login token and all progress stay fully usable during a 30-day grace
  // period; a daily cron (server/lib/orphanCleanup.js) hard-deletes children
  // whose orphanedAt is older than 30 days. Cleared back to NULL the instant the
  // kid gains a guardian again (re-link). NULL = has a guardian / not orphaned.
  orphanedAt: timestamp('orphaned_at', { withTimezone: true }),
}, (t) => ({
  emailIdx:    uniqueIndex('idx_users_email').on(t.email).where(sql`${t.email} IS NOT NULL`),
  googleIdx:   uniqueIndex('idx_users_google_sub').on(t.googleSub).where(sql`${t.googleSub} IS NOT NULL`),
  loginTokenIdx: uniqueIndex('idx_users_login_token').on(t.loginToken).where(sql`${t.loginToken} IS NOT NULL`),
  stripeCustomerIdx: uniqueIndex('idx_users_stripe_customer').on(t.stripeCustomerId).where(sql`${t.stripeCustomerId} IS NOT NULL`),
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

// A school — the org layer above teachers. Groups a set of teachers (and thus
// their classrooms and students) under one or more admins. Schools are minted
// by the site super-admin (see server/routes/admin.js); teachers attach their
// account by entering `joinCode`, which rolls all their classrooms up to the
// school. Admins get a read view over every student in the school
// (school_teachers -> classrooms -> classroom_members -> child users).
const schools = pgTable('schools', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  joinCode: text('join_code').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// School admins — the "1+ people with admin access" per school. A membership row
// layered on ANY adult account (account_type 'parent'), so the same person can
// be both a school admin and a teacher with their own classrooms. Admin status
// is read from here (never carried in the JWT), same as `plan`.
const schoolAdmins = pgTable('school_admins', {
  schoolId: integer('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
  userId:   integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.schoolId, t.userId] }),
  userIdx: index('idx_school_admins_user').on(t.userId),
}));

// School teachers — one row per teacher attached to a school (via the join code).
// The teacher's classrooms roll up to the school for the admin student view.
const schoolTeachers = pgTable('school_teachers', {
  schoolId: integer('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
  userId:   integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.schoolId, t.userId] }),
  userIdx: index('idx_school_teachers_user').on(t.userId),
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

// Single-use "lifetime free" invitations. An admin mints a row (getting a random
// token), shares /parent?comp=<token>, and the first person to sign up through
// it becomes a comped adult of `role` at `plan` (NULL plan = auto-by-role:
// teacher→classroom, parent→premium). Redeemed once, then inert; revokedAt
// disables it early. See server/routes/admin.js + auth.js.
const compInvites = pgTable('comp_invites', {
  id: serial('id').primaryKey(),
  token: text('token').notNull().unique(),
  role: text('role').notNull().default('parent'), // 'parent' | 'teacher'
  plan: text('plan'), // NULL = auto by role; else 'premium' | 'classroom'
  note: text('note'), // free-text label, e.g. "Ms. Garcia — Room 4"
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  redeemedByUserId: integer('redeemed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// Single-use, time-boxed tokens for password reset and email verification.
// Only the SHA-256 hash of the token is stored — the raw token exists only in
// the email link we send, so a DB leak can't be used to reset passwords or
// verify emails. `kind` distinguishes the two flows; `usedAt` is stamped on
// redemption to enforce single use. See server/routes/auth.js.
const authTokens = pgTable('auth_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'password_reset' | 'email_verify'
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  tokenHashIdx: index('idx_auth_tokens_hash').on(t.tokenHash),
  userKindIdx:  index('idx_auth_tokens_user_kind').on(t.userId, t.kind),
  kindChk:      check('auth_tokens_kind_check', sql`${t.kind} IN ('password_reset', 'email_verify')`),
}));

// Fixed-window counters for the brute-force limiter (server/lib/rateLimit.js).
// This lives in Postgres rather than process memory so every server process
// shares one counter — under pm2 cluster mode an in-memory Map gave each worker
// its own, multiplying every limit by the worker count.
//
// `key` is the caller-supplied bucket id ("login-ip:1.2.3.4"); one row per
// active window, so the primary key is the lookup index. `expires_at` is
// window_start + windowMs, and its index drives the opportunistic sweep of
// dead windows. Rows are pure cache: dropping the table only resets counters.
const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(1),
}, (t) => ({
  expiresAtIdx: index('idx_rate_limits_expires_at').on(t.expiresAt),
}));

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

// Catalog for the collectible dragon art in public/dragon_pngs/N.png. This is
// the source of truth for which dragons exist: one row per dragon id, seeded
// for the original art and extended whenever a keeper uploads a new dragon from
// the admin "Dragons" tab. `name` is the dragon's fun display name (shown to
// kids in their Den); `rarity` is one of common, uncommon, rare, very_rare,
// legendary, mythic; `retired` soft-deletes a dragon — retired dragons stop
// being handed out and drop from the catalog totals, but kids keep any they
// already caught. Dragons earned before this catalog existed may lack a row;
// such ids are treated as common / unnamed / active until classified.
const dragonCatalog = pgTable('dragon_catalog', {
  dragonId: integer('dragon_id').primaryKey(),
  name: text('name'),
  rarity: text('rarity').notNull().default('common'),
  retired: boolean('retired').notNull().default(false),
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
  schools,
  schoolAdmins,
  schoolTeachers,
  tribes,
  tribeMembers,
  parentClaimCodes,
  compInvites,
  authTokens,
  rateLimits,
  weeklyReportLog,
  dragonTrialResults,
};
