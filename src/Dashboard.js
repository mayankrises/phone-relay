const loginSection = document.getElementById('loginSection');
const dashboardSection = document.getElementById('dashboardSection');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const deviceIdInput = document.getElementById('deviceIdInput');
const commandInput = document.getElementById('commandInput');
const sendBtn = document.getElementById('sendBtn');

let ws = null;
let authenticated = false;

function connectWebSocket() {
    const password = passwordInput.value;
    if (!password) {
        alert("Please enter the dashboard password.");
        return;
    }

    loginError.style.display = 'none';
    loginBtn.disabled = true;
    authenticated = false;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // No password in the URL — connect first, then authenticate
    // over the socket so the secret never lands in logs/history.
    const wsUrl = `${protocol}//${window.location.host}/dash`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', password }));
        passwordInput.value = '';
    };

    ws.onmessage = function (event) {
    try {
        const data = JSON.parse(event.data);

        // --- AUTH RESULT ---
        if (data.type === 'auth_result') {
            loginBtn.disabled = false;
            if (data.ok) {
                authenticated = true;
                loginSection.style.display = 'none';
                dashboardSection.style.display = 'block';
                statusEl.textContent = 'Connected';
                statusEl.className = 'connected';
                addMessage('Connected to Relay Server');
            } else {
                loginError.style.display = 'block';
            }
            return;
        }

        // --- DOWNLOAD DETECTION (any long Base64 string) ---
        // If it's a "phone_response" and data.data is a long string (>1000 chars)
        if (data.type === "phone_response" && data.data && typeof data.data === "string" && data.data.length > 1000) {
            const base64String = data.data;

            // Create a download link (generic binary)
            const link = document.createElement('a');
            link.href = 'data:application/octet-stream;base64,' + base64String;
            // Try to infer a filename from the command? We don't have it, so use a timestamp.
            link.download = 'downloaded_file_' + Date.now() + '.bin';
            link.textContent = '📥 Click to download the file (' + (base64String.length * 0.75 / 1024).toFixed(1) + ' KB)';
            link.style.display = 'block';
            link.style.margin = '10px 0';
            link.style.padding = '10px';
            link.style.background = '#28a745';
            link.style.color = 'white';
            link.style.borderRadius = '5px';
            link.style.textAlign = 'center';
            link.style.textDecoration = 'none';

            messagesEl.appendChild(link);
            messagesEl.scrollTop = messagesEl.scrollHeight;
            return; // Do not print the raw text
        }

        // --- NORMAL TEXT RESPONSES ---
        let displayText = event.data;
        if (data.type === "phone_response") {
            const responseText = typeof data.data === 'string' ? data.data : JSON.stringify(data.data, null, 2);
            displayText = `[${data.deviceId}] ${responseText}`;
        }
        addMessage(displayText);

    } catch (e) {
        // Fallback for non-JSON messages
        addMessage(event.data);
    }
};

    ws.onclose = () => {
        loginBtn.disabled = false;

        if (!authenticated) {
            loginError.style.display = 'block';
            return;
        }

        statusEl.textContent = 'Disconnected';
        statusEl.className = 'disconnected';
        addMessage('Disconnected from server');

        dashboardSection.style.display = 'none';
        loginSection.style.display = 'block';
        authenticated = false;
    };
}

loginBtn.onclick = connectWebSocket;
passwordInput.addEventListener("keypress", function (event) {
    if (event.key === "Enter") {
        connectWebSocket();
    }
});

function addMessage(text) {
    const p = document.createElement('p');
    p.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    messagesEl.appendChild(p);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

sendBtn.onclick = () => {
    const deviceId = deviceIdInput.value.trim();
    const cmd = commandInput.value.trim();

    if (!deviceId) {
        alert('Please enter a Target Device ID (e.g. Phone_A)');
        return;
    }

    if (cmd && ws && ws.readyState === WebSocket.OPEN) {
        const payload = JSON.stringify({
            targetDeviceId: deviceId,
            command: cmd
        });
        ws.send(payload);
        addMessage(`Sent to ${deviceId}: ${cmd}`);
        commandInput.value = '';
    } else {
        alert('Not connected or empty command');
    }
};