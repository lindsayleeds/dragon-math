import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isPrivateRelayEmail, progressEmailRecipient } = require('./contactEmail.js');

const RELAY = 'abc123@privaterelay.appleid.com';

describe('progressEmailRecipient', () => {
  it('uses a verified contact email', () => {
    expect(progressEmailRecipient({
      email: RELAY, email_verified: false, contact_email: 'a@example.test', contact_email_verified: true,
    })).toBe('a@example.test');
  });

  it('falls back to a verified, non-relay login email', () => {
    expect(progressEmailRecipient({
      email: 'login@example.test', email_verified: true, contact_email: 'b@example.test', contact_email_verified: false,
    })).toBe('login@example.test');
  });

  it('returns null when nothing verified and real is on file', () => {
    expect(progressEmailRecipient({ email: RELAY, email_verified: true, contact_email: null, contact_email_verified: false })).toBeNull();
    expect(progressEmailRecipient({ email: 'x@example.test', email_verified: false, contact_email: null })).toBeNull();
    expect(progressEmailRecipient({ email: null, email_verified: false, contact_email: 'c@example.test', contact_email_verified: false })).toBeNull();
    expect(progressEmailRecipient(null)).toBeNull();
  });

  it('never returns a relay contact email, even one marked verified', () => {
    expect(progressEmailRecipient({ email: null, email_verified: false, contact_email: RELAY, contact_email_verified: true })).toBeNull();
  });
});

describe('isPrivateRelayEmail', () => {
  it('spots relay addresses in any case', () => {
    expect(isPrivateRelayEmail(RELAY)).toBe(true);
    expect(isPrivateRelayEmail('X@PrivateRelay.AppleID.com')).toBe(true);
    expect(isPrivateRelayEmail('someone@appleid.com')).toBe(false);
    expect(isPrivateRelayEmail(null)).toBe(false);
  });
});
