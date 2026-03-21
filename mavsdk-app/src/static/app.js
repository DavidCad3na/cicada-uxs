// ── UxS Command & Control — Frontend Logic ──────────────────────────────

// ── State ────────────────────────────────────────────────────────────────

let isConnected  = false;
let isListening  = false;
let isProcessing = false;
let dronePos     = { x: -40, y: 0, alt: 0 };
let droneState   = { armed: false, mode: 'UNKNOWN', battery: 100 };
let droneTrail   = [];
let mapZoom      = 1.0;
const MAX_TRAIL  = 200;

// ── Compound Layout (from challenge/config.py) ────────────────────────────

const LOCATIONS = [
    { name: 'Landing Pad',  x: -40,   y:   0,    type: 'waypoint'  },
    { name: 'West Gate',    x: -60,   y:   0,    type: 'waypoint'  },
    { name: 'NW Tower',     x: -57,   y:  37,    type: 'waypoint'  },
    { name: 'NE Tower',     x:  57,   y:  37,    type: 'waypoint'  },
    { name: 'SE Tower',     x:  57,   y: -37,    type: 'waypoint'  },
    { name: 'SW Tower',     x: -57,   y: -37,    type: 'waypoint'  },
    { name: 'Cmd Building', x:  20,   y:  10,    type: 'structure' },
    { name: 'Rooftop',      x:  25,   y:  14,    type: 'structure' },
    { name: 'Barracks 1',   x: -20,   y:  25,    type: 'structure' },
    { name: 'Barracks 2',   x: -20,   y: -25,    type: 'structure' },
    { name: 'Motor Pool',   x:  38,   y: -20,    type: 'structure' },
    { name: 'Containers',   x:   1.5, y: -16.5,  type: 'structure' },
    { name: 'Comms Tower',  x:  40,   y:  30,    type: 'caution'   },
    { name: 'Fuel Depot',   x: -27,   y: -32,    type: 'danger'    },
];

const NO_FLY_ZONES = [
    { name: 'Fuel Depot',  x: -27, y: -32, radius: 10, color: 'rgba(239,68,68,0.15)',  border: '#ef4444' },
    { name: 'Comms Tower', x:  40, y:  30, radius:  8, color: 'rgba(245,158,11,0.12)', border: '#f59e0b' },
];

// ── DOM Elements ──────────────────────────────────────────────────────────

const canvas        = document.getElementById('mapCanvas');
const ctx           = canvas.getContext('2d');
const micBtn        = document.getElementById('micBtn');
const textInput     = document.getElementById('textInput');
const logEntries    = document.getElementById('logEntries');
const transcriptEl  = document.getElementById('transcript');
const processingEl  = document.getElementById('processing');

// ── Timestamp (live clock in header) ─────────────────────────────────────

function updateTimestamp() {
    const el = document.getElementById('timestamp');
    if (el) el.textContent = new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}
updateTimestamp();
setInterval(updateTimestamp, 1000);

// ── Theme (lime = disarmed, amber = armed) ────────────────────────────────

function updateTheme(armed) {
    document.body.dataset.armed = armed ? 'true' : 'false';
}

// ── Map Rendering ─────────────────────────────────────────────────────────

