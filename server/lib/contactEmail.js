// Where mail about a family goes (ADR 0007). A parent's LOGIN email and their
// CONTACT email are separate columns because Sign in with Apple may hand us a
// private relay address as the login email; the contact email is the one the
// parent chose and proved they read, through the /parent/verify link.
//
// Every sender of progress digests or COPPA notices asks progressEmailRecipient()
// for the address and sends nothing when it returns null. Reading users.email
// directly would mail unverified addresses and relay addresses the parent never
// chose — which is exactly what the weekly digest did before this module.

const PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com';

function isPrivateRelayEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${PRIVATE_RELAY_DOMAIN}`);
}

// The address digests and COPPA notices go to, or null for "send nothing":
//   1. the contact email, once it is verified;
//   2. otherwise the login email, if it is verified and not a relay address
//      (web parents who never set a separate contact email);
//   3. otherwise nothing.
// `user` carries the snake_case columns email, email_verified, contact_email,
// contact_email_verified (the userColumns() alias map in routes/auth.js).
function progressEmailRecipient(user) {
  if (!user) return null;
  if (user.contact_email && user.contact_email_verified && !isPrivateRelayEmail(user.contact_email)) {
    return user.contact_email;
  }
  if (user.email && user.email_verified && !isPrivateRelayEmail(user.email)) {
    return user.email;
  }
  return null;
}

module.exports = {
  PRIVATE_RELAY_DOMAIN,
  isPrivateRelayEmail,
  progressEmailRecipient,
};
