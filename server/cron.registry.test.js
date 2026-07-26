// Boot-level counterpart to lib/cronSchedule.test.js.
//
// That file covers the decision; this covers the wiring, against node-cron's
// own registry: with ENABLE_CRON=0 the deployment's claim is "no scheduled job
// is registered at boot", and the only way to show it is to call start() and
// find nothing scheduled. A regression that reconnected cron.js to a bare
// truthiness check would pass the pure tests and fail here.

// server/db.js (reached through weeklyReport/orphanCleanup) throws without a
// connection string. Nothing in these tests connects — the pg pool is lazy.
process.env.DATABASE_URL ||= 'postgresql://unused:unused@127.0.0.1:1/unused';

const nodeCron = require('node-cron');
const cron = require('./cron');

// start() hands back the tasks it made, but the assertion deliberately reads
// node-cron's process-wide registry instead: that is what actually holds a
// timer, whatever the return value says.
function registeredDuring(env) {
  const before = new Set(nodeCron.getTasks().keys());
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const status = cron.start();
    const added = [...nodeCron.getTasks()].filter(([id]) => !before.has(id)).map(([, t]) => t);
    return { status, added };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('cron.start() — what is actually registered at boot', () => {
  const created = [];
  afterEach(() => {
    // Leave no armed timer behind, or the next test (and the vitest process)
    // inherits it.
    while (created.length) created.pop().destroy();
  });

  it('registers NOTHING with ENABLE_CRON=0 under NODE_ENV=production', () => {
    const { status, added } = registeredDuring({ ENABLE_CRON: '0', NODE_ENV: 'production' });
    created.push(...added);
    expect(added).toHaveLength(0);
    expect(status.enabled).toBe(false);
    expect(status.reason).toMatch(/explicitly off/);
  });

  it('registers the weekly digest and the orphan sweep with ENABLE_CRON=1', () => {
    const { status, added } = registeredDuring({ ENABLE_CRON: '1', NODE_ENV: 'production' });
    created.push(...added);
    expect(added).toHaveLength(2);
    expect(status.enabled).toBe(true);
  });

  it('registers nothing on a pm2 cluster worker other than instance 0', () => {
    const { status, added } = registeredDuring({
      ENABLE_CRON: '1', NODE_ENV: 'production', NODE_APP_INSTANCE: '1',
    });
    created.push(...added);
    expect(added).toHaveLength(0);
    expect(status.reason).toMatch(/instance 0 only/);
  });
});
