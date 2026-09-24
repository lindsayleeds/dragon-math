#!/usr/bin/env node
//
// Writes the golden files in golden/ from the JavaScript rules
// (src/rules/golden.js), for the Swift GameRules tests to check against —
// ADR 0005. Deterministic: running it twice produces identical bytes, and
// src/rules/golden.test.js fails CI when a committed file has drifted from what
// this would write.
//
// Usage:
//   npm run golden:generate

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGoldenFiles, serializeGolden } from '../src/rules/golden.js';

const GOLDEN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'golden');

const files = buildGoldenFiles();
mkdirSync(GOLDEN_DIR, { recursive: true });

// A fixture removed from the registry must not linger for Swift to keep
// passing against, so anything in golden/ the registry no longer names goes.
for (const name of readdirSync(GOLDEN_DIR)) {
  if (name.endsWith('.json') && !(name in files)) {
    rmSync(join(GOLDEN_DIR, name));
    console.log(`removed golden/${name}`);
  }
}

for (const [name, fixture] of Object.entries(files)) {
  writeFileSync(join(GOLDEN_DIR, name), serializeGolden(fixture));
  console.log(`wrote golden/${name}`);
}
