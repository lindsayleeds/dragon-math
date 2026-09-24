# iOS sound effects

Short AAC files (`.m4a`, mono, 44.1 kHz, 96 kbps) of every synthesized sound
effect the kid screens play on the web. Generated — do not edit by hand.

```sh
npm run ios:render-sfx   # macOS only (uses the system afconvert)
```

[scripts/render-ios-sfx.mjs](../../scripts/render-ios-sfx.mjs) loads the real
`src/utils/sounds.js` and `src/utils/soundEffects.js` into headless Chromium via
Playwright and renders each `play*` function into an `OfflineAudioContext`, so
the files match what the web app plays. Noise is seeded, and a file is only
rewritten when its audio actually changed, so re-running is safe and leaves git
clean when nothing changed.

`manifest.json` maps each effect name to its file, duration, web source, and
the web screens/hooks that play it.

| Effect    | Web source                   | Played when                              |
| --------- | ---------------------------- | ---------------------------------------- |
| `correct` | `soundEffects.playCorrect`   | right answer (phonics, spelling, munchers, stepping stones, memorize) |
| `wrong`   | `soundEffects.playWrong`     | wrong answer (same games)                |
| `splash`  | `soundEffects.playSplash`    | Stepping Stones: fell in the river       |
| `win`     | `soundEffects.playWin`       | Stepping Stones: crossed the river       |
| `caught`  | `soundEffects.playCaught`    | Dragon Munchers: a monster caught you    |
| `yip`     | `sounds.playYip`             | battle / Dragon Trial: right answer      |
| `growl`   | `sounds.playGrowl`           | battle: the dragon scored                |
| `victory` | `sounds.playVictory`         | battle won / Dragon Trial passed         |
| `defeat`  | `sounds.playDefeat`          | battle lost                              |

No effect takes runtime parameters (none vary with streak, level, etc.), so
there is one file per effect. `soundEffects.playCollision` is not rendered: no
screen calls it.

**Adding or changing an effect:** edit it in `src/utils/`, add any new one to
`EFFECTS` in the script, and re-run. Effects must keep accepting an optional
audio context as their first argument (the web calls them with none).

AAC files carry encoder priming frames; `AVAudioFile` trims them, so load these
through `AVAudioFile`/`AVAudioPCMBuffer` rather than reading raw packets.
