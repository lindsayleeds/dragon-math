// Whether this process should register the scheduled jobs (weekly parent
// digest, orphan cleanup). Pure so it can be unit-tested without node-cron
// arming real timers — see cronSchedule.test.js.

// ENABLE_CRON has to be read as a *boolean*, not for truthiness. `'0'` is a
// non-empty string and therefore truthy in JS, so a bare `!process.env.X`
// check treats ENABLE_CRON=0 as "enabled" — the exact opposite of what an
// operator setting it to 0 intends. That misreading would arm the weekly
// digest on a staging box and mail real customers.
function envFlag(raw) {
  if (raw === undefined || raw === null) return undefined;
  const v = String(raw).trim();
  if (v === '') return undefined;
  return !/^(0|false|no|off)$/i.test(v);
}

// Reasons are returned rather than logged so the caller owns output and tests
// can assert on them.
function cronDecision(env = process.env) {
  const flag = envFlag(env.ENABLE_CRON);

  // An explicit ENABLE_CRON always wins over NODE_ENV. Production-parity
  // deployments (staging/test) run with NODE_ENV=production but must be able
  // to guarantee nothing is scheduled; ENABLE_CRON=0 is that guarantee.
  const wanted = flag !== undefined ? flag : env.NODE_ENV === 'production';
  if (!wanted) {
    return {
      enabled: false,
      reason: flag === false
        ? 'ENABLE_CRON is explicitly off'
        : 'ENABLE_CRON not set (and NODE_ENV != production)',
    };
  }

  // Under pm2 cluster mode every instance loads this file, so without a guard
  // an N-instance deployment would send each weekly digest N times and run the
  // orphan sweep N times concurrently. pm2 sets NODE_APP_INSTANCE per worker;
  // only the first one schedules. It is unset in fork mode, which then behaves
  // exactly as before.
  const instance = env.NODE_APP_INSTANCE;
  if (instance !== undefined && String(instance).trim() !== '' && String(instance).trim() !== '0') {
    return {
      enabled: false,
      reason: `cluster instance ${instance} — scheduled jobs run on instance 0 only`,
    };
  }

  return { enabled: true, reason: 'enabled' };
}

module.exports = { cronDecision, envFlag };
