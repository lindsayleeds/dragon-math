#!/usr/bin/env node
// Regenerates server/openapi.json from the route contracts in server/contracts/.
// Run after changing a contract: `npm run openapi`. The server tests fail while
// the checked-in file is stale.
const fs = require('fs');
const path = require('path');
const { serializeDocument, OPENAPI_PATH } = require('../server/openapi/document');

fs.writeFileSync(OPENAPI_PATH, serializeDocument());
console.log(`Wrote ${path.relative(process.cwd(), OPENAPI_PATH)}`);
