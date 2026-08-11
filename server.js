const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');           // <-- NEW
const fs = require('fs');                   // <-- NEW

const app = express();

// ---------- STARTUP CHECKS ----------
if (!process.env.DASHBOARD_PASSWORD) {
    console.error("❌ FATAL ERROR: DASHBOARD_PASSWORD is not set in environment variables!");
    process.exit(1);
}
if (!process.env.PHONE_SECRET) {
    console.error("❌ FATAL ERROR: PHONE_SECRET is not set in environment variables!");
    process.exit(1);
}
if (process.env.DASHBOARD_PASSWORD.length < 12) {
    console.warn("⚠️  WARNING: DASHBOARD_PASSWORD is short. Use 16+ random characters.");
}
if (process.env.PHONE_SECRET.length < 20) {
    console.warn("⚠️  WARNING: PHONE_SECRET is short. Use a long random token (e.g. crypto.randomBytes(32).toString('hex')).");
}

const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_BYTES = 8 * 1024; // 8KB — plenty for control commands, blocks abuse
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COMMAND_RE = /^[A-Za-z0-9_\-.\/]{1,100}$/;

// ---------- BRUTE-FORCE PROTECTION ----------
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000;
const LOCKOUT_MS = 5 * 60 * 1000;

const attemptTracker = new Map();

function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    return (fwd ? fwd.split(',')[0].trim() : null) || req.socket.remoteAddress;
}

function isLockedOut(ip) {
    const rec = attemptTracker.get(ip);
    if (!rec) return false;
    if (rec.lockedUntil && Date.now() < rec.lockedUntil) return true;
    return false;
}

function recordFailure(ip) {
    const now = Date.now();
    let rec = attemptTracker.get(ip);
    if (!rec || now - rec.windowStart > WINDOW_MS) {
        rec = { count: 0, windowStart: now, lockedUntil: 0 };
    }
    rec.count += 1;
    if (rec.count >= MAX_ATTEMPTS) {
        rec.lockedUntil = now + LOCKOUT_MS;
        console.warn(`🔒 IP ${ip} locked out for ${LOCKOUT_MS / 1000}s after ${rec.count} failed auth attempts`);
    }
    attemptTracker.set(ip, rec);
}

function recordSuccess(ip) {
    attemptTracker.delete(ip);
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of attemptTracker.entries()) {
        if (now - rec.windowStart > WINDOW_MS && now > rec.lockedUntil) {
            attemptTracker.delete(ip);
        }
    }
}, 10 * 60 * 1000).unref();

// ---------- TIMING-SAFE COMPARE ----------
function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    const maxLen = Math.max(bufA.length, bufB.length, 1);
    const paddedA = Buffer.concat([bufA], maxLen);
    const paddedB = Buffer.concat([bufB], maxLen);
    const equalContent = crypto.timingSafeEqual(paddedA, paddedB);
    return equalContent && bufA.length === bufB.length;
}

// ---------- BASIC HTTP HARDENING ----------
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src * ws: wss:");
    next();
});

// ---------- FILE UPLOAD ENDPOINT (NEW) ----------
// Configure multer to save files to 'uploads/' folder
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // Keep original name with timestamp to avoid collisions
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + '-' + file.originalname);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB max
});

// POST /upload - accepts a single file with field name 'file'
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    // Construct the public URL
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    console.log(`📤 File uploaded: ${fileUrl}`);
    res.json({ url: fileUrl });
});

// Serve static files from the 'uploads' folder (so users can download)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------- STORE CONNECTIONS ----------
const phoneSockets = new Map();
const dashSockets = new Set();

// ---------- WEBSOCKET SERVER ----------
const server = require('http').createServer(app);

const wss = new WebSocket.Server({
    server,
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: (info, done) => {
        const ip = getClientIp(info.req);
        const url = new URL(info.req.url, `http://${info.req.headers.host}`);
        const pathname = url.pathname;

        if (isLockedOut(ip)) {
            console.warn(`🚫 Rejected connection from locked-out IP ${ip}`);
            return done(false, 429, 'Too Many Attempts');
        }

        if (pathname === '/dash') {
            return done(true);
        }

        if (pathname === '/phone') {
            const token = url.searchParams.get('token');
            const deviceId = url.searchParams.get('deviceId');

            if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
                recordFailure(ip);
                return done(false, 400, 'Invalid Device ID');
            }
            if (!token || !safeCompare(token, process.env.PHONE_SECRET)) {
                recordFailure(ip);
                console.log(`❌ Unauthorized phone connection attempt from ${ip}`);
                return done(false, 401, 'Unauthorized');
            }
            recordSuccess(ip);
            return done(true);
        }

        return done(false, 404, 'Not found');
    }
});

