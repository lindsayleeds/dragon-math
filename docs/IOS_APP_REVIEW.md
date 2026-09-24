# iOS App Review notes (draft)

What goes in App Store Connect for review: the **App Review Information** notes,
the sign-in information, and the answers that go with them. Written ahead of
the first submission (issue #170); much of the app is still being built, so
every section marked **(pending #N)** has to be checked against the app that is
actually submitted. The privacy answers are in
[IOS_PRIVACY_LABEL.md](IOS_PRIVACY_LABEL.md).

## Before submitting (a human)

- [ ] **TODO (human): demo parent account.** Create it and enter it in App Store
      Connect → App Review Information → Sign-in required. **Never commit the
      credentials** — not here, not in a PR, not in a test. See
      [Demo account](#demo-account) for what it needs.
- [ ] TODO (human): contact name, phone and email for the reviewer, in App
      Store Connect only.
- [ ] Replace every **(pending #N)** below with what the build really does, or
      delete it.
- [ ] The app name and bundle id are still placeholders
      (`dev.placeholder.dragonacademy`, [IOS_PLAN.md](IOS_PLAN.md)).
- [ ] Age rating questionnaire answered for **4+**: no user-generated content,
      no chat, no web browsing, no gambling; for Cartoon or Fantasy Violence,
      judge the final art (a "battle" is a math contest with a friendly
      dragon, nobody is hurt). Category **Education**, not the Kids category
      ([ADR 0008](adr/0008-ios-storekit-and-education-category.md)).
- [ ] Privacy label entered from IOS_PRIVACY_LABEL.md; privacy policy URL set
      (`https://mydragonmath.com/privacy`).
- [ ] The subscription products exist in App Store Connect and are attached to
      this version, with their review screenshot.

## Notes for the reviewer

Paste into App Review Information → Notes, after filling in the pending parts.

> **What the app is.** Dragon Academy is a learning game for children aged
> about 5–10: they practise arithmetic by battling friendly dragons on a map,
> collect dragons, and play short math, spelling and phonics games. It is the
> iOS version of our web app, mydragonmath.com. It is listed in Education and
> rated 4+. We follow COPPA practices: children never create accounts or enter
> personal information; a parent creates the child profiles. There are no ads,
> no third-party SDKs, no tracking and no chat.
>
> **Two kinds of user.**
> - *Kids* play. They sign in by picking their profile on the family's device,
>   or by scanning a QR code a parent shows them (pending #124, #132). A kid
>   never sees a sign-in form, a purchase, or a link out of the app.
> - *Parents* manage the family in a small parent area: add children and show
>   their QR codes, see basic stats, buy Premium, set a contact email, and
>   delete the account (pending #122, #123, #148, #150).
>
> **How to reach the parent area.**
> 1. On the home screen, tap **Grown-ups** (top right, with a lock).
> 2. **Parental gate:** answer the question shown, a multiplication written out
>    in words (for example "What is thirteen times seven?"), by typing the
>    number. A wrong answer gives a new question; three wrong answers in a row
>    close the gate.
> 3. **Face ID, Touch ID or the device passcode.** The review device needs a
>    passcode set; without one the parent area explains that it needs one and
>    stays closed.
> 4. **Sign in with Apple** (first time only; the session is then kept on the
>    device). The gate and device check still run on every later visit.
>
> **Sign in with Apple** is the only sign-in in the app, for parents only. We
> request the email scope only. You can use your own Apple Account, which
> creates a new, empty family; or use the demo account in the sign-in
> information, whose family already has children and progress.
>
> **In-app purchase.** Premium is an auto-renewable subscription sold with
> StoreKit, unlocking every game for the whole family. It is only offered in
> the parent area, behind the parental gate and device check (pending #148).
> Families who subscribed on our website keep Premium in the app, and the same
> subscription is sold here, as guideline 3.1.3(b) requires. Classroom and
> school plans are arranged with schools outside the app and are not sold in
> it.
>
> **Offline.** Play works offline; progress uploads when the device is back
> online.

## Demo account

Sign in with Apple is the only way in, so the demo "account" is an **Apple
Account** that has already signed in to Dragon Academy once. App Store Connect's
sign-in fields take its Apple Account email and password.

- **TODO (human):** create a dedicated Apple Account for review (not a personal
  one, and with two-factor authentication handled per Apple's current guidance
  for review accounts), sign in to the app with it on a test device, and set up
  its family:
  - two children with handles and some progress, so the stats, QR codes and
    profile picker have something to show;
  - a verified contact email the team reads;
  - no active subscription, so the reviewer can test the purchase in the
    sandbox.
- **TODO (human):** record where the credentials are kept (the team's password
  manager), so the next submitter can find them. Not in this repo.
- Keep the account on the production server, since review builds are Release
  builds and talk to production. Don't flag it `created_by_agent` — orphan and
  test-account cleanups must not delete it.

## Things reviewers have asked apps like this about

- *Guideline 1.3 / 5.1.1 (kids).* We're not in the Kids category, but the app
  is for children, so: no ads, no third-party analytics, no links out of the
  kid screens, and the parental gate protects purchases, account management and
  anything that leaves the app.
- *Guideline 4.8 (Sign in with Apple).* It is the only sign-in method in the
  app, so the equivalent-login-option rule is met.
- *Guideline 5.1.1(v) (account deletion).* The parent area can delete the
  account (pending #122).
- *Guideline 4.2 (minimum functionality).* The app is native SwiftUI, not a
  wrapped website, and works offline ([ADR 0001](adr/0001-native-swiftui-ios-app.md)).
