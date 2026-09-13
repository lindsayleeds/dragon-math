// server/lib/apiKeys.js is pure, so these need no database, no Express and no
// mocking — the reason the token rules live there rather than in the middleware.
//
// What is worth pinning here is the stuff that is silently catastrophic if it
// drifts: that a token is actually random and actually hashed, and that the
// header reader cannot confuse a session with a key in either direction.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const crypto = require('crypto');
const {
  TOKEN_PREFIX,
  SECRET_BYTES,
  generateToken,
  hashToken,
  displayPrefix,
  extractPresentedKey,
  isWellFormed,
  validateName,
} = require('./apiKeys');

describe('token generation', () => {
  it('mints a namespaced token of the full declared width', () => {
    const { token } = generateToken();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token.slice(TOKEN_PREFIX.length)).toHaveLength(SECRET_BYTES * 2);
    expect(isWellFormed(token)).toBe(true);
  });

  it('never repeats a token', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken().token));
    expect(seen.size).toBe(200);
  });

  // The single most important property in this file: if the row ever held the
  // plaintext, a database leak would be a full account takeover for every key.
  it('stores a hash, not the token', () => {
    const { token, tokenHash } = generateToken();
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(hashToken(token)).toBe(tokenHash);
  });

  it('derives the displayed prefix from the token, and it is not enough to reconstruct it', () => {
    const { token, prefix } = generateToken();
    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(token.length / 4);
  });
});

describe('isWellFormed', () => {
  it('rejects the near misses', () => {
    const good = generateToken().token;
    expect(isWellFormed(good)).toBe(true);
    expect(isWellFormed(good.slice(0, -1))).toBe(false);          // truncated
    expect(isWellFormed(`${good}0`)).toBe(false);                 // overlong
    expect(isWellFormed(good.replace('dmk_', 'dmx_'))).toBe(false); // wrong namespace
    expect(isWellFormed(good.toUpperCase())).toBe(false);         // hex is lower-case
    expect(isWellFormed('')).toBe(false);
    expect(isWellFormed(null)).toBe(false);
  });
});

describe('extractPresentedKey', () => {
  const token = generateToken().token;

  it('reads X-API-Key', () => {
    expect(extractPresentedKey({ 'x-api-key': token })).toBe(token);
    expect(extractPresentedKey({ 'x-api-key': `  ${token}  ` })).toBe(token);
  });

  it('reads a Bearer key', () => {
    expect(extractPresentedKey({ authorization: `Bearer ${token}` })).toBe(token);
  });

  // Both directions matter. A session that came back as a key would 401 every
  // browser request; a key that came back as null would fall through to the JWT
  // path and 401 every script — with a message about the wrong credential.
  it('does not mistake a session for a key', () => {
    const jwtish = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.c2ln';
    expect(extractPresentedKey({ authorization: `Bearer ${jwtish}` })).toBeNull();
  });

  it('returns null when no credential is offered', () => {
    expect(extractPresentedKey({})).toBeNull();
    expect(extractPresentedKey({ authorization: '' })).toBeNull();
    expect(extractPresentedKey({ 'x-api-key': '   ' })).toBeNull();
  });

  // A typo'd key must reach the key path so the caller is told the key is bad,
  // rather than the session path's "missing Authorization header".
  it('surfaces a malformed X-API-Key rather than falling through', () => {
    expect(extractPresentedKey({ 'x-api-key': 'nonsense' })).toBe('nonsense');
  });

  it('prefers X-API-Key when both headers are present', () => {
    const other = generateToken().token;
    expect(extractPresentedKey({ 'x-api-key': token, authorization: `Bearer ${other}` })).toBe(token);
  });
});

describe('validateName', () => {
  it('accepts and tidies an ordinary name', () => {
    expect(validateName('  Weekly   import  ')).toEqual({ ok: true, name: 'Weekly import' });
  });

  it('strips control characters that would break the dashboard', () => {
    expect(validateName('seed\u0000script\u001b')).toEqual({ ok: true, name: 'seed script' });
    expect(validateName('a\nb\tc')).toEqual({ ok: true, name: 'a b c' });
  });

  it('rejects empty, whitespace-only, non-string and overlong names', () => {
    expect(validateName('').ok).toBe(false);
    expect(validateName('   ').ok).toBe(false);
    expect(validateName(undefined).ok).toBe(false);
    expect(validateName(42).ok).toBe(false);
    expect(validateName('x'.repeat(61)).ok).toBe(false);
    expect(validateName('x'.repeat(60)).ok).toBe(true);
  });
});

describe('displayPrefix', () => {
  it('is stable for the same token', () => {
    const { token, prefix } = generateToken();
    expect(displayPrefix(token)).toBe(prefix);
  });
});
