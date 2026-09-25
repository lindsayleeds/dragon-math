// POST /api/account/delete — a parent deletes their account and their
// children's data from the iOS app (App Store Review Guideline 5.1.1(v)).
// Contract: server/contracts/account.js. What goes and what stays:
// server/lib/accountDeletion.js and docs/COPPA.md "Account deletion".
//
// The confirmation is a fresh Sign in with Apple: the identity token must carry
// the signed-in parent's apple_sub, so a session token alone (a borrowed,
// unlocked device) can't delete the account. The web's DELETE /api/auth/account
// asks for the password instead; an account with no Apple ID deletes there.
//
// Sessions are stateless JWTs, so "invalidating" them means removing what they
// resolve to: the user row, its parent_child_links, API keys and one-time tokens
// are gone, a deleted child's login link and the family link die with their
// rows, and a leftover token's /api/auth/me answers 404. The app also forgets
// its own copy (Keychain + SessionTokens).
const express = require('express');
const { eq } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth, requireParent } = require('../middleware/auth');
const { parseInput } = require('../lib/parseInput');
const { DeleteAccountRequest } = require('../contracts/account');
const { InvalidAppleTokenError, appleClientIds, verifyAppleIdentityToken } = require('../lib/appleIdentity');
const { revokeAppleAuthorization } = require('../lib/appleRevoke');
const { deleteParentAccount } = require('../lib/accountDeletion');

const router = express.Router();

router.post('/delete', requireAuth, requireParent, async (req, res) => {
  const input = parseInput(DeleteAccountRequest, req.body);
  if (!input.ok) return res.status(400).json({ error: input.error });

  const [user] = await db
    .select({ id: schema.users.id, appleSub: schema.users.appleSub })
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!user.appleSub) {
    return res.status(403).json({
      error: "This account doesn't use Sign in with Apple. Delete it from the parent dashboard on the website.",
    });
  }
  if (appleClientIds().length === 0) {
    return res.status(503).json({ error: 'Sign in with Apple is not configured on this server.' });
  }

  let identity;
  try {
    identity = await verifyAppleIdentityToken(input.data.identity_token, { nonce: input.data.nonce });
  } catch (err) {
    if (err instanceof InvalidAppleTokenError) {
      return res.status(401).json({ error: 'Could not verify Apple sign-in.' });
    }
    console.error('[account] Apple key fetch failed:', err.message);
    return res.status(502).json({ error: "We couldn't reach Apple to check your sign-in. Please try again." });
  }
  if (identity.sub !== user.appleSub) {
    return res.status(401).json({ error: "That Apple Account isn't the one this account signs in with." });
  }

  const result = await db.transaction(tx => deleteParentAccount(tx, user.id));
  if (!result) return res.status(404).json({ error: 'Account not found.' });

  // After the commit: the account is gone whatever Apple says.
  const { revoked } = await revokeAppleAuthorization({
    authorizationCode: input.data.authorization_code,
    clientId: identity.clientId,
  });

  res.json({
    deleted_child_ids: result.deletedChildIds,
    unlinked_child_ids: result.unlinkedChildIds,
    apple_token_revoked: revoked,
  });
});

module.exports = router;
