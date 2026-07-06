const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Serve .env config as JSON endpoint for the frontend
app.get('/api/config', (req, res) => {
  res.json({
    SIGNALING_URL: process.env.SIGNALING_URL || 'ws://localhost:8080/?role=receiver',
    STUN_SERVER_URL: process.env.STUN_SERVER_URL || 'stun:stun.l.google.com:19302'
  });
});

// Serve index.html for any unmatched routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Screen Mirror Receiver listening on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
