# Sign in with Apple

Parents sign in with Apple on iOS (the only option there, [ADR 0007](adr/0007-ios-sign-in-with-apple-only.md))
and on the web parent sign-in at `/parent/auth` ("Continue with Apple", next to
Google). Both send Apple's identity token to `POST /api/auth/apple`, which keys
the parent on Apple's `sub`, so a parent who signs up on the web with Apple
signs into the same account on iOS, and the other way round.

## How the web flow works

[`AppleSignInButton`](../src/components/auth/AppleSignInButton.jsx) loads
Sign in with Apple JS from `appleid.cdn-apple.com` and uses popup mode:

1. Before the click, it makes a random raw nonce
   ([`src/utils/appleNonce.js`](../src/utils/appleNonce.js)) and calls
   `AppleID.auth.init()` with the Services ID, the redirect URI, a random
   `state` and the nonce's SHA-256 as lowercase hex.
2. On click, `AppleID.auth.signIn()` opens Apple's popup. It has to be called
   synchronously in the click, or the browser blocks the popup. That is why
   the nonce is prepared first.
3. Apple returns an `id_token`. The page checks that `state` matches and posts
   `{ identity_token, nonce: <raw> }` to `/api/auth/apple`. The server checks
   the token's signature, `iss`, `aud` (must be in `APPLE_CLIENT_IDS`) and
   that its `nonce` claim is `sha256(raw)`.
4. The session is stored the same way as a Google or password sign-in.

A fresh nonce is prepared after every attempt. If the parent closes the
popup, nothing is shown.

## Configuration

| Variable | Read by | Value |
| --- | --- | --- |
| `APPLE_CLIENT_IDS` | server, at runtime | Comma-separated: the iOS bundle id **and** the web Services ID |
| `VITE_APPLE_SERVICES_ID` | frontend, at build time | The web Services ID |
| `VITE_APPLE_REDIRECT_URI` | frontend, at build time | A Return URL registered on the Services ID, e.g. `https://<domain>/parent/auth` |

If either `VITE_` variable is empty, the button isn't rendered and Apple's
script isn't loaded, so nothing changes before the Apple setup is done. The
`VITE_` values are public, like the Google client ID, and are baked into the
bundle. Rebuild after changing them. For Cloud Run builds, pass them as
`_VITE_APPLE_SERVICES_ID` / `_VITE_APPLE_REDIRECT_URI` substitutions (see
[deploy/gcp/README.md](../deploy/gcp/README.md)). No Apple private key or
client secret is needed, because the server only verifies identity tokens
against Apple's public keys and never exchanges an authorization code.

## Apple Developer setup (a human must do this)

Everything is in [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)
on the **same team as the iOS app**. Apple's `sub` is per team. A Services ID
on another team would give the same person a different `sub`, and web and iOS
would create two separate accounts.

1. **Primary App ID.** Open the iOS app's App ID (its bundle id) and confirm
   the **Sign in with Apple** capability is enabled, as "Enable as a primary
   App ID".
2. **Create the Services ID.** Identifiers → **+** → **Services IDs** →
   Continue. Give it a description (users see it on Apple's consent screen, so
   use "My Dragon Math") and an identifier such as
   `<bundle id>.web`. Register it. This identifier is the Services ID.
3. **Configure it.** Open the Services ID, tick **Sign in with Apple**, and
   click **Configure**:
   - **Primary App ID:** the iOS app's App ID. This groups the web and the app
     under one consent, so the parent sees one app and gets the same `sub`.
   - **Domains and Subdomains:** each web host with no scheme or path, e.g. the
     production domain and the test domain.
   - **Return URLs:** `https://<host>/parent/auth` for each host. These must be
     `https` and must match `VITE_APPLE_REDIRECT_URI` exactly. Apple doesn't
     accept `localhost` or IP addresses, so try it on the test deployment.
   - Click Next → Done → Continue → **Save**.
4. **Domain verification (only if the portal asks).** Older Services ID
   configurations make you download `apple-developer-domain-association.txt`
   and serve it at
   `https://<host>/.well-known/apple-developer-domain-association.txt` before
   clicking **Verify**. If it asks:
   - Put the file in `public/.well-known/`.
   - nginx (`try_files`) serves it from `dist/`.
   - `express.static` in `server/index.js` ignores dot-directories by default,
     so on Cloud Run that path needs a route or `dotfiles: 'allow'` first. The
     `apple-app-site-association` file for universal links has the same
     problem.
5. **Private relay email.** Parents who choose "Hide My Email" get a
   `@privaterelay.appleid.com` address. To reach them, register the sending
   domain under Services → **Sign in with Apple for Email Communication**.
   This is already on the iOS plan and is shared with the app.
6. **Set the variables.**
   - On the server: add the Services ID to `APPLE_CLIENT_IDS`, e.g.
     `APPLE_CLIENT_IDS=<bundle id>,<services id>`.
   - Build the frontend with `VITE_APPLE_SERVICES_ID` and
     `VITE_APPLE_REDIRECT_URI`, then deploy.
7. **Check it.**
   - On the test host, sign up with "Continue with Apple".
   - Sign into the iOS app with the same Apple ID and confirm it's the same
     account (same children).
   - If the web sign-in returns 401 "Could not verify Apple sign-in.", the
     Services ID is probably missing from `APPLE_CLIENT_IDS`.

## Account rules

These are the same for web and iOS. See `POST /api/auth/apple` in
`server/routes/auth.js`.

- A returning parent is found by `apple_sub`.
- Otherwise, Apple is attached to an existing grown-up account with the same
  email. This only happens when Apple's email is real (not relay) and
  Apple-verified, and the existing account's own email is verified. So a
  parent who signed up on the web with email or Google can later use Apple on
  either platform.
- Otherwise, a new parent is created. A relay address is stored only as the
  login email and never becomes a verified contact email.
- Apple-only accounts have no password. The password-change and email-change
  errors say so and name Apple.
