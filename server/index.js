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
const schoolRoutes = require('./routes/school').router;
const tribesRoutes = require('./routes/tribes');
const childCodeRoutes = require('./routes/childCode');
const dragonTrialRoutes = require('./routes/dragonTrial');
const masteryRoutes = require('./routes/mastery');
const gameResultRoutes = require('./routes/gameResult');
const leaderboardRoutes = require('./routes/leaderboard');
const provingGroundsRoutes = require('./routes/provingGrounds').router;
const billingRoutes = require('./routes/billing');
const manifestRoutes = require('./routes/manifest');
const healthRoutes = require('./routes/health');
const cron = require('./cron');

const { resolveBindHost } = require('./lib/bindHost');

const app = express();
const PORT = process.env.API_PORT || 3001;
// Loopback unless API_HOST says otherwise — see server/lib/bindHost.js.
const HOST = resolveBindHost();

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
  // The Stripe webhook needs the raw body to verify its signature — the billing
  // router applies express.raw() to that route itself, so skip the JSON parser.
  if (req.method === 'POST' && req.path === '/api/billing/webhook') return next();
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
app.use('/api/school', schoolRoutes);
app.use('/api/tribes', tribesRoutes);
app.use('/api/me', childCodeRoutes);
app.use('/api/dragon-trial', dragonTrialRoutes);
app.use('/api/mastery', masteryRoutes);
app.use('/api/game-result', gameResultRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/proving-grounds', provingGroundsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/manifest', manifestRoutes);
// Deliberately last and deliberately bare: no auth, no admin password, no rate
// limiter in front of it. See server/routes/health.js.
app.use('/api/health', healthRoutes);

// SPA shell with per-kid PWA manifest injection.
//
// iOS Safari reads <link rel="manifest"> from the INITIAL HTML when you tap
// "Add to Home Screen" and ignores any client-side change to it — so swapping
// the manifest href in JS can't make a kid's home-screen icon launch back into
// their session. The only reliable channel is the server response: when a
// request carries a kid login token (/k/<token>, or the post-login /home?k=<token>
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

const server = app.listen(PORT, HOST, () => {
  console.log(`🐉 My Dragon Math API running on http://${HOST}:${PORT}`);
  const cronStatus = cron.start();
  // Logged in both directions, once per boot: "no scheduled jobs here" is a
  // claim a deployment needs to be able to verify from the logs, not infer.
  if (cronStatus.enabled) console.log('🗓  Scheduled jobs registered (weekly digest, orphan cleanup)');
  else console.log(`🗓  Scheduled jobs NOT registered — ${cronStatus.reason}`);

  // Loud, once-per-boot email config check so a missing/stubbed key is obvious
  // in the PM2 logs immediately rather than only when the first send fails.
  const email = require('./lib/email').emailConfigStatus();
  if (!email.ok) {
    console.warn('⚠️  EMAIL DISABLED — RESEND_API_KEY not set and EMAIL_STUB!=1. Every outgoing email will FAIL. Set RESEND_API_KEY to send, or EMAIL_STUB=1 to log.');
  } else if (email.mode === 'stub') {
    console.warn('✉️  EMAIL_STUB=1 — emails are logged to stdout, NOT delivered.');
  } else {
    console.log('✉️  Email: Resend configured (live delivery).');
  }
});

// Graceful shutdown — what makes a pm2 cluster reload actually zero-downtime.
//
// `pm2 reload` replaces workers one at a time, and in cluster mode the master
// keeps the listening socket, so connections are always accepted. But a worker
// that exits the instant it gets SIGINT drops whatever it was mid-response on:
// measured over a reload under load, that was a couple of failed requests per
// thousand. Closing the listener and letting in-flight requests finish first
// takes it to zero.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`↻ ${signal} received — draining in-flight requests`);

  server.close(() => {
    console.log('↻ drained, exiting');
    process.exit(0);
  });
  // Idle keep-alive sockets would otherwise hold server.close() open until they
  // time out. Anything longer-lived that gets added later has to be closed here
  // too, or server.close() waits for the backstop below.
  server.closeIdleConnections?.();

  // Backstop, deliberately shorter than the ecosystem's kill_timeout (8s) so we
  // exit on our own terms rather than being SIGKILLed mid-request.
  setTimeout(() => {
    console.warn('↻ drain timed out — exiting anyway');
    process.exit(0);
  }, 6000).unref();
}
// pm2 sends SIGINT on reload/stop; SIGTERM covers systemd and docker.
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
