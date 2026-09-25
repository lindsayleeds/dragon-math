// The facts the iOS dragon-art export (issue #142) and its staleness test
// share: where the art comes from, how big the app's copy is, and what each
// imageset looks like. Pure: `scripts/ios-dragon-art.mjs` does the encoding
// and the disk, and `src/data/iosDragonArt.test.js` checks the committed
// catalog against these.
//
// Size: the largest place iOS shows a dragon is a Dragon Den slot, whose art
// is at most DRAGON_ART_MAX_POINTS square (the prize reveal's card is 72 pt,
// the hatchery's baby slots under 60). One single-scale bitmap at 3× that
// covers every screen; a 2× device scales it down. Encoding: a quantized
// palette PNG (libimagequant through sharp's `palette: true`), which keeps the
// alpha edge and ships at ~15% of the 750 px originals.
import { createHash } from 'node:crypto';
import { DRAGON_PNG_COUNT } from '../../src/data/dragonRarity.js';

export { DRAGON_PNG_COUNT };

/** The web's art, public/dragon_pngs/<id>.png, relative to the repo root. */
export const SOURCE_DIR = 'public/dragon_pngs';
/** The asset-catalog group the export owns, relative to the repo root. */
export const CATALOG_DIR = 'ios/DragonAcademy/Assets.xcassets/Dragons';
/** Source and output hashes, so the test can spot a stale export cheaply. */
export const MANIFEST_PATH = 'scripts/ios-dragon-art/manifest.json';

/** The biggest a dragon is drawn on iOS, in points (DragonArt.maxPoints). */
export const DRAGON_ART_MAX_POINTS = 120;
/** The bundled bitmap's longest side: 3× the largest display size. */
export const DRAGON_ART_PX = DRAGON_ART_MAX_POINTS * 3;

/** sharp PNG options for the bundled copy. */
export const PNG_OPTIONS = { palette: true, quality: 90, effort: 10, compressionLevel: 9 };

const INFO = { author: 'xcode', version: 1 };

export const dragonIDs = () => Array.from({ length: DRAGON_PNG_COUNT }, (_, i) => i + 1);

/** The asset name Swift loads, `Image("dragon-7")` (DragonArt.imageName). */
export const imageName = id => `dragon-${id}`;

/** Xcode's two-space JSON with a trailing newline, as it writes Contents.json. */
export const catalogJson = value => `${JSON.stringify(value, null, 2)}\n`;

export const groupContents = () => catalogJson({ info: INFO });

/** A single-scale universal image (Xcode's "Single Scale"). */
export const imagesetContents = id =>
  catalogJson({ images: [{ filename: `${imageName(id)}.png`, idiom: 'universal' }], info: INFO });

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** A PNG's pixel size from its IHDR chunk. */
export function pngSize(bytes) {
  const signature = '89504e470d0a1a0a';
  if (Buffer.from(bytes.subarray(0, 8)).toString('hex') !== signature) throw new Error('not a PNG');
  const view = Buffer.from(bytes);
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}