wss.on('connection', (ws, req) => {
    const ip = getClientIp(req);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // ---------------- PHONE ----------------
    if (pathname === '/phone') {
        const deviceId = url.searchParams.get('deviceId');

        console.log(`📱 Phone (${deviceId}) connected!`);
        phoneSockets.set(deviceId, ws);

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw);
            } catch (e) {
                console.error('Relay error: invalid JSON from phone', deviceId);
                return;
            }
            dashSockets.forEach(dash => {
                if (dash.readyState === WebSocket.OPEN && dash.authenticated) {
                    dash.send(JSON.stringify({ type: 'phone_response', deviceId, data: msg }));
                }
            });
        });

        ws.on('close', () => {
            console.log(`📱 Phone (${deviceId}) disconnected`);
            phoneSockets.delete(deviceId);
        });
        return;
    }

    // ---------------- DASHBOARD ----------------
    if (pathname === '/dash') {
        ws.authenticated = false;
        let authTimeout = setTimeout(() => {
            if (!ws.authenticated) {
                ws.close(1008, 'Auth timeout');
            }
        }, 5000);

        console.log(`🖥️ Dashboard socket opened from ${ip}, awaiting auth`);

        ws.on('message', (raw) => {
            if (!ws.authenticated) {
                if (isLockedOut(ip)) {
                    ws.close(1008, 'Too many attempts');
                    return;
                }
                let msg;
                try {
                    msg = JSON.parse(raw);
                } catch (e) {
                    recordFailure(ip);
                    ws.close(1008, 'Invalid auth message');
                    return;
                }

                if (msg.type !== 'auth' || typeof msg.password !== 'string') {
                    recordFailure(ip);
                    ws.close(1008, 'Invalid auth message');
                    return;
                }

                if (!safeCompare(msg.password, process.env.DASHBOARD_PASSWORD)) {
                    recordFailure(ip);
                    console.log(`❌ Unauthorized dashboard auth attempt from ${ip}`);
                    ws.send(JSON.stringify({ type: 'auth_result', ok: false }));
                    ws.close(1008, 'Unauthorized');
                    return;
                }

                recordSuccess(ip);
                clearTimeout(authTimeout);
                ws.authenticated = true;
                dashSockets.add(ws);
                console.log(`🖥️ Dashboard authenticated from ${ip}`);
                ws.send(JSON.stringify({ type: 'auth_result', ok: true }));
                return;
            }

            // ---- Already authenticated: handle commands ----
            let command;
            try {
                command = JSON.parse(raw);
            } catch (e) {
                ws.send(JSON.stringify({ type: 'error', msg: 'Invalid JSON' }));
                return;
            }

            const targetDeviceId = command.targetDeviceId;
            const cmdValue = command.command;

            if (!targetDeviceId || !DEVICE_ID_RE.test(targetDeviceId)) {
                ws.send(JSON.stringify({ type: 'error', msg: 'Missing or invalid targetDeviceId' }));
                return;
            }
            if (cmdValue !== undefined && !COMMAND_RE.test(cmdValue)) {
                ws.send(JSON.stringify({ type: 'error', msg: 'Invalid command format' }));
                return;
            }

            const targetPhone = phoneSockets.get(targetDeviceId);
            if (targetPhone && targetPhone.readyState === WebSocket.OPEN) {
                targetPhone.send(JSON.stringify({ targetDeviceId, command: cmdValue }));
            } else {
                ws.send(JSON.stringify({ type: 'error', msg: `Phone '${targetDeviceId}' is offline` }));
            }
        });

        ws.on('close', () => {
            clearTimeout(authTimeout);
            if (ws.authenticated) {
                console.log('🖥️ Dashboard disconnected');
            }
            dashSockets.delete(ws);
        });
        return;
    }
});

// ---------- SERVE DASHBOARD HTML + STATIC ASSETS ----------
app.use(express.static(path.join(__dirname, 'src')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`✅ Relay running on port ${PORT}`);
    console.log(`📤 Upload endpoint available at /upload`);
});