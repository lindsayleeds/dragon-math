require('dotenv').config();

const express = require('express');
const cors = require('cors');

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
app.use(express.json());

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

const server = app.listen(PORT, () => {
  console.log(`🐉 My Dragon Math API running on http://localhost:${PORT}`);
  const cronStatus = cron.start();
  if (cronStatus.enabled) console.log('🗓  Weekly digest cron scheduled');
});

// Attach the live-PvP websocket server to the same HTTP server (path /api/rt).
realtime.attach(server);
