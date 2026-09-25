// GET /.well-known/apple-app-site-association — the universal-links file iOS
// fetches for the app's applinks:mydragonmath.com entitlement. Apple accepts it
// only as JSON served directly (200, application/json, no redirect).

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  router,
  appSiteAssociation,
  BUNDLE_ID,
  TEAM_ID_PLACEHOLDER,
} = require('./appleAppSiteAssociation.js');

let server;
let baseUrl;
const originalTeamID = process.env.APPLE_TEAM_ID;

beforeAll(async () => {
  const express = require('express');
  const app = express();
  app.use(router);
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

afterEach(() => {
  if (originalTeamID === undefined) delete process.env.APPLE_TEAM_ID;
  else process.env.APPLE_TEAM_ID = originalTeamID;
});

const getFile = () => fetch(`${baseUrl}/.well-known/apple-app-site-association`, { redirect: 'manual' });

describe('GET /.well-known/apple-app-site-association', () => {
  it('serves JSON directly, with no redirect', async () => {
    const res = await getFile();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('location')).toBeNull();
  });

  it('opens kid and family links in the app with the Team ID from APPLE_TEAM_ID', async () => {
    process.env.APPLE_TEAM_ID = 'ABCDE12345';
    const res = await getFile();
    expect(await res.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: [`ABCDE12345.${BUNDLE_ID}`],
            components: [{ '/': '/k/*' }, { '/': '/family/*' }],
          },
        ],
      },
    });
  });

  it('uses a placeholder Team ID until APPLE_TEAM_ID is set', async () => {
    delete process.env.APPLE_TEAM_ID;
    const body = await (await getFile()).json();
    expect(body.applinks.details[0].appIDs).toEqual([`${TEAM_ID_PLACEHOLDER}.${BUNDLE_ID}`]);

    process.env.APPLE_TEAM_ID = '   ';
    expect(appSiteAssociation().applinks.details[0].appIDs).toEqual([`${TEAM_ID_PLACEHOLDER}.${BUNDLE_ID}`]);
  });

  it('uses the app bundle id from ios/project.yml', () => {
    const projectYml = fs.readFileSync(path.join(__dirname, '../../ios/project.yml'), 'utf8');
    expect(projectYml).toContain(`PRODUCT_BUNDLE_IDENTIFIER: ${BUNDLE_ID}\n`);
  });

  it('is mounted before express.static, which skips /.well-known', () => {
    const index = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    const mounted = index.indexOf('app.use(appSiteAssociationRoutes)');
    expect(mounted).toBeGreaterThan(-1);
    expect(mounted).toBeLessThan(index.indexOf('app.use(express.static('));
  });
});
