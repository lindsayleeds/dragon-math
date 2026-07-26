// describe/it/expect come from vitest globals — these files are CommonJS
// (server/package.json pins "type": "commonjs"), see vitest.config.js.
const { cronDecision, envFlag } = require('./cronSchedule');

describe('envFlag', () => {
  it('treats unset and empty as "no opinion"', () => {
    expect(envFlag(undefined)).toBeUndefined();
    expect(envFlag(null)).toBeUndefined();
    expect(envFlag('')).toBeUndefined();
    expect(envFlag('   ')).toBeUndefined();
  });

  it('reads the off-spellings as false, not as truthy strings', () => {
    for (const v of ['0', 'false', 'FALSE', 'no', 'off', ' 0 ']) {
      expect(envFlag(v), `${JSON.stringify(v)} should be false`).toBe(false);
    }
  });

  it('reads on-spellings as true', () => {
    for (const v of ['1', 'true', 'yes', 'on']) {
      expect(envFlag(v), `${JSON.stringify(v)} should be true`).toBe(true);
    }
  });
});

describe('cronDecision', () => {
  it('ENABLE_CRON=0 disables cron even under NODE_ENV=production', () => {
    // The regression this module exists for: '0' is truthy in JS, so the old
    // `!process.env.ENABLE_CRON` check armed the weekly digest on a test box.
    const d = cronDecision({ ENABLE_CRON: '0', NODE_ENV: 'production' });
    expect(d.enabled).toBe(false);
    expect(d.reason).toMatch(/explicitly off/);
  });

  it('ENABLE_CRON=0 disables cron with NODE_ENV unset', () => {
    expect(cronDecision({ ENABLE_CRON: '0' }).enabled).toBe(false);
  });

  it('production with ENABLE_CRON=1 stays enabled (current prod behaviour)', () => {
    expect(cronDecision({ ENABLE_CRON: '1', NODE_ENV: 'production' })).toMatchObject({ enabled: true });
  });

  it('NODE_ENV=production alone still enables cron when ENABLE_CRON is unset', () => {
    expect(cronDecision({ NODE_ENV: 'production' }).enabled).toBe(true);
  });

  it('is off by default outside production', () => {
    const d = cronDecision({});
    expect(d.enabled).toBe(false);
    expect(d.reason).toMatch(/not set/);
  });

  it('only cluster instance 0 schedules jobs', () => {
    const base = { ENABLE_CRON: '1' };
    expect(cronDecision({ ...base, NODE_APP_INSTANCE: '0' }).enabled).toBe(true);
    expect(cronDecision({ ...base, NODE_APP_INSTANCE: '1' }).enabled).toBe(false);
    expect(cronDecision({ ...base, NODE_APP_INSTANCE: '3' }).reason).toMatch(/instance 0 only/);
  });

  it('fork mode (no NODE_APP_INSTANCE) is unaffected by the cluster guard', () => {
    expect(cronDecision({ ENABLE_CRON: '1' }).enabled).toBe(true);
    expect(cronDecision({ ENABLE_CRON: '1', NODE_APP_INSTANCE: '' }).enabled).toBe(true);
  });

  it('an explicit off beats the cluster guard and reports the off reason', () => {
    expect(cronDecision({ ENABLE_CRON: '0', NODE_APP_INSTANCE: '0' }).reason).toMatch(/explicitly off/);
  });
});
