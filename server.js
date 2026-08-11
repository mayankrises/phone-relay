const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
// FORCE security check on startup
if (!process.env.DASHBOARD_PASSWORD) {
    console.error("❌ FATAL ERROR: DASHBOARD_PASSWORD is not set in environment variables!");
    console.error("The server will refuse to start to prevent unauthorized access.");
    process.exit(1); // Stops the server completely if the password is missing
}
const PORT = process.env.PORT || 3000;

// ---------- STORE CONNECTIONS ----------
// We use a Map to store phones so we can look them up by their unique deviceId
const phoneSockets = new Map();
const dashSockets = new Set();

// ---------- WEBSOCKET SERVER ----------
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // 1. PHONE CONNECTION (authenticated via token)
    if (pathname === '/phone') {
        const token = url.searchParams.get('token');
        const deviceId = url.searchParams.get('deviceId'); // Get the device ID

        // Validate that we have a token and a device ID
        if (token !== process.env.PHONE_SECRET || !deviceId) {
            ws.close(1008, 'Unauthorized or missing Device ID');
            return;
        }

        console.log(`📱 Phone (${deviceId}) connected!`);
        phoneSockets.set(deviceId, ws); // Store the connection using the deviceId as the key

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw);
                // Relay phone's response to ALL connected dashboards
                dashSockets.forEach(dash => {
                    if (dash.readyState === WebSocket.OPEN) {
                        dash.send(JSON.stringify({ type: 'phone_response', deviceId: deviceId, data: msg }));
                    }
                });
            } catch (e) { console.error('Relay error:', e); }
        });

        ws.on('close', () => {
            console.log(`📱 Phone (${deviceId}) disconnected`);
            phoneSockets.delete(deviceId); // Remove from the Map when they disconnect
        });
        return;
    }

    // 2. DASHBOARD CONNECTION (your browser)
    if (pathname === '/dash') {
        // NEW: Get dashboard password from URL
        const dashPass = url.searchParams.get('password');

        // NEW: Verify dashboard password
        if (dashPass !== process.env.DASHBOARD_PASSWORD) {
            console.log('❌ Unauthorized dashboard connection attempt (Wrong Password)');
            ws.close(1008, 'Unauthorized Dashboard Password');
            return;
        }

        console.log('🖥️ Dashboard connected!');
        dashSockets.add(ws);

        ws.on('message', (raw) => {
            try {
                const command = JSON.parse(raw);

                // The Dashboard must now send a "targetDeviceId" in the JSON command
                const targetDeviceId = command.targetDeviceId;

                if (!targetDeviceId) {
                    ws.send(JSON.stringify({ type: 'error', msg: 'Missing targetDeviceId in command' }));
                    return;
                }

                // Look up the specific phone in the Map
                const targetPhone = phoneSockets.get(targetDeviceId);

                if (targetPhone && targetPhone.readyState === WebSocket.OPEN) {
                    targetPhone.send(JSON.stringify(command));
                } else {
                    ws.send(JSON.stringify({ type: 'error', msg: `Phone '${targetDeviceId}' is offline` }));
                }

            } catch (e) { console.error('Dashboard error:', e); }
        });

        ws.on('close', () => {
            console.log('🖥️ Dashboard disconnected');
            dashSockets.delete(ws);
        });
        return;
    }

    ws.close(1000, 'Invalid endpoint');
});

// ---------- SERVE DASHBOARD HTML ----------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`✅ Relay running on port ${PORT}`);
});