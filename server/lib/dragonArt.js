// Helpers for the collectible-dragon PNG art that lives on disk.
//
// Dragon art is stored as <id>.png in TWO places:
//   • public/dragon_pngs/  — the source tree, copied into dist/ by `vite build`
//     (so a fresh build keeps any dragons a keeper uploaded), and
//   • dist/dragon_pngs/    — what nginx actually serves in production.
// When a keeper uploads a new dragon we write both copies so it appears live
// immediately AND survives the next rebuild. dragon_catalog (Postgres) is the
// source of truth for which dragons EXIST; these files are just the art.
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

module.exports = { maxArtId, writeArt, removeArt };
