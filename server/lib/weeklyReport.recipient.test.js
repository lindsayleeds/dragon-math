// The weekly digest goes ONLY to a verified contact email, falling back to the
// login email when that is verified and not an Apple private relay address, and
// is skipped otherwise (ADR 0007, server/lib/contactEmail.js). It used to send
// to users.email whatever its state.
//
// Same wiring as weeklyReport.window.test.js: weeklyReport.js is CommonJS and
// destructures its dependencies at require time, so `Module._load` swaps
// ./analytics, ./email and ./entitlements, and the db object's methods are
// replaced with recording fakes. Nothing here touches a database or sends mail.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

function makeFakeDb() {
  const state = { results: [], inserts: [] };
  const builder = {
    from() { return builder; },
    innerJoin() { return builder; },
    where() { return builder; },
    orderBy() { return builder; },
    limit() { return builder; },
    then(onOk, onErr) {
      return Promise.resolve(state.results.shift() ?? []).then(onOk, onErr);
    },
  };
  const db = {
    select() { return builder; },
    insert() {
      return { values(row) { state.inserts.push(row); return Promise.resolve(); } };
    },
  };
  return { db, state };
}

let runWeeklyReports;
let fake;
let sentEmails;
let originalLoad;

const NOW = new Date(2026, 7, 3, 13, 0, 0);

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.APP_PUBLIC_URL = 'https://example.test';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === './analytics') {
      return {
        buildAnalytics: userId => Promise.resolve({
          user: { id: userId, username: 'kid', avatar: null },
          summary: { total: 4, child_wins: 3, avg_child_ms: 2500 },
          byOperator: [],
          playtime: { minutes_in_window: 12, by_day: [], minutes_today: null },
        }),
      };
    }
    if (request === './email') {
      return { sendEmail: (msg) => { sentEmails.push(msg); return Promise.resolve({ id: 'e1' }); } };
    }
    if (request === './entitlements') {
      const real = originalLoad.call(this, request, parent, isMain);
      // Every parent here is premium; the plan resolver has its own tests.
      return {
        ...real,
        planStatusForAdults: async ids => new Map(ids.map(id => [id, { plan: 'premium' }])),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  fake = makeFakeDb();
  const dbModule = require('../db.js');
  dbModule.db.select = fake.db.select;
  dbModule.db.insert = fake.db.insert;

  ({ runWeeklyReports } = require('./weeklyReport.js'));
});

afterAll(() => {
  if (originalLoad) Module._load = originalLoad;
});

beforeEach(() => {
  sentEmails = [];
  fake.state.inserts = [];
});

// One opted-in parent with one child, so a digest is due.
async function digestFor(parentRow) {
  fake.state.results = [
    [{ id: 1, ...parentRow }],                   // opted-in parents
    [],                                          // no log row for this period
    [{ id: 77, username: 'kid', avatar: null }], // one child
  ];
  return runWeeklyReports(NOW);
}

const RELAY = 'x7q2@privaterelay.appleid.com';

describe('weekly digest recipient', () => {
  it('goes to the verified contact email, not the login email', async () => {
    const { results } = await digestFor({
      email: RELAY, email_verified: false, contact_email: 'mum@example.test', contact_email_verified: true,
    });
    expect(sentEmails.map(e => e.to)).toEqual(['mum@example.test']);
    expect(results).toEqual([{ parent_id: 1, status: 'sent' }]);
  });

  it('prefers a verified contact email over a verified login email', async () => {
    await digestFor({
      email: 'login@example.test', email_verified: true, contact_email: 'home@example.test', contact_email_verified: true,
    });
    expect(sentEmails.map(e => e.to)).toEqual(['home@example.test']);
  });

  it('falls back to a verified, real login email while the contact email is unverified', async () => {
    await digestFor({
      email: 'login@example.test', email_verified: true, contact_email: 'new@example.test', contact_email_verified: false,
    });
    expect(sentEmails.map(e => e.to)).toEqual(['login@example.test']);
  });

  it('skips a parent with an unverified contact email and a relay login email', async () => {
    const { results } = await digestFor({
      email: RELAY, email_verified: false, contact_email: 'new@example.test', contact_email_verified: false,
    });
    expect(sentEmails).toEqual([]);
    expect(results).toEqual([{ parent_id: 1, status: 'skipped_no_verified_email' }]);
    // No log row, so a later run in the same week reaches them once verified.
    expect(fake.state.inserts).toEqual([]);
  });

  it('never sends to a relay login email, even one marked verified', async () => {
    await digestFor({ email: RELAY, email_verified: true, contact_email: null, contact_email_verified: false });
    expect(sentEmails).toEqual([]);
  });

  it('skips an unverified login email with no contact email', async () => {
    await digestFor({ email: 'login@example.test', email_verified: false, contact_email: null, contact_email_verified: false });
    expect(sentEmails).toEqual([]);
  });

  it('skips an Apple account that shared no email and set no contact email', async () => {
    await digestFor({ email: null, email_verified: false, contact_email: null, contact_email_verified: false });
    expect(sentEmails).toEqual([]);
  });
});
