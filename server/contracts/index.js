// The HTTP contract the iOS app is generated from: every route listed here is
// described in openapi.json (built by `npm run openapi`, see
// server/openapi/document.js) and has its responses checked by tests.
//
// Only iOS-used routes belong here (docs/adr/0006). To add some, write
// server/contracts/<area>.js exporting `routes` built with defineRoute(), list it
// below, parse the handler's input with its schemas via server/lib/parseInput.js,
// then regenerate openapi.json.
//
// `components` are schemas no route body references but the app still needs a
// Swift type for — the per-kind sync payloads, which travel inside an open
// `payload` object.
const auth = require('./auth');
const sync = require('./sync');

const routes = [
  ...auth.routes,
  ...require('./contactEmail').routes,
  ...require('./settings').routes,
  ...require('./content').routes,
  ...require('./dragons').routes,
  ...require('./spelling').routes,
  ...require('./memorize').routes,
  ...sync.routes,
  ...require('./plan').routes,
  ...require('./children').routes,
  ...require('./diagnostics').routes,
  ...require('./account').routes,
];

const components = [
  ...sync.components,
];

module.exports = { routes, components };
