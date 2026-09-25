#!/usr/bin/env node
//
// Writes the iOS app's copy of the map (issue #134): the Swift map data in
// GameRules (MapNodes.swift) and any missing node/world strings in the app's
// String Catalog. Re-run whenever src/data/mapData.js changes, or after
// `npm run ios:export-art`:
//
//   npm run ios:map-data
//
// Deterministic. The builder is scripts/ios-map/mapDataSwift.js;
// src/data/mapData.ios.test.js fails when the committed files are stale.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_PATH,
  MANIFEST_PATH,
  SWIFT_PATH,
  buildSwift,
  updateCatalog,
} from './ios-map/mapDataSwift.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(ROOT, path), 'utf8');

writeFileSync(join(ROOT, SWIFT_PATH), buildSwift(read(MANIFEST_PATH)));
console.log(`wrote ${SWIFT_PATH}`);
writeFileSync(join(ROOT, CATALOG_PATH), updateCatalog(read(CATALOG_PATH)));
console.log(`updated ${CATALOG_PATH}`);