function resizeCanvas() {
    const container = canvas.parentElement;
    canvas.width  = container.clientWidth  * window.devicePixelRatio;
    canvas.height = container.clientHeight * window.devicePixelRatio;
    canvas.style.width  = container.clientWidth  + 'px';
    canvas.style.height = container.clientHeight + 'px';
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

function enuToCanvas(xEnu, yEnu) {
    const dpr   = window.devicePixelRatio;
    const w     = canvas.width  / dpr;
    const h     = canvas.height / dpr;
    const pad   = 40;
    const scale = Math.min((w - 2 * pad) / 150, (h - 2 * pad) / 100) * mapZoom;
    return {
        px: w / 2 + xEnu * scale,
        py: h / 2 - yEnu * scale,   // canvas y is inverted
    };
}

function drawMap() {
    const dpr = window.devicePixelRatio;
    const w   = canvas.width  / dpr;
    const h   = canvas.height / dpr;

    // Background
    ctx.fillStyle = '#0f1923';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(45,58,77,0.4)';
    ctx.lineWidth = 0.5;
    for (let x = -70; x <= 70; x += 10) {
        const gridStart = enuToCanvas(x, -50);
        const gridEnd   = enuToCanvas(x,  50);
        ctx.beginPath(); ctx.moveTo(gridStart.px, gridStart.py); ctx.lineTo(gridEnd.px, gridEnd.py); ctx.stroke();
    }
    for (let y = -50; y <= 50; y += 10) {
        const gridStart = enuToCanvas(-70, y);
        const gridEnd   = enuToCanvas( 70, y);
        ctx.beginPath(); ctx.moveTo(gridStart.px, gridStart.py); ctx.lineTo(gridEnd.px, gridEnd.py); ctx.stroke();
    }

    // Compass labels
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    const northPt = enuToCanvas(0,  48); ctx.fillText('N', northPt.px, northPt.py - 4);
    const eastPt  = enuToCanvas(72,  0); ctx.fillText('E', eastPt.px,  eastPt.py);

    // Perimeter walls
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 2;
    const gateBottom = enuToCanvas(-57, -5);
    const gateTop    = enuToCanvas(-57,  5);

    ctx.beginPath();
    let point = enuToCanvas(-57,  37); ctx.moveTo(point.px, point.py);
    point     = enuToCanvas( 57,  37); ctx.lineTo(point.px, point.py);
    point     = enuToCanvas( 57, -37); ctx.lineTo(point.px, point.py);
    point     = enuToCanvas(-57, -37); ctx.lineTo(point.px, point.py);
    ctx.lineTo(gateBottom.px, gateBottom.py);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(gateTop.px, gateTop.py);
    point = enuToCanvas(-57, 37); ctx.lineTo(point.px, point.py);
    ctx.stroke();

    // Gate gap (dashed amber)
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(gateBottom.px, gateBottom.py);
    ctx.lineTo(gateTop.px,    gateTop.py);
    ctx.stroke();
    ctx.setLineDash([]);

    // No-fly zones
    for (const zone of NO_FLY_ZONES) {
        const zoneCenter = enuToCanvas(zone.x, zone.y);
        const zoneEdge   = enuToCanvas(zone.x + zone.radius, zone.y);
        const radiusPx   = zoneEdge.px - zoneCenter.px;

        ctx.fillStyle = zone.color;
        ctx.beginPath(); ctx.arc(zoneCenter.px, zoneCenter.py, radiusPx, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = zone.border;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 3]);
        ctx.beginPath(); ctx.arc(zoneCenter.px, zoneCenter.py, radiusPx, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = zone.border;
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('NO FLY ZONE', zoneCenter.px, zoneCenter.py - radiusPx - 4);
    }

    // Named locations
    for (const loc of LOCATIONS) {
        const locationPt = enuToCanvas(loc.x, loc.y);
        const color  = loc.type === 'structure' ? '#64748b' : loc.type === 'danger' ? '#ef4444' : '#f59e0b';
        const dotSize = loc.type === 'structure' ? 3 : 4;

        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(locationPt.px, locationPt.py, dotSize, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(loc.name, locationPt.px, locationPt.py - dotSize - 4);
    }

    // Drone trail
    if (droneTrail.length > 1) {
        ctx.strokeStyle = 'rgba(59,130,246,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let trailPt = enuToCanvas(droneTrail[0].x, droneTrail[0].y);
        ctx.moveTo(trailPt.px, trailPt.py);
        for (let index = 1; index < droneTrail.length; index++) {
            trailPt = enuToCanvas(droneTrail[index].x, droneTrail[index].y);
            ctx.lineTo(trailPt.px, trailPt.py);
        }
        ctx.stroke();
    }

    // Drone position
    const dronePt    = enuToCanvas(dronePos.x, dronePos.y);
    const glowRadius = 18 * Math.min(mapZoom, 1.5);

    const glowGradient = ctx.createRadialGradient(dronePt.px, dronePt.py, 0, dronePt.px, dronePt.py, glowRadius);
    glowGradient.addColorStop(0, 'rgba(34,197,94,0.3)');
    glowGradient.addColorStop(1, 'rgba(34,197,94,0)');
    ctx.fillStyle = glowGradient;
    ctx.beginPath(); ctx.arc(dronePt.px, dronePt.py, glowRadius, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#22c55e';
    ctx.beginPath(); ctx.arc(dronePt.px, dronePt.py, 5, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('α ' + dronePos.alt.toFixed(1) + 'm', dronePt.px, dronePt.py - 12);
}

// ── Zoom ──────────────────────────────────────────────────────────────────

function adjustZoom(delta) {
    mapZoom = Math.min(4.0, Math.max(0.4, parseFloat((mapZoom + delta).toFixed(2))));
    document.getElementById('zoomLabel').textContent = Math.round(mapZoom * 100) + '%';
    drawMap();
}

function resetZoom() {
    mapZoom = 1.0;
    document.getElementById('zoomLabel').textContent = '100%';
    drawMap();
}

canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    adjustZoom(-event.deltaY * 0.001);
}, { passive: false });

// ── SSE Telemetry ─────────────────────────────────────────────────────────

let evtSource = null;

function startTelemetry() {
    if (evtSource) evtSource.close();
    evtSource = new EventSource('/api/telemetry');
    evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.connected) {
            dronePos = { x: data.x || -40, y: data.y || 0, alt: data.alt || 0 };
            droneState = {
                armed:   data.armed || false,
                mode:    data.mode  || 'UNKNOWN',
                battery: data.battery != null ? data.battery : 100,
            };

            droneTrail.push({ x: dronePos.x, y: dronePos.y });
            if (droneTrail.length > MAX_TRAIL) droneTrail.shift();

            updateStatusPanel(data);
        }
        requestAnimationFrame(drawMap);
    };
}

