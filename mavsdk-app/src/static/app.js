// ── Voice Drone Operations Command Center — Frontend Logic ──

// ── State ───────────────────────────────────────────────────────────────

let isConnected = false;
let isListening = false;
let isProcessing = false;
let dronePos = { x: -40, y: 0, alt: 0 };
let droneState = { armed: false, mode: 'UNKNOWN', battery: 100 };
let droneTrail = [];
const MAX_TRAIL = 200;

// ── Compound Layout (from challenge/config.py) ──────────────────────────

const LOCATIONS = [
    { name: 'Landing Pad', x: -40, y: 0, type: 'waypoint' },
    { name: 'West Gate', x: -60, y: 0, type: 'waypoint' },
    { name: 'NW Tower', x: -57, y: 37, type: 'waypoint' },
    { name: 'NE Tower', x: 57, y: 37, type: 'waypoint' },
    { name: 'SE Tower', x: 57, y: -37, type: 'waypoint' },
    { name: 'SW Tower', x: -57, y: -37, type: 'waypoint' },
    { name: 'Cmd Building', x: 20, y: 10, type: 'structure' },
    { name: 'Rooftop', x: 25, y: 14, type: 'structure' },
    { name: 'Barracks 1', x: -20, y: 25, type: 'structure' },
    { name: 'Barracks 2', x: -20, y: -25, type: 'structure' },
    { name: 'Motor Pool', x: 38, y: -20, type: 'structure' },
    { name: 'Containers', x: 1.5, y: -16.5, type: 'structure' },
    { name: 'Comms Tower', x: 40, y: 30, type: 'caution' },
    { name: 'Fuel Depot', x: -27, y: -32, type: 'danger' },
];

