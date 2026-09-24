// The checked-in golden files are what the Swift tests trust, so they must be
// exactly what the JavaScript rules produce today. A rule change that forgot
// `npm run golden:generate` fails here instead of silently leaving iOS
// checked against stale expectations.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGoldenFiles, serializeGolden } from './golden';

const GOLDEN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'golden');
const REGENERATE = 'out of date — run `npm run golden:generate` and commit the result';

describe('golden files', () => {
  const files = buildGoldenFiles();

  it.each(Object.keys(files))('golden/%s matches what the rules produce', name => {
    const onDisk = readFileSync(join(GOLDEN_DIR, name), 'utf8');
    expect(onDisk, `golden/${name} is ${REGENERATE}`).toBe(serializeGolden(files[name]));
  });

  it('has no files the generator no longer writes', () => {
    const onDisk = readdirSync(GOLDEN_DIR).filter(name => name.endsWith('.json')).sort();
    expect(onDisk, `golden/ is ${REGENERATE}`).toEqual(Object.keys(files).sort());
  });

  it('builds identical output on every run', () => {
    const again = buildGoldenFiles();
    for (const name of Object.keys(files)) {
      expect(serializeGolden(again[name])).toBe(serializeGolden(files[name]));
    }
  });
});
