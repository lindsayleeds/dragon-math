// The trial-ending email is the only warning a parent gets before their card is
// charged, so these tests are mostly about what must never happen to it: it must
// not render "null" or "Invalid Date" at a parent, and it must not lose the
// cancel instruction when Stripe hands us a partial payload.
//
// EMAIL_STUB makes sendEmail log instead of calling Resend; the rendered HTML is
// captured off the returned value's inputs by rendering through the same helpers.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let sendTrialEndingEmail;
let sendPaymentFailedEmail;
let formatChargeDate;
let logSpy;

// Capture the HTML the stub transport prints.
function sentHtml() {
  const call = logSpy.mock.calls.find(args => typeof args[0] === 'string' && args[0].startsWith('<!doctype html>'));
  return call ? call[0] : '';
}

beforeAll(() => {
  process.env.EMAIL_STUB = '1';
  delete process.env.RESEND_API_KEY;
  process.env.APP_PUBLIC_URL = 'https://example.test';
  ({ sendTrialEndingEmail, sendPaymentFailedEmail, formatChargeDate } = require('./billingEmails.js'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => logSpy.mockRestore());

describe('formatChargeDate', () => {
  it('renders a date a parent can read', () => {
    expect(formatChargeDate(new Date('2026-08-17T12:00:00Z'))).toMatch(/August 1[67], 2026/);
  });

  it('returns null for missing or invalid input', () => {
    // The callers drop the clause on null. If this returned a string, the email
    // would say "on Invalid Date".
    expect(formatChargeDate(null)).toBeNull();
    expect(formatChargeDate(new Date('nonsense'))).toBeNull();
    expect(formatChargeDate('2026-08-17')).toBeNull();
  });
});

describe('sendTrialEndingEmail', () => {
  it('states the amount and the charge date', async () => {
    logSpy.mockClear();
    await sendTrialEndingEmail({
      to: 'parent@example.test',
      plan: 'premium',
      amount: '$7.99',
      interval: 'month',
      endsAt: new Date('2026-08-17T12:00:00Z'),
    });
    const html = sentHtml();
    expect(html).toContain('$7.99');
    expect(html).toMatch(/August 1[67], 2026/);
    expect(html).toContain('Premium');
  });

  it('always tells the parent how to cancel', async () => {
    logSpy.mockClear();
    await sendTrialEndingEmail({ to: 'p@example.test', plan: 'premium', amount: '$7.99', endsAt: new Date() });
    expect(sentHtml()).toMatch(/cancel/i);
  });

  it('degrades without printing null or Invalid Date', async () => {
    // Stripe payloads are not guaranteed to carry a resolvable price or
    // trial_end. A vaguer warning is fine; a broken one is not.
    logSpy.mockClear();
    await sendTrialEndingEmail({ to: 'p@example.test', plan: 'premium', amount: null, endsAt: null });
    const html = sentHtml();
    expect(html).not.toContain('null');
    expect(html).not.toContain('Invalid Date');
    expect(html).toMatch(/when the trial ends/i);
    expect(html).toMatch(/cancel/i);
  });
});

describe('sendPaymentFailedEmail', () => {
  it('states the amount and the retry date', async () => {
    logSpy.mockClear();
    await sendPaymentFailedEmail({
      to: 'p@example.test',
      amount: '$7.99',
      nextAttemptAt: new Date('2026-08-20T12:00:00Z'),
    });
    const html = sentHtml();
    expect(html).toContain('$7.99');
    expect(html).toMatch(/August (19|20), 2026/);
  });

  it('reassures that access continues, since it deliberately does', async () => {
    // The webhook leaves past_due access intact on purpose; the email must not
    // imply the children have been locked out.
    logSpy.mockClear();
    await sendPaymentFailedEmail({ to: 'p@example.test', amount: '$7.99', nextAttemptAt: null });
    expect(sentHtml()).toMatch(/still have full access/i);
  });

  it('degrades without printing null or Invalid Date', async () => {
    logSpy.mockClear();
    await sendPaymentFailedEmail({ to: 'p@example.test', amount: null, nextAttemptAt: null });
    const html = sentHtml();
    expect(html).not.toContain('null');
    expect(html).not.toContain('Invalid Date');
  });
});