const NO_GO_ZONES = [
    { name: 'Fuel Depot', x: -27, y: -32, radius: 10, color: 'rgba(239, 68, 68, 0.15)', border: '#ef4444' },
    { name: 'Comms Tower', x: 40, y: 30, radius: 8, color: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b' },
];

const PERIMETER = { minX: -60, maxX: 60, minY: -40, maxY: 40 };

// ── DOM Elements ────────────────────────────────────────────────────────

const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
const micBtn = document.getElementById('micBtn');
const textInput = document.getElementById('textInput');
const logEntries = document.getElementById('logEntries');
const transcriptEl = document.getElementById('transcript');
const processingEl = document.getElementById('processing');
const statusDot = document.getElementById('statusDot');
const connectionText = document.getElementById('connectionText');

// ── Map Rendering ───────────────────────────────────────────────────────

function resizeCanvas() {
    const container = canvas.parentElement;
    canvas.width = container.clientWidth * window.devicePixelRatio;
    canvas.height = container.clientHeight * window.devicePixelRatio;
    canvas.style.width = container.clientWidth + 'px';
    canvas.style.height = container.clientHeight + 'px';
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

function enuToCanvas(x_enu, y_enu) {
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;
    const pad = 40;
    const rangeX = 150; // -75 to 75
    const rangeY = 100; // -50 to 50
    const scale = Math.min((w - 2 * pad) / rangeX, (h - 2 * pad) / rangeY);
    const cx = w / 2;
    const cy = h / 2;
    return {
        px: cx + x_enu * scale,
        py: cy - y_enu * scale  // canvas y is inverted
    };
}

function drawMap() {
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;

    // Background
    ctx.fillStyle = '#0f1923';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(45, 58, 77, 0.4)';
    ctx.lineWidth = 0.5;
    for (let x = -70; x <= 70; x += 10) {
        const p1 = enuToCanvas(x, -50);
        const p2 = enuToCanvas(x, 50);
        ctx.beginPath(); ctx.moveTo(p1.px, p1.py); ctx.lineTo(p2.px, p2.py); ctx.stroke();
    }
    for (let y = -50; y <= 50; y += 10) {
        const p1 = enuToCanvas(-70, y);
        const p2 = enuToCanvas(70, y);
        ctx.beginPath(); ctx.moveTo(p1.px, p1.py); ctx.lineTo(p2.px, p2.py); ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    const nLabel = enuToCanvas(0, 48);
    ctx.textAlign = 'center';
    ctx.fillText('N', nLabel.px, nLabel.py - 4);
    const eLabel = enuToCanvas(72, 0);
    ctx.fillText('E', eLabel.px, eLabel.py);

    // Compound perimeter walls
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 2;
    const corners = [[-57, 37], [57, 37], [57, -37], [-57, -37]];
    ctx.beginPath();
    // North wall
    let p = enuToCanvas(-57, 37); ctx.moveTo(p.px, p.py);
    p = enuToCanvas(57, 37); ctx.lineTo(p.px, p.py);
    // East wall
    p = enuToCanvas(57, -37); ctx.lineTo(p.px, p.py);
    // South wall
    p = enuToCanvas(-57, -37); ctx.lineTo(p.px, p.py);
    // West wall (with gate gap)
    p = enuToCanvas(-57, -37); // already here
    const gateBottom = enuToCanvas(-57, -5);
    ctx.lineTo(gateBottom.px, gateBottom.py);
    ctx.stroke();
    // West wall above gate
    ctx.beginPath();
    const gateTop = enuToCanvas(-57, 5);
    ctx.moveTo(gateTop.px, gateTop.py);
    p = enuToCanvas(-57, 37);
    ctx.lineTo(p.px, p.py);
    ctx.stroke();

    // Gate indicator
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(gateBottom.px, gateBottom.py);
    ctx.lineTo(gateTop.px, gateTop.py);
    ctx.stroke();
    ctx.setLineDash([]);

    // No-go zones
    for (const zone of NO_GO_ZONES) {
        const c = enuToCanvas(zone.x, zone.y);
        const edgeP = enuToCanvas(zone.x + zone.radius, zone.y);
        const r = edgeP.px - c.px;

        // Fill
        ctx.fillStyle = zone.color;
        ctx.beginPath();
        ctx.arc(c.px, c.py, r, 0, Math.PI * 2);
        ctx.fill();

        // Border
        ctx.strokeStyle = zone.border;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.arc(c.px, c.py, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = zone.border;
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('NO-GO', c.px, c.py - r - 4);
    }

    // Named locations
    for (const loc of LOCATIONS) {
        const p = enuToCanvas(loc.x, loc.y);
        let color = '#f59e0b';
        let size = 3;
        if (loc.type === 'structure') { color = '#64748b'; size = 3; }
        if (loc.type === 'danger') { color = '#ef4444'; size = 4; }
        if (loc.type === 'caution') { color = '#f59e0b'; size = 4; }
        if (loc.type === 'waypoint') { color = '#f59e0b'; size = 3.5; }

        // Dot
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.px, p.py, size, 0, Math.PI * 2);
        ctx.fill();

        // Label
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(loc.name, p.px, p.py - size - 4);
    }

    // Drone trail
    if (droneTrail.length > 1) {
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let tp = enuToCanvas(droneTrail[0].x, droneTrail[0].y);
        ctx.moveTo(tp.px, tp.py);
        for (let i = 1; i < droneTrail.length; i++) {
            tp = enuToCanvas(droneTrail[i].x, droneTrail[i].y);
            ctx.lineTo(tp.px, tp.py);
        }
        ctx.stroke();
    }

    // Drone position
    const dp = enuToCanvas(dronePos.x, dronePos.y);

    // Glow
    const glow = ctx.createRadialGradient(dp.px, dp.py, 0, dp.px, dp.py, 18);
    glow.addColorStop(0, 'rgba(34, 197, 94, 0.3)');
    glow.addColorStop(1, 'rgba(34, 197, 94, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(dp.px, dp.py, 18, 0, Math.PI * 2);
    ctx.fill();

    // Drone dot
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(dp.px, dp.py, 5, 0, Math.PI * 2);
    ctx.fill();

    // Drone label
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${dronePos.alt.toFixed(1)}m`, dp.px, dp.py - 10);
}

// ── SSE Telemetry ───────────────────────────────────────────────────────

let evtSource = null;

function startTelemetry() {
    if (evtSource) evtSource.close();
    evtSource = new EventSource('/api/telemetry');
    evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.connected) {
            dronePos = { x: data.x || -40, y: data.y || 0, alt: data.alt || 0 };
            droneState = {
                armed: data.armed || false,
                mode: data.mode || 'UNKNOWN',
                battery: data.battery != null ? data.battery : 100,
            };

            // Update trail
            droneTrail.push({ x: dronePos.x, y: dronePos.y });
            if (droneTrail.length > MAX_TRAIL) droneTrail.shift();

            updateStatusPanel(data);
        }
        drawMap();
    };
    evtSource.onerror = () => {
        // SSE will auto-reconnect
    };
}

function updateStatusPanel(data) {
    document.getElementById('sMode').textContent = data.mode || '—';
    document.getElementById('sArmed').textContent = data.armed ? 'YES' : 'NO';
    document.getElementById('sArmed').className = 'value' + (data.armed ? '' : ' warning');
    document.getElementById('sAlt').textContent = (data.alt || 0).toFixed(1) + 'm';
    document.getElementById('sPosX').textContent = (data.x || 0).toFixed(1);
    document.getElementById('sPosY').textContent = (data.y || 0).toFixed(1);
    document.getElementById('sHeading').textContent = (data.heading || 0).toFixed(0) + '\u00B0';
    const bat = data.battery != null ? data.battery : 100;
    document.getElementById('sBattery').textContent = bat + '%';
    document.getElementById('sBattery').className = 'value' + (bat < 30 ? ' danger' : bat < 60 ? ' warning' : '');
    document.getElementById('sGPS').textContent = data.gps_fix ? 'Fix' : 'No Fix';
    document.getElementById('sGPS').className = 'value' + (data.gps_fix ? '' : ' danger');
}

// ── Connection ──────────────────────────────────────────────────────────

async function connectDrone() {
    const btn = document.getElementById('connectBtn');
    btn.disabled = true;
    btn.textContent = 'Connecting...';

    try {
        const resp = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await resp.json();
        if (data.status === 'connected') {
            isConnected = true;
            statusDot.classList.add('connected');
            connectionText.textContent = 'Connected — ' + data.drone_id;
            btn.textContent = 'Connected';
            addLogEntry('system', 'Connected to SITL. Ready for commands.', '');
            startTelemetry();
        } else {
            btn.textContent = 'Retry';
            btn.disabled = false;
            addLogEntry('error', 'Failed to connect: ' + (data.message || 'Unknown error'), '');
        }
    } catch (e) {
        btn.textContent = 'Retry';
        btn.disabled = false;
        addLogEntry('error', 'Connection error: ' + e.message, '');
    }
}

// ── Command Submission ──────────────────────────────────────────────────

async function sendCommand(text) {
    if (!text.trim() || isProcessing) return;

    isProcessing = true;
    processingEl.classList.add('active');

    try {
        const resp = await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text.trim() })
        });
        const data = await resp.json();

        const status = data.status || 'unknown';
        addLogEntry(status, text.trim(), data.feedback || data.reason || '');

        // Browser TTS feedback
        if (data.feedback) {
            speak(data.feedback);
        }
    } catch (e) {
        addLogEntry('error', text.trim(), 'Error: ' + e.message);
    }

    isProcessing = false;
    processingEl.classList.remove('active');
}

function sendTextCommand() {
    const text = textInput.value;
    if (text.trim()) {
        sendCommand(text);
        textInput.value = '';
    }
}

// Enter key to send
textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendTextCommand();
    }
});

// ── Command Log ─────────────────────────────────────────────────────────

function addLogEntry(status, text, feedback) {
    const entry = document.createElement('div');
    entry.className = 'log-entry ' + status;
    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `
        <div class="log-time">${time}</div>
        <div class="log-text">${escapeHtml(text)}</div>
        ${feedback ? `<div class="log-feedback">${escapeHtml(feedback)}</div>` : ''}
    `;
    logEntries.appendChild(entry);
    logEntries.scrollTop = logEntries.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ── Web Speech API ──────────────────────────────────────────────────────

let recognition = null;

if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        transcriptEl.textContent = transcript;
        if (event.results[0].isFinal) {
            sendCommand(transcript);
            setTimeout(() => { transcriptEl.textContent = ''; }, 2000);
        }
    };

    recognition.onend = () => {
        isListening = false;
        micBtn.classList.remove('listening');
    };

    recognition.onerror = (event) => {
        isListening = false;
        micBtn.classList.remove('listening');
        if (event.error !== 'no-speech') {
            transcriptEl.textContent = 'Mic error: ' + event.error;
            setTimeout(() => { transcriptEl.textContent = ''; }, 3000);
        }
    };
}

function toggleMic() {
    if (!recognition) {
        transcriptEl.textContent = 'Speech not supported';
        return;
    }
    if (isListening) {
        recognition.stop();
    } else {
        isListening = true;
        micBtn.classList.add('listening');
        transcriptEl.textContent = 'Listening...';
        recognition.start();
    }
}

micBtn.addEventListener('click', toggleMic);

// Spacebar push-to-talk (only when not focused on text input)
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement !== textInput) {
        e.preventDefault();
        if (!isListening) toggleMic();
    }
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && document.activeElement !== textInput) {
        e.preventDefault();
        if (isListening) recognition.stop();
    }
});

// ── Browser TTS ─────────────────────────────────────────────────────────

function speak(text) {
    if ('speechSynthesis' in window) {
        // Cancel any current speech
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.05;
        utterance.pitch = 0.95;
        utterance.volume = 0.9;
        window.speechSynthesis.speak(utterance);
    }
}

// ── Init ────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => { resizeCanvas(); drawMap(); });
resizeCanvas();
drawMap();