function updateStatusPanel(data) {
    document.getElementById('sMode').textContent    = data.mode || '—';
    document.getElementById('sAlt').textContent     = (data.alt     || 0).toFixed(1) + 'm';
    document.getElementById('sPosX').textContent    = (data.x       || 0).toFixed(1);
    document.getElementById('sPosY').textContent    = (data.y       || 0).toFixed(1);
    document.getElementById('sHeading').textContent = (data.heading || 0).toFixed(0) + '°';

    const battery = data.battery != null ? data.battery : 100;
    const batEl   = document.getElementById('sBattery');
    batEl.textContent = battery + '%';
    batEl.className   = 'value' + (battery < 30 ? ' danger' : battery < 60 ? ' warning' : '');

    const gpsEl = document.getElementById('sGPS');
    gpsEl.textContent = data.gps_fix ? 'FIX' : 'NO FIX';
    gpsEl.className   = 'value' + (data.gps_fix ? '' : ' danger');

    // Armed badge + theme
    const armedBadge = document.getElementById('badgeArmed');
    if (data.armed) {
        armedBadge.textContent = 'ARMED';
        armedBadge.className   = 'badge armed';
    } else {
        armedBadge.textContent = 'DISARMED';
        armedBadge.className   = 'badge';
    }
    updateTheme(data.armed);
}

// ── Connection ────────────────────────────────────────────────────────────

async function connectDrone() {
    const btn = document.getElementById('connectBtn');
    btn.disabled    = true;
    btn.textContent = 'CONNECTING...';

    try {
        const resp = await fetch('/api/connect', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({}),
        });
        const data = await resp.json();
        if (data.status === 'connected') {
            isConnected = true;
            btn.textContent = '● CONNECTED';
            btn.classList.add('connected');

            document.getElementById('sysTag').textContent  = '[ SYS:ONLINE ]';
            document.getElementById('badgeConnected').textContent = 'CONNECTED';
            document.getElementById('badgeConnected').classList.add('connected');
            document.getElementById('sDroneId').textContent = (data.drone_id || 'Alpha').toUpperCase();

            addLogEntry('system', 'Connected — ' + (data.drone_id || 'Alpha'), '');
            startTelemetry();
        } else {
            btn.textContent = 'RETRY';
            btn.disabled    = false;
            addLogEntry('error', 'Failed to connect: ' + (data.message || 'Unknown error'), '');
        }
    } catch (error) {
        btn.textContent = 'RETRY';
        btn.disabled    = false;
        addLogEntry('error', 'Connection error: ' + error.message, '');
    }
}

// ── Command Submission ────────────────────────────────────────────────────

async function sendCommand(text) {
    if (!text.trim() || isProcessing) return;

    isProcessing = true;
    processingEl.classList.add('active');

    try {
        const resp = await fetch('/api/command', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ text: text.trim() }),
        });
        const data   = await resp.json();
        const status = data.status || 'unknown';
        addLogEntry(status, text.trim(), data.feedback || data.reason || '');
        if (data.feedback) speak(data.feedback);
    } catch (error) {
        addLogEntry('error', text.trim(), 'Error: ' + error.message);
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

textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendTextCommand();
    }
});

// ── Command Log ───────────────────────────────────────────────────────────

function addLogEntry(status, text, feedback) {
    const entry = document.createElement('div');
    entry.className = 'log-entry ' + status;
    const time = new Date().toISOString().slice(11, 19) + 'Z';
    entry.innerHTML =
        '<div class="log-time">'     + time              + '</div>' +
        '<div class="log-text">'     + escapeHtml(text)  + '</div>' +
        (feedback ? '<div class="log-feedback">' + escapeHtml(feedback) + '</div>' : '');
    logEntries.appendChild(entry);
    logEntries.scrollTop = logEntries.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ── Whisper Voice Input (server-side) ─────────────────────────────────────

async function toggleMic() {
    if (isListening) {
        transcriptEl.textContent = 'Stopping...';
        await fetch('/api/listen/stop', { method: 'POST' });
        return;
    }

    isListening = true;
    micBtn.classList.add('listening');
    transcriptEl.textContent = 'Listening...';

    try {
        const resp = await fetch('/api/listen', { method: 'POST' });
        const data = await resp.json();

        if (data.status === 'ok' && data.text) {
            transcriptEl.textContent = data.text;
            await sendCommand(data.text);
            setTimeout(() => { transcriptEl.textContent = ''; }, 2000);
        } else {
            transcriptEl.textContent = data.message || 'No speech detected.';
            setTimeout(() => { transcriptEl.textContent = ''; }, 3000);
        }
    } catch (error) {
        transcriptEl.textContent = 'Mic error: ' + error.message;
        setTimeout(() => { transcriptEl.textContent = ''; }, 3000);
    } finally {
        isListening = false;
        micBtn.classList.remove('listening');
    }
}

micBtn.addEventListener('click', toggleMic);

document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && document.activeElement !== textInput && !event.repeat) {
        event.preventDefault();
        toggleMic();
    }
});

// ── Browser TTS ───────────────────────────────────────────────────────────

function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate   = 1.05;
        utterance.pitch  = 0.95;
        utterance.volume = 0.9;
        window.speechSynthesis.speak(utterance);
    }
}

// ── Init ──────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => { resizeCanvas(); drawMap(); });
resizeCanvas();
drawMap();
