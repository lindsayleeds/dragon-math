require('dotenv').config();

const express = require('express');
const cors = require('cors');

require('./db'); // initialise DB + create tables

const authRoutes = require('./routes/auth');
const progressRoutes = require('./routes/progress');
const nodeConfigRoutes = require('./routes/nodeConfig');
const adminRoutes = require('./routes/admin');
const attemptsRoutes = require('./routes/attempts');
const companionsRoutes = require('./routes/companions');
const playtimeRoutes = require('./routes/playtime');
const matchesRoutes = require('./routes/matches');
const parentRoutes = require('./routes/parent');
const childCodeRoutes = require('./routes/childCode');
const dragonTrialRoutes = require('./routes/dragonTrial');
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
app.use('/api/playtime', playtimeRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/me', childCodeRoutes);
app.use('/api/dragon-trial', dragonTrialRoutes);

app.listen(PORT, () => {
  console.log(`🐉 My Dragon Math API running on http://localhost:${PORT}`);
  const cronStatus = cron.start();
  if (cronStatus.enabled) console.log('🗓  Weekly digest cron scheduled');
});
