const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- STORE CONNECTIONS ----------
let phoneSocket = null;        // Your Android phone
const dashSockets = new Set(); // Your browser tabs

// ---------- WEBSOCKET SERVER ----------
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // 1. PHONE CONNECTION (authenticated via token)
  if (pathname === '/phone') {
    const token = url.searchParams.get('token');
    if (token !== process.env.PHONE_SECRET) {
      ws.close(1008, 'Unauthorized');
      return;
    }
    console.log('📱 Phone connected!');
    phoneSocket = ws;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        // Relay phone's response to ALL dashboards
        dashSockets.forEach(dash => {
          if (dash.readyState === WebSocket.OPEN) {
            dash.send(JSON.stringify({ type: 'phone_response', data: msg }));
          }
        });
      } catch (e) { console.error('Relay error:', e); }
    });

    ws.on('close', () => {
      console.log('📱 Phone disconnected');
      phoneSocket = null;
    });
    return;
  }

  // 2. DASHBOARD CONNECTION (your browser)
  if (pathname === '/dash') {
    console.log('🖥️ Dashboard connected');
    dashSockets.add(ws);

    ws.on('message', (raw) => {
      try {
        const command = JSON.parse(raw);
        if (phoneSocket && phoneSocket.readyState === WebSocket.OPEN) {
          phoneSocket.send(JSON.stringify(command));
        } else {
          ws.send(JSON.stringify({ type: 'error', msg: 'Phone is offline' }));
        }
      } catch (e) { console.error('Dashboard error:', e); }
    });

    ws.on('close', () => {
      dashSockets.delete(ws);
    });
    return;
  }

  ws.close(1000, 'Invalid endpoint');
});

// ---------- SERVE DASHBOARD HTML ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'src' ,'index.html'));
});

server.listen(PORT, () => {
  console.log(`✅ Relay running on port ${PORT}`);
});