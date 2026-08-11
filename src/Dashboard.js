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

// Simple char whitelist matching the server's DEVICE_ID_RE / COMMAND_RE
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

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

    ws.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            addMessage(`Received: ${event.data}`);
            return;
        }

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

        if (data.deviceId) {
            addMessage(`📱 ${data.deviceId}: ${JSON.stringify(data.data)}`);
        } else {
            addMessage(`Server: ${JSON.stringify(data)}`);
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

    // UPDATED: Allow slashes (/) and dots (.) so you can download files and use endpoints like photo/front
    if (cmd && ws && ws.readyState === WebSocket.OPEN) {
        // If you want to be extra safe, you can check for dangerous patterns here, 
        // but you are the only one using this dashboard behind a password.
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