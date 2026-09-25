// The dragon art the catalog routes describe and GET /api/dragons/art serves
// (iOS downloads it for a dragon it doesn't bundle, #143): which directory
// wins, and that a replaced PNG gets a new hash despite the cache.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createArtFiles } = require('./dragonArt');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

let root;
let dist;
let pub;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dragon-art-'));
  dist = join(root, 'dist');
  pub = join(root, 'public');
  mkdirSync(dist);
  mkdirSync(pub);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('createArtFiles', () => {
  it('prefers the first directory with the PNG', () => {
    writeFileSync(join(pub, '7.png'), 'public copy');
    const art = createArtFiles([dist, pub]);
    expect(art.artFile(7)).toBe(join(pub, '7.png'));
    writeFileSync(join(dist, '7.png'), 'served copy');
    expect(art.artFile(7)).toBe(join(dist, '7.png'));
    expect(art.artFile(8)).toBeNull();
  });

  it('lists the hash and size, null without art', () => {
    writeFileSync(join(pub, '7.png'), 'seven');
    const art = createArtFiles([dist, pub]);
    expect(art.withArt([{ dragon_id: 7, name: 'Moss' }, { dragon_id: 8, name: null }])).toEqual([
      { dragon_id: 7, name: 'Moss', art_sha256: sha256('seven'), art_bytes: 5 },
      { dragon_id: 8, name: null, art_sha256: null, art_bytes: null },
    ]);
  });

  it('rehashes a replaced PNG', () => {
    const file = join(pub, '7.png');
    writeFileSync(file, 'first');
    const art = createArtFiles([pub]);
    expect(art.artInfo(7).sha256).toBe(sha256('first'));
    writeFileSync(file, 'second art');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(art.artInfo(7)).toEqual({ sha256: sha256('second art'), bytes: 10 });
  });
});
