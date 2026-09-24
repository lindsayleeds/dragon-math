# iOS parents sign in only with Apple, and their contact email is stored separately

On iOS, parents sign in only with Sign in with Apple. Offering Google or email sign-in in the app would require Sign in with Apple anyway (guideline 4.8), and there were no existing users to migrate. Apple may give us a private relay address, so a parent's login identity is kept separate from a verified **contact email** that receives digests and COPPA notices. Parents set the contact email after first sign-in and verify it through the existing `/parent/verify` flow. Our email-sending domain is registered with Apple so relay addresses still receive mail.

## Consequences

- The web app should also offer Sign in with Apple. Otherwise a parent who signs up on the web with Google or email can't sign in on iOS.
- Accounts created in the app must be deletable in the app (guideline 5.1.1(v)).
- Kids sign in with the family picker (after a parent signs in) or with QR codes and `/k/:token` universal links, never with Apple ID. The parent view is protected by a parental gate plus Face ID, Touch ID or the device passcode.
