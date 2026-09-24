# Native SwiftUI rewrite for iOS, not a wrapper

The goal is an App Store presence for the working product. Wrapping the React app with Capacitor, or rewriting it in React Native, would both have been cheaper. We chose a full native SwiftUI rewrite instead, because it gives the best feel on iPhone and iPad, it avoids App Review rejecting the app as "just a website" (guideline 4.2), and AI-assisted porting makes a rewrite affordable. The React app stays live. Its code and tests are the spec for the port.

## Considered Options

- **Capacitor wrapper:** weeks of work and one codebase, but it risks rejection under guideline 4.2 and feels web-like on iPad.
- **React Native / Expo:** reuses React skills, but most screens would still be rewritten.
- **JavaScript rules run on the device through JavaScriptCore:** one copy of the logic, but awkward to debug and odd for a native app.
