const cron = require('node-cron');
const { runWeeklyReports } = require('./lib/weeklyReport');
const { runOrphanCleanup } = require('./lib/orphanCleanup');
const { cronDecision } = require('./lib/cronSchedule');

// Mondays at 13:00 UTC ≈ early Monday morning in US Pacific time. Cron jobs
// are opt-in via ENABLE_CRON so local dev / tests don't fire them. The
// opt-in/opt-out and pm2-cluster rules live in lib/cronSchedule.js so they can
// be tested without arming real timers.
function start() {
  const decision = cronDecision(process.env);
  if (!decision.enabled) {
    return { enabled: false, reason: decision.reason };
  }
  const weekly = cron.schedule('0 13 * * 1', async () => {
    try {
      const result = await runWeeklyReports(new Date());
      console.log('[cron] weekly reports', result);
    } catch (err) {
      console.error('[cron] weekly reports failed', err);
    }
  });
  // Daily at 09:00 UTC: sweep children orphaned past the 30-day grace period.
  const orphans = cron.schedule('0 9 * * *', async () => {
    try {
      const result = await runOrphanCleanup(new Date());
      if (result.deleted > 0) console.log('[cron] orphan cleanup', result);
    } catch (err) {
      console.error('[cron] orphan cleanup failed', err);
    }
  });
  return { enabled: true, task: weekly, tasks: { weekly, orphans } };
}

module.exports = { start };
