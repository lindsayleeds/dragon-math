# iOS art exports

Vector imagesets generated from the web app's React SVG art: the paper map,
the boss dragons and the battle wallpapers (issue #133). **Everything here
except this README is generated. Don't edit it by hand.**

```sh
npm run ios:export-art                 # regenerate this folder
npm run ios:export-art -- --png <dir>  # also write 3x PNG previews for a visual check
```

Re-run it whenever the art changes. `src/components/map-paper/iosArtExport.test.js`
fails when the committed files no longer match the components.

The asset list and the SVG conversion are in
[`scripts/ios-art/artAssets.js`](../../scripts/ios-art/artAssets.js). The CLI is
[`scripts/ios-export-art.mjs`](../../scripts/ios-export-art.mjs).

## Using it in Xcode

This folder sits apart from the app target on purpose, so this export and the
Xcode scaffold (#111) don't conflict. Drag `Map/`, `Bosses/` and `Battle/` into
`ios/DragonAcademy/Assets.xcassets/`. Each
`<Name>.imageset` holds one SVG, and its `Contents.json` sets
`"preserves-vector-representation": true`, so the art stays sharp at any size.
Each asset has the same name in Swift, for example `Image("MapWorld3Background")`.

| Folder | Assets | Frame |
| --- | --- | --- |
| `Map/` | `MapWorld{1-6}Background`, `MapWorld{1-6}Road` | 400 wide, height = that world's band of the 400 × 5700 map |
| `Bosses/` | `BossForestDragon`, `BossSunfireDragon`, `BossCrystalDragon`, `BossSakuraDragon`, `BossStormDragon`, `BossMagmaDragon` | 72 × 72, which is the boss medallion (r = 36), with the art centered |
| `Battle/` | `BattleWallpaperWorld{1-6}` | 400 × 800, transparent, meant for aspect-fill |

`manifest.json` holds the layout facts for each asset: world id and name,
`mapY` (the tile's top edge in map coordinates), `viewBox`, and the node id of
each boss. The map is laid out bottom-up, world 1 at the bottom and world 6 at
the top. Stack the six background tiles at their `mapY` and the seams line up,
torn edges included. Put each world's `Road` tile at the same frame on top of
its background, and nodes go above that.

## What is not baked in

These parts are animated, change with state, or can't be drawn by CoreSVG
(the SVG renderer Xcode uses), so they're left out of the export and should be
rebuilt in SwiftUI:

- **Nodes**: the medallion circles, their fill for locked, available and
  completed states, the bobbing, the pulse ring on the available node, the
  "you →" note, the ✓ stamp, and the node labels. Node positions are
  `MAP_NODES` in `src/data/mapData.js`. Draw the boss art inside a native
  medallion.
- **The road** ships as its own `Road` layer, not in the background, so the
  app can draw a progress trail over it or replace it. Its path data is
  `MAP_PATH` in `mapData.js`.
- **Text**: the chapter headings ("~ chapter one ~ Mushroom Forest") and the
  margin doodles (✿ ✦ ★ glyphs and "the end?"). These use web fonts, so draw
  them with the bundled fonts. Their positions come from `WorldChapter.jsx`
  and `Doodles.jsx`.
- **SVG filters**: `paperWobble` (the crayon wobble on the road, nodes, tears
  and boss art), `watercolorEdge` (the soft edges of the washes and splotches)
  and `paperNoise` (the paper-fibre grain). The exported shapes are the clean,
  unfiltered geometry. Add grain as a tiled texture or shader overlay if you
  want it. Without `watercolorEdge`, each world's wash stops at its own band
  instead of overshooting by 8 units, so no hard stripe shows above the torn
  edges.

The dot-grid `<pattern>` is flattened into plain dots, so no asset depends on
`<defs>`. The exporter refuses to write an SVG that has `<text>`, `url(#…)`
references or CSS variables.
