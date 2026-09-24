// The HTTP contract the iOS app is generated from: every route listed here is
// described in openapi.json (built by `npm run openapi`, see
// server/openapi/document.js) and has its responses checked by tests.
//
// Only iOS-used routes belong here (docs/adr/0006). To add some, write
// server/contracts/<area>.js exporting `routes` built with defineRoute(), list it
// below, parse the handler's input with its schemas via server/lib/parseInput.js,
// then regenerate openapi.json.
const auth = require('./auth');

const routes = [
  ...auth.routes,
  ...require('./settings').routes,
  ...require('./dragons').routes,
  ...require('./spelling').routes,
  ...require('./memorize').routes,
];

module.exports = { routes };
