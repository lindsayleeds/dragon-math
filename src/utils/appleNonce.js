// A fresh nonce for one Sign in with Apple attempt (docs/adr/0007).
//
// Apple gets the SHA-256 of the raw value as lowercase hex, and signs it into
// the identity token's `nonce` claim. The raw value never leaves this page
// until it goes to POST /api/auth/apple, which hashes it again and checks the
// claim (server/lib/appleIdentity.js) — so a token lifted from somewhere else
// is useless without the raw nonce that went with it. iOS does the same.
export async function createAppleNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = toHex(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return { raw, hashed: toHex(new Uint8Array(digest)) };
}

function toHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
