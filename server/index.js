const express = require('express');
const cors = require('cors');

require('./db'); // initialise DB + create tables

const authRoutes = require('./routes/auth');
const progressRoutes = require('./routes/progress');
const nodeConfigRoutes = require('./routes/nodeConfig');
const adminRoutes = require('./routes/admin');
const attemptsRoutes = require('./routes/attempts');
const companionsRoutes = require('./routes/companions');

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174'] }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/node-config', nodeConfigRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/attempts', attemptsRoutes);
app.use('/api/companions', companionsRoutes);

app.listen(PORT, () => {
  console.log(`🐉 Dragon Math API running on http://localhost:${PORT}`);
});
