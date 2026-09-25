const express = require('express');

// GET /.well-known/apple-app-site-association — tells iOS which links on this
// domain open the Dragon Academy app instead of Safari (universal links): a
// kid's login link /k/<token> (also what their QR code holds) and a
// family-device link /family/<token>. The app's Associated Domains entitlement
// (applinks:mydragonmath.com, ios/project.yml) makes iOS fetch this file, via
// Apple's CDN, when the app is installed.
//
// Apple wants it at exactly this path, as JSON (Content-Type application/json),
// over HTTPS with no redirect. It gets its own route because express.static
// skips dot-directories like /.well-known by default (docs/APPLE_SIGN_IN.md),
// and on Cloud Run every request reaches Express. Behind nginx the path isn't a
// file in dist/, so `try_files` falls through to Express too (docs/NGINX.md).
//
// The app id is "<Team ID>.<bundle id>". The Team ID comes from APPLE_TEAM_ID
// (the paid developer account's, also used for Sign in with Apple revocation).
// Until it's set the file carries TEAM_ID_PLACEHOLDER, which matches no app, so
// links keep opening the web app as they do today.

const BUNDLE_ID = 'dev.placeholder.dragonacademy';
const TEAM_ID_PLACEHOLDER = 'TEAM_ID_PLACEHOLDER';
const LINK_PATHS = ['/k/*', '/family/*'];

function appID(teamID = process.env.APPLE_TEAM_ID) {
  const team = (teamID || '').trim();
  return `${team || TEAM_ID_PLACEHOLDER}.${BUNDLE_ID}`;
}

function appSiteAssociation(teamID) {
  return {
    applinks: {
      details: [
        {
          appIDs: [appID(teamID)],
          components: LINK_PATHS.map(path => ({ '/': path })),
        },
      ],
    },
  };
}

const router = express.Router();

router.get('/.well-known/apple-app-site-association', (_req, res) => {
  // Short cache: Apple's CDN re-fetches on its own schedule anyway, and a Team
  // ID change should reach it without waiting on our max-age.
  res
    .set('Cache-Control', 'public, max-age=3600')
    .type('application/json')
    .send(JSON.stringify(appSiteAssociation()));
});

module.exports = { router, appSiteAssociation, appID, BUNDLE_ID, TEAM_ID_PLACEHOLDER, LINK_PATHS };
