# iOS works offline, with an event queue synced to the server

Kids play in cars and on school iPads with no Wi-Fi, so the iOS app has to work offline. Everything a kid does is stored as an event with a local UUID, queued in a local SQLite store, and uploaded in batches. The server removes duplicates by UUID, so re-uploading after a dropped connection is safe. The server remains the record of truth for parent and teacher views. The app never waits on a network call during play. Content (the map, node settings, word lists, the dragon catalog, audio) ships in the app as of release, and anything added later downloads in the background. A custom spelling list only appears once all of its audio has downloaded.

Guest mode is simply offline play with no account. When a parent signs up, the guest's queued events are uploaded to the new child profile, so no personal data leaves the device before parental consent.

## Consequences

- The server needs sync endpoints that accept event batches and are safe to call twice.
- Local storage uses GRDB (SQLite) behind a `Store` interface, rather than SwiftData, whose migrations and background writes on iOS 18 are unreliable for a sync queue.
