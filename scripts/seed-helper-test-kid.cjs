// One-off test seed: a kid account that owns all six companions so the dragon
// helpers (Bond Powers) can be exercised end-to-end in Playwright.
//
// Creates/updates user `helpertest` with a fixed login token, marks every boss
// node complete (8/16/25/33/41), and grants all six companions. Prints the
// passwordless login URL (/k/<token>). Idempotent — safe to re-run.
const { db, schema } = require('../server/db');
const { eq } = require('drizzle-orm');

const USERNAME = 'helpertest';
const TOKEN = 'helper-test-token-0001';
const BOSS_NODES = [8, 16, 25, 33, 41];
const COMPANIONS = ['pip', 'forest_dragon', 'sunfire_dragon', 'crystal_dragon', 'sakura_dragon', 'storm_dragon'];

(async () => {
  let [user] = await db.select().from(schema.users).where(eq(schema.users.username, USERNAME)).limit(1);

  if (!user) {
    [user] = await db.insert(schema.users).values({
      username: USERNAME,
      avatar: '🦕',
      loginToken: TOKEN,
      activeCompanionId: 'pip',
    }).returning();
    console.log('Created user', user.id);
  } else {
    await db.update(schema.users)
      .set({ loginToken: TOKEN, activeCompanionId: 'pip' })
      .where(eq(schema.users.id, user.id));
    console.log('Updated user', user.id);
  }

  const userId = user.id;

  for (const nodeId of BOSS_NODES) {
    await db.insert(schema.nodeProgress)
      .values({ userId, nodeId, completed: true, completedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.nodeProgress.userId, schema.nodeProgress.nodeId],
        set: { completed: true },
      });
  }
  console.log('Marked boss nodes complete:', BOSS_NODES.join(', '));

  for (const companionId of COMPANIONS) {
    await db.insert(schema.userCompanions)
      .values({ userId, companionId })
      .onConflictDoNothing();
  }
  console.log('Granted companions:', COMPANIONS.join(', '));

  console.log('\nLogin URL: https://mydragonmath.com/k/' + TOKEN);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
