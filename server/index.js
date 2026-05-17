const express = require('express');
const cors = require('cors');

require('./db'); // initialise DB + create tables

const authRoutes = require('./routes/auth');
const progressRoutes = require('./routes/progress');

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174'] }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/progress', progressRoutes);

app.listen(PORT, () => {
  console.log(`🐉 Dragon Math API running on http://localhost:${PORT}`);
});
