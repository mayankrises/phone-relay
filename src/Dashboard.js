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

            // --- AUTH RESULT: must be handled first, or the dashboard
            // never unlocks even when the password is correct ---
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

            // --- CHECK IF IT'S A HUGE IMAGE DOWNLOAD ---
            if (data.type === "phone_response" && data.data && typeof data.data === "string" && data.data.length > 200000) {
                // It's a large Base64 string (photo/video)
                const base64String = data.data;

                // Create a download link
                const link = document.createElement('a');
                link.href = 'data:image/jpeg;base64,' + base64String;
                link.download = 'downloaded_photo.jpg';
                link.textContent = '📸 Click here to download the photo (Right-click -> Save As)';
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
                return; // Stop here, don't print the raw text
            }

            // --- FOR SMALL TEXTS (PING, STATUS, FILES LIST) ---
            let displayText = event.data;
            if (data.type === "phone_response") {
                // If data.data is an object, stringify it; otherwise use it as-is.
                const responseText = typeof data.data === 'string' ? data.data : JSON.stringify(data.data, null, 2);
                displayText = `[${data.deviceId}] ${responseText}`;
            }
            addMessage(displayText);

        } catch (e) {
            // If it's not JSON, just print it as-is
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