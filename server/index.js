require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

require('./db'); // initialise Drizzle/pg pool (schema lives in Postgres now)

const authRoutes = require('./routes/auth');
const progressRoutes = require('./routes/progress');
const nodeConfigRoutes = require('./routes/nodeConfig');
const adminRoutes = require('./routes/admin');
const attemptsRoutes = require('./routes/attempts');
const companionsRoutes = require('./routes/companions');
const dragonsRoutes = require('./routes/dragons');
const playtimeRoutes = require('./routes/playtime');
const matchesRoutes = require('./routes/matches');
const parentRoutes = require('./routes/parent');
const classroomRoutes = require('./routes/classroom');
const tribesRoutes = require('./routes/tribes');
const childCodeRoutes = require('./routes/childCode');
const dragonTrialRoutes = require('./routes/dragonTrial');
const masteryRoutes = require('./routes/mastery');
const gameResultRoutes = require('./routes/gameResult');
const leaderboardRoutes = require('./routes/leaderboard');
const manifestRoutes = require('./routes/manifest');
const realtime = require('./realtime');
const cron = require('./cron');

const app = express();
const PORT = process.env.API_PORT || 3001;

// Allowed CORS origins. Override in production via CORS_ORIGINS (comma-separated)
// if the app is ever deployed to a different host.
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://mydragonmath.com',
  'https://www.mydragonmath.com',
];
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : DEFAULT_ORIGINS }));
// Global JSON parser with the default (100kb) limit. The dragon-upload route
// (POST /api/admin/dragons) carries a base64 PNG that can far exceed that, so
// we skip it here and let that route apply its own larger-limit parser.
const jsonParser = express.json();
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/admin/dragons') return next();
  jsonParser(req, res, next);
});

app.use('/api/auth', authRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/node-config', nodeConfigRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/attempts', attemptsRoutes);
app.use('/api/companions', companionsRoutes);
app.use('/api/dragons', dragonsRoutes);
app.use('/api/playtime', playtimeRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/classroom', classroomRoutes);
app.use('/api/tribes', tribesRoutes);
app.use('/api/me', childCodeRoutes);
app.use('/api/dragon-trial', dragonTrialRoutes);
app.use('/api/mastery', masteryRoutes);
app.use('/api/game-result', gameResultRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/manifest', manifestRoutes);

// SPA shell with per-kid PWA manifest injection.
//
// iOS Safari reads <link rel="manifest"> from the INITIAL HTML when you tap
// "Add to Home Screen" and ignores any client-side change to it — so swapping
// the manifest href in JS can't make a kid's home-screen icon launch back into
// their session. The only reliable channel is the server response: when a
// request carries a kid login token (/k/<token>, or the post-login /map?k=<token>
// URL), we bake the per-kid manifest (start_url=/k/<token>) into the HTML here.
// nginx serves static assets and falls back to this handler for SPA routes.
const DIST_DIR = path.join(__dirname, '../dist');
const KID_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function kidTokenFromReq(req) {
  const pathMatch = req.path.match(/^\/k\/([^/]+)$/);
  const fromPath = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
  const fromQuery = typeof req.query.k === 'string' ? req.query.k : null;
  const token = fromPath || fromQuery;
  return token && KID_TOKEN_RE.test(token) ? token : null;
}

app.use((req, res, next) => {
  // Final fallback: serve the SPA shell for page navigations. Anything else
  // (non-GET, or unmatched API paths) is a genuine 404. Express 5 rejects the
  // old '*' route string, so this is a path-less middleware instead of a route.
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });

  let html;
  try {
    html = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
  } catch {
    return res.status(404).send('Not found');
  }

  const token = kidTokenFromReq(req);
  if (token) {
    html = html.replace(
      /<link rel="manifest"[^>]*>/,
      `<link rel="manifest" href="/api/manifest/k/${encodeURIComponent(token)}" />`,
    );
  }

  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(html);
});

const server = app.listen(PORT, () => {
  console.log(`🐉 My Dragon Math API running on http://localhost:${PORT}`);
  const cronStatus = cron.start();
  if (cronStatus.enabled) console.log('🗓  Weekly digest cron scheduled');
});

// Attach the live-PvP websocket server to the same HTTP server (path /api/rt).
realtime.attach(server);
