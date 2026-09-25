// Helpers for the collectible-dragon PNG art that lives on disk.
//
// Dragon art is stored as <id>.png in TWO places:
//   • public/dragon_pngs/  — the source tree, copied into dist/ by `vite build`
//     (so a fresh build keeps any dragons a keeper uploaded), and
//   • dist/dragon_pngs/    — what nginx actually serves in production.
// When a keeper uploads a new dragon we write both copies so it appears live
// immediately AND survives the next rebuild. dragon_catalog (Postgres) is the
// source of truth for which dragons EXIST; these files are just the art.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ART_DIRS = [
  path.join(REPO_ROOT, 'public', 'dragon_pngs'),
  path.join(REPO_ROOT, 'dist', 'dragon_pngs'),
];

// The highest <id>.png present across the art dirs — uploads claim maxId + 1.
function maxArtId() {
  let max = 0;
  for (const dir of ART_DIRS) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const f of entries) {
      const m = /^(\d+)\.png$/.exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max;
}

// Write a dragon's PNG to every art dir. `buffer` is the decoded image bytes.
// dist/ may not exist in a dev checkout that never ran `vite build`; we create
// the dir if its parent (dist/) is already there, and skip it otherwise.
function writeArt(dragonId, buffer) {
  for (const dir of ART_DIRS) {
    const parent = path.dirname(dir);
    if (!fs.existsSync(parent)) continue; // e.g. no dist/ in a dev tree
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${dragonId}.png`), buffer);
  }
}

// Permanently delete a dragon's PNG from every art dir (hard delete — e.g. a
// copyright takedown). Missing files are ignored so the call is idempotent.
function removeArt(dragonId) {
  for (const dir of ART_DIRS) {
    try { fs.rmSync(path.join(dir, `${dragonId}.png`), { force: true }); } catch { /* ignore */ }
  }
}

// The art the app downloads for a dragon it has no bundled copy of (iOS #143):
// GET /api/dragons/art/<id>.png serves artFile(), and the catalog routes list
// each dragon's art_sha256 / art_bytes (withArt) so the device can tell a new
// or replaced PNG from the one it has, and check the download. dist/ first,
// since that is what nginx serves; public/ in a dev tree without a build.
//
// Hashes are cached by path, size and mtime: the catalog is read on every
// device's content check, and re-hashing ~250 PNGs each time would not do,
// while a keeper's upload (writeArt) changes the mtime and so the hash.
function createArtFiles(dirs) {
  const hashes = new Map();

  function artFile(dragonId) {
    for (const dir of dirs) {
      const file = path.join(dir, `${dragonId}.png`);
      try {
        const stat = fs.statSync(file);
        if (stat.isFile()) return { file, stat };
      } catch { /* not in this dir */ }
    }
    return null;
  }

  // { sha256, bytes } of a dragon's art, or null when it has none.
  function artInfo(dragonId) {
    const found = artFile(dragonId);
    if (!found) return null;
    const { file, stat } = found;
    const key = `${stat.size}:${stat.mtimeMs}`;
    const cached = hashes.get(file);
    if (cached?.key === key) return cached.info;
    let bytes;
    try { bytes = fs.readFileSync(file); } catch { return null; }
    const info = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
    hashes.set(file, { key, info });
    return info;
  }

  // Catalog rows with their art fields (null when a dragon has no PNG).
  function withArt(rows) {
    return rows.map((row) => {
      const info = artInfo(row.dragon_id);
      return { ...row, art_sha256: info?.sha256 ?? null, art_bytes: info?.bytes ?? null };
    });
  }

  return { artFile: (id) => artFile(id)?.file ?? null, artInfo, withArt };
}

// Serving prefers dist/ (what production serves) over public/.
const served = createArtFiles([...ART_DIRS].reverse());

module.exports = {
  maxArtId,
  writeArt,
  removeArt,
  createArtFiles,
  artFile: served.artFile,
  artInfo: served.artInfo,
  withArt: served.withArt,
};
