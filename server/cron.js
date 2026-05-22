const cron = require('node-cron');
const { runWeeklyReports } = require('./lib/weeklyReport');

// Mondays at 13:00 UTC ≈ early Monday morning in US Pacific time. Cron job
// is opt-in via ENABLE_CRON so local dev / tests don't fire it.
function start() {
  if (!process.env.ENABLE_CRON && process.env.NODE_ENV !== 'production') {
    return { enabled: false, reason: 'ENABLE_CRON not set (and NODE_ENV != production)' };
  }
  const task = cron.schedule('0 13 * * 1', async () => {
    try {
      const result = await runWeeklyReports(new Date());
      console.log('[cron] weekly reports', result);
    } catch (err) {
      console.error('[cron] weekly reports failed', err);
    }
  });
  return { enabled: true, task };
}

module.exports = { start };
