#!/usr/bin/env node
// Generates PWA / home-screen icons from public/favicon.svg.
// The favicon is an SVG wrapper around a 64x64 base64 PNG owl; we extract that
// PNG, then composite it (with padding) onto a parchment background at each
// size iOS / Android want. Opaque backgrounds keep iOS from showing the owl on
// a bare white/gray home-screen tile.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PUBLIC = path.join(__dirname, '..', 'public');
const BG = { r: 0xe9, g: 0xdc, b: 0xc0, alpha: 1 }; // #e9dcc0 parchment

// Pull the embedded base64 PNG out of favicon.svg
const svg = fs.readFileSync(path.join(PUBLIC, 'favicon.svg'), 'utf8');
const m = svg.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
if (!m) throw new Error('No embedded PNG found in favicon.svg');
const owl = Buffer.from(m[1], 'base64');

// size, output filename, padding fraction, opaque background?
const targets = [
  { size: 180, name: 'apple-touch-icon.png', pad: 0.12, opaque: true },
  { size: 192, name: 'icon-192.png', pad: 0.12, opaque: true },
  { size: 512, name: 'icon-512.png', pad: 0.12, opaque: true },
  // maskable: extra safe-zone padding so the owl survives Android's circle/squircle crop
  { size: 512, name: 'icon-maskable-512.png', pad: 0.22, opaque: true },
];

(async () => {
  for (const t of targets) {
    const inner = Math.round(t.size * (1 - t.pad * 2));
    const owlResized = await sharp(owl)
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: t.size,
        height: t.size,
        channels: 4,
        background: t.opaque ? BG : { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: owlResized, gravity: 'center' }])
      .png()
      .toFile(path.join(PUBLIC, t.name));

    console.log(`wrote public/${t.name} (${t.size}x${t.size})`);
  }
})();
