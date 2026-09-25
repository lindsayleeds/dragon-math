# iOS App Store privacy label (draft)

The answers to App Store Connect's **App Privacy** questionnaire for Dragon
Academy, worked out from what the app and server actually collect as of issue
#170. A human enters them in App Store Connect (the label can't be set from the
repo) and re-checks them before each release that changes what is collected.

The same answers are in the app's privacy manifest,
[ios/DragonAcademy/PrivacyInfo.xcprivacy](../ios/DragonAcademy/PrivacyInfo.xcprivacy).
`PrivacyManifestTests` (ios/DragonAcademyTests) parses the table below and fails
if the manifest disagrees with it, so **change both together**.

Background: the app is listed in Education, 4+, not the Kids category, and keeps
COPPA practices anyway ([ADR 0008](adr/0008-ios-storekit-and-education-category.md),
[COPPA.md](COPPA.md)). There are no third-party SDKs; everything below goes only
to our own server, and crash reporting is Apple's MetricKit
([IOS_PLAN.md](IOS_PLAN.md), Quality).

## Tracking

**Do you or your third-party partners use data for tracking?** No.

Nothing is combined with other companies' data, nothing is shared with data
brokers, there is no advertising, no App Tracking Transparency prompt, and
`NSPrivacyTracking` is false with no tracking domains. The web app's Google
sign-in is not in the iOS app ([ADR 0007](adr/0007-ios-sign-in-with-apple-only.md)).

## Data collected

**Do you or your third-party partners collect data from this app?** Yes.

Linked = App Store Connect's "Is this data linked to the user's identity?".
Tracking is No for every type.

| Data type (App Store Connect) | Manifest key | Linked | Tracking | Purposes | What it is, and where it lives |
|---|---|---|---|---|---|
| Contact Info › Email Address | `NSPrivacyCollectedDataTypeEmailAddress` | Yes | No | App Functionality | Parent only. The login email Sign in with Apple shares (`users.email`, possibly a `@privaterelay.appleid.com` address) and the contact email the parent sets and verifies for progress digests and COPPA notices (`users.contact_email`). Never a kid's. |
| Identifiers › User ID | `NSPrivacyCollectedDataTypeUserID` | Yes | No | App Functionality | Our account ids; the parent's Apple user id (`users.apple_sub`); a kid's chosen handle (`users.username`), which is a screen name, not a real name; the StoreKit `appAccountToken` (`users.app_account_token`). |
| Purchases › Purchase History | `NSPrivacyCollectedDataTypePurchaseHistory` | Yes | No | App Functionality | The parent's App Store subscription as Apple's server notifications report it (`app_store_subscriptions`, `app_store_notifications`): product, transaction ids, expiry, renewal. Used to unlock premium for the family. No payment details — Apple never sends them. |
| User Content › Gameplay Content | `NSPrivacyCollectedDataTypeGameplayContent` | Yes | No | App Functionality | A kid's progress: map nodes won and stars (`node_progress`), dragons collected (`user_dragons`), match results (`matches`). Uploaded from the on-device event queue (`POST /api/sync/events`). |
| Usage Data › Product Interaction | `NSPrivacyCollectedDataTypeProductInteraction` | Yes | No | App Functionality, Analytics | A kid's play: each answered problem and time taken (`problem_attempts`), wrong taps (`wrong_taps`), minutes played (`play_minutes`), and the raw synced events (`sync_events`). Drives the kid's progress, the parent's reports and plausibility checks, and is our own play telemetry (the per-child telemetry opt-out in IOS_PLAN.md limits the analytics use). |
| Diagnostics › Crash Data | `NSPrivacyCollectedDataTypeCrashData` | No | No | App Functionality | MetricKit diagnostic reports: crash, hang, CPU and disk-write exceptions with call stacks (`metrickit_payloads`, kind `diagnostic`). |
| Diagnostics › Performance Data | `NSPrivacyCollectedDataTypePerformanceData` | No | No | App Functionality | MetricKit metric reports: launch time, hang rate, memory, energy, disk writes (`metrickit_payloads`, kind `metric`). |

Why the diagnostics are **not linked**: `POST /api/diagnostics/metrickit`
takes no session, the app sends it none (its client has no token provider), and
the server stores no account id, IP address or device identifier with a report —
only the report, the app and OS versions, a per-report UUID for dedupe, and the
arrival time. The device's region setting (`regionFormat`) is stripped before
storing. Reports are deleted after 90 days. See
[server/routes/diagnostics.js](../server/routes/diagnostics.js) and
[server/lib/metricKit.js](../server/lib/metricKit.js). If that ever changes
(say, a report tagged with the signed-in parent), both types become Linked.

## Not collected

Answer **No** for everything else, in particular:

- **Name.** The iOS app asks Sign in with Apple for `.email` only, never
  `.fullName` (ios/DragonAcademy/ParentAccess/AppleCredentialProvider.swift),
  and has no name field. A kid's real name (`users.real_name`) can be entered by
  an adult on the *web* only; the iOS app neither asks for nor sends it. If the
  iOS parent view ever gains a real-name field, add Contact Info › Name (Linked,
  App Functionality).
- **Device ID.** No `identifierForVendor`, no advertising identifier. The UUIDs
  the device mints are per event and per MetricKit report, never per device or
  install.
- **Location**, precise or coarse. The server sees an IP address with every
  request, as any server does, and uses it transiently as a rate-limit key
  (`rate_limits`, expiring rows); it isn't stored with any data or used to
  derive a location.
- **Photos or videos.** "I have a login code" uses the camera to read a kid's
  QR login code (ios/DragonAcademy/KidSignIn/CodeScanner.swift). Frames are
  read on the device and never saved or sent; only the code's login token
  goes to the server, as it does when the kid taps their link.
- **Phone number, physical address, contacts, health, financial info, sensitive
  info, browsing or search history, photos, audio, customer support, other user
  content, advertising data, other usage data, other diagnostic data, other
  data types.**

## Things to re-check before submitting

- Apple's own crash reports and App Analytics in App Store Connect (from people
  who chose to share with developers) are collected by Apple, not by us. Our
  reading is that they need no rows of their own; confirm against Apple's
  current "App privacy details" guidance. The MetricKit reports we upload to our
  own server certainly do, which is why the two Diagnostics rows are there.
- If the app starts sending marketing email (not progress digests or account
  notices), add Developer's Advertising or Marketing to Email Address.
- Any new sync kind: decide whether it's Gameplay Content or Product
  Interaction; neither row needs changing unless it's a new *type* of data.
- The privacy policy page (`/privacy` on the web) must say the same things; the
  App Store listing links to it.
- Required-reason APIs: the manifest declares `UserDefaults` (CA92.1: the
  Debug-only launch arguments `-ParentAccessFakes`, `-DABattleSeed` and
  `-DAResetStore`, read in `AppConfiguration` and `LaunchOptions`). `PrivacyManifestTests` scans the app's and packages'
  Swift for the others (file timestamps, boot time, disk space, active
  keyboards) and fails if one appears undeclared. GRDB ships its own manifest,
  which declares nothing.
