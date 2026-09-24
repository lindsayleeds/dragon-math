# Game rules are kept identical across JavaScript and Swift using shared settings and golden files

The rules now exist in both JavaScript (web and server) and Swift (iOS), since the device decides outcomes (ADR 0004). To keep them identical, every tunable number (odds, thresholds, timings, opponent pace) moves out of the code into settings served by the API, which both apps read. The remaining logic is checked with golden files: a script in this repo runs the JavaScript rule functions on fixed inputs and seeds and saves the expected outputs as JSON, and the Swift `GameRules` tests must match those outputs exactly. Random rules use a seeded random number generator implemented the same way in both languages (such as SplitMix64 or PCG), so the results are repeatable.

## Consequences

- Rule code in JavaScript must accept an injected random number generator and clock, instead of calling `Math.random` and `Date.now` directly.
- Changing a rule on the web regenerates the golden files, and the iOS tests then fail until Swift is updated.
