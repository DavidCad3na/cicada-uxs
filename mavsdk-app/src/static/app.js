// ── UxS Command & Control — Frontend Logic ──────────────────────────────

// ── State ────────────────────────────────────────────────────────────────

let activeDroneId = 'Alpha';
let connectedDrones = new Set();
let isListening  = false;
let isProcessing = false;
let mapZoom      = 1.0;
const MAX_TRAIL  = 200;

// Pending entries awaiting confirmation resolution
const pendingEntries = new Map();  // id -> DOM element
let pendingCounter = 0;

// Active confirmation state
let pendingConfirmation = null;  // { text, droneId, entryId, resolve }

// ── Per-drone telemetry + render state ───────────────────────────────────

const DRONE = {
    Alpha: {
        pos:        { x: -40, y: 0, alt: 0 },
        state:      { armed: false, mode: 'UNKNOWN', battery: 100 },
        gps:        { lat: null, lon: null, fix: false },
        trail:      [],
        color:      '#22c55e',
        glowStart:  'rgba(34,197,94,0.3)',
        glowEnd:    'rgba(34,197,94,0)',
        trailColor: 'rgba(59,130,246,0.3)',
        label:      '\u03b1',   // α
        evtSource:  null,
    },
    Bravo: {
        pos:        { x: -40, y: 5, alt: 0 },
        state:      { armed: false, mode: 'UNKNOWN', battery: 100 },
        gps:        { lat: null, lon: null, fix: false },
        trail:      [],
        color:      '#38bdf8',
        glowStart:  'rgba(56,189,248,0.3)',
        glowEnd:    'rgba(56,189,248,0)',
        trailColor: 'rgba(56,189,248,0.25)',
        label:      '\u03b2',   // β
        evtSource:  null,
    },
};

// ── Compound Layout ───────────────────────────────────────────────────────

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
    { name: 'Missile Rack', x:  42,   y: -18,    type: 'caution'   },
    { name: 'Cobra-6',      x:  35,   y: -22,    type: 'hostile'   },
    { name: 'Ghost-7',      x: -55,   y:   5,    type: 'unknown'   },
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
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmTitle   = document.getElementById('confirmTitle');
const confirmBody    = document.getElementById('confirmBody');
const confirmYes     = document.getElementById('confirmYes');
const confirmNo      = document.getElementById('confirmNo');

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

// ── Sys tag ───────────────────────────────────────────────────────────────

function updateSysTag() {
    const n = connectedDrones.size;
    const el = document.getElementById('sysTag');
    if (n === 0)      el.textContent = '[ SYS:STANDBY ]';
    else if (n === 1) el.textContent = '[ SYS:ONLINE ]';
    else              el.textContent = '[ SYS:ONLINE \u00d7' + n + ' ]';  // ×
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
        py: h / 2 - yEnu * scale,
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
        const s = enuToCanvas(x, -50), e = enuToCanvas(x, 50);
        ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(e.px, e.py); ctx.stroke();
    }
    for (let y = -50; y <= 50; y += 10) {
        const s = enuToCanvas(-70, y), e = enuToCanvas(70, y);
        ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(e.px, e.py); ctx.stroke();
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
    let pt = enuToCanvas(-57, 37); ctx.moveTo(pt.px, pt.py);
    pt = enuToCanvas( 57,  37); ctx.lineTo(pt.px, pt.py);
    pt = enuToCanvas( 57, -37); ctx.lineTo(pt.px, pt.py);
    pt = enuToCanvas(-57, -37); ctx.lineTo(pt.px, pt.py);
    ctx.lineTo(gateBottom.px, gateBottom.py);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(gateTop.px, gateTop.py);
    pt = enuToCanvas(-57, 37); ctx.lineTo(pt.px, pt.py);
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
        const zc = enuToCanvas(zone.x, zone.y);
        const ze = enuToCanvas(zone.x + zone.radius, zone.y);
        const r  = ze.px - zc.px;

        ctx.fillStyle = zone.color;
        ctx.beginPath(); ctx.arc(zc.px, zc.py, r, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = zone.border;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 3]);
        ctx.beginPath(); ctx.arc(zc.px, zc.py, r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = zone.border;
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('NO FLY ZONE', zc.px, zc.py - r - 4);
    }

    // Named locations
    for (const loc of LOCATIONS) {
        const lp = enuToCanvas(loc.x, loc.y);
        let color, dotSize, square = false;

        switch (loc.type) {
            case 'hostile':   color = '#ef4444'; dotSize = 5; square = true; break;
            case 'unknown':   color = '#fbbf24'; dotSize = 5; square = true; break;
            case 'danger':    color = '#ef4444'; dotSize = 4; break;
            case 'caution':   color = '#f59e0b'; dotSize = 4; break;
            case 'structure': color = '#64748b'; dotSize = 3; break;
            default:          color = '#f59e0b'; dotSize = 4;
        }

        ctx.fillStyle = color;
        if (square) {
            ctx.fillRect(lp.px - dotSize / 2, lp.py - dotSize / 2, dotSize, dotSize);
        } else {
            ctx.beginPath(); ctx.arc(lp.px, lp.py, dotSize, 0, Math.PI * 2); ctx.fill();
        }

        ctx.fillStyle = color;
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(loc.name, lp.px, lp.py - dotSize - 4);
    }

    // Drone trails
    for (const drone of Object.values(DRONE)) {
        if (drone.trail.length < 2) continue;
        ctx.strokeStyle = drone.trailColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let tp = enuToCanvas(drone.trail[0].x, drone.trail[0].y);
        ctx.moveTo(tp.px, tp.py);
        for (let i = 1; i < drone.trail.length; i++) {
            tp = enuToCanvas(drone.trail[i].x, drone.trail[i].y);
            ctx.lineTo(tp.px, tp.py);
        }
        ctx.stroke();
    }

    // Drone markers (on top of trails)
    for (const [id, drone] of Object.entries(DRONE)) {
        if (!connectedDrones.has(id)) continue;

        const dp = enuToCanvas(drone.pos.x, drone.pos.y);
        const glowRadius = 18 * Math.min(mapZoom, 1.5);

        const glow = ctx.createRadialGradient(dp.px, dp.py, 0, dp.px, dp.py, glowRadius);
        glow.addColorStop(0, drone.glowStart);
        glow.addColorStop(1, drone.glowEnd);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(dp.px, dp.py, glowRadius, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = drone.color;
        ctx.beginPath(); ctx.arc(dp.px, dp.py, 5, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = drone.color;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(drone.label + ' ' + drone.pos.alt.toFixed(1) + 'm', dp.px, dp.py - 12);
    }
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

function startTelemetry(droneId) {
    const drone = DRONE[droneId];
    if (drone.evtSource) drone.evtSource.close();

    drone.evtSource = new EventSource('/api/telemetry?drone=' + droneId);
    drone.evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.connected) {
            drone.pos   = { x: data.x || drone.pos.x, y: data.y || drone.pos.y, alt: data.alt || 0 };
            drone.state = {
                armed:   data.armed   || false,
                mode:    data.mode    || 'UNKNOWN',
                battery: data.battery != null ? data.battery : 100,
            };
            drone.gps = {
                lat: data.lat != null ? data.lat : null,
                lon: data.lon != null ? data.lon : null,
                fix: data.gps_fix || false,
            };

            drone.trail.push({ x: drone.pos.x, y: drone.pos.y });
            if (drone.trail.length > MAX_TRAIL) drone.trail.shift();

            updateStatusPanel(data, droneId);
            updateTheme(DRONE.Alpha.state.armed || DRONE.Bravo.state.armed);
        }
        requestAnimationFrame(drawMap);
    };
}

function updateStatusPanel(data, droneId) {
    const p  = droneId === 'Alpha' ? 's' : 'b';
    const el = (id) => document.getElementById(p + id);

    el('Mode').textContent    = data.mode || '—';
    el('Alt').textContent     = (data.alt     || 0).toFixed(1) + 'm';
    el('PosX').textContent    = (data.x       || 0).toFixed(1);
    el('PosY').textContent    = (data.y       || 0).toFixed(1);
    el('Heading').textContent = (data.heading || 0).toFixed(0) + '\u00b0';

    const battery = data.battery != null ? data.battery : 100;
    const batEl   = el('Battery');
    batEl.textContent = battery + '%';
    batEl.className   = 'value' + (battery < 20 ? ' danger' : battery < 50 ? ' warning' : '');

    // Battery progress bar
    const barEl = document.getElementById(p + 'BatteryBar');
    if (barEl) {
        barEl.style.width = battery + '%';
        barEl.className = 'battery-bar' + (battery < 20 ? ' danger' : battery < 50 ? ' warning' : '');
    }

    const gpsEl = el('GPS');
    gpsEl.textContent = data.gps_fix ? 'FIX' : 'NO FIX';
    gpsEl.className   = 'value' + (data.gps_fix ? '' : ' danger');

    // Lat/Lon display
    const latLonEl = el('LatLon');
    if (latLonEl) {
        if (data.lat != null && data.lon != null) {
            latLonEl.textContent = data.lat.toFixed(6) + ', ' + data.lon.toFixed(6);
        } else {
            latLonEl.textContent = '—';
        }
    }
}

// ── Connection ────────────────────────────────────────────────────────────

async function connectDrone(droneId) {
    const btnId = droneId === 'Alpha' ? 'connectBtnAlpha' : 'connectBtnBravo';
    const btn   = document.getElementById(btnId);
    btn.disabled    = true;
    btn.textContent = 'CONNECTING...';

    try {
        const sysid = droneId === 'Alpha' ? 1 : 2;
        const resp = await fetch('/api/connect', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ drone_id: droneId, sysid: sysid }),
        });
        const data = await resp.json();

        if (data.status === 'connected') {
            connectedDrones.add(droneId);
            btn.textContent = '\u25cf ' + droneId.toUpperCase();
            btn.classList.add('connected');

            const badgeId = droneId === 'Alpha' ? 'badgeAlphaConnected' : 'badgeBravoConnected';
            const badge   = document.getElementById(badgeId);
            badge.textContent = 'CONNECTED';
            badge.classList.add('connected');

            updateSysTag();
            addLogEntry({ status: 'system', text: 'Connected \u2014 ' + droneId.toUpperCase() });
            startTelemetry(droneId);
        } else {
            btn.textContent = droneId.toUpperCase();
            btn.disabled    = false;
            addLogEntry({ status: 'error', text: 'Failed to connect ' + droneId + ': ' + (data.message || 'Unknown error') });
        }
    } catch (err) {
        btn.textContent = droneId.toUpperCase();
        btn.disabled    = false;
        addLogEntry({ status: 'error', text: 'Connection error (' + droneId + '): ' + err.message });
    }
}

// ── Drone Selector ────────────────────────────────────────────────────────

function setActiveDrone(droneId) {
    activeDroneId = droneId;
    document.getElementById('selectorAlpha').classList.toggle('active', droneId === 'Alpha');
    document.getElementById('selectorBravo').classList.toggle('active', droneId === 'Bravo');
}

// ── Confirmation Modal ───────────────────────────────────────────────────

function showConfirmation(message, detail) {
    return new Promise((resolve) => {
        confirmTitle.textContent = 'CONFIRM ACTION';
        confirmBody.innerHTML = escapeHtml(message) +
            (detail ? '<span class="confirm-target">' + escapeHtml(detail) + '</span>' : '');
        confirmOverlay.classList.add('active');

        const cleanup = () => {
            confirmOverlay.classList.remove('active');
            confirmYes.removeEventListener('click', onConfirm);
            confirmNo.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKey);
        };

        const onConfirm = () => { cleanup(); resolve(true); };
        const onCancel  = () => { cleanup(); resolve(false); };
        const onKey = (e) => {
            if (e.key === 'Enter') onConfirm();
            else if (e.key === 'Escape') onCancel();
        };

        confirmYes.addEventListener('click', onConfirm);
        confirmNo.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey);
    });
}

// ── Command Submission ────────────────────────────────────────────────────

async function sendCommand(rawText) {
    if (!rawText.trim() || isProcessing) return;

    isProcessing = true;
    processingEl.classList.add('active');

    const trimmed = rawText.trim();

    try {
        const resp = await fetch('/api/command', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ text: trimmed, drone_id: activeDroneId }),
        });
        const data = await resp.json();
        const status = data.status || 'unknown';

        // Map backend statuses to our display statuses
        const entryData = {
            rawTranscript: trimmed,
            parsedAction:  data.parsed_action || data.action || null,
            droneId:       activeDroneId,
            feedback:      data.feedback || '',
            reason:        data.reason || '',
            safetyDecision: data.safety_decision || data.iff_status || null,
            target:        data.target || null,
            resolvedGps:   data.resolved_gps || null,
        };

        // Handle different response statuses
        if (status === 'confirm_required' || status === 'confirmation_required') {
            // Show as pending, then prompt confirmation
            const entryId = addLogEntry({
                status: 'pending',
                badge: 'PENDING',
                ...entryData,
            });

            isProcessing = false;
            processingEl.classList.remove('active');

            const confirmMsg = data.confirm_message || 'Confirm action on ' + (data.target || 'target') + '?';
            const confirmed = await showConfirmation(confirmMsg, data.target || entryData.parsedAction);

            if (confirmed) {
                // Re-send with confirmed flag
                isProcessing = true;
                processingEl.classList.add('active');

                try {
                    const confirmResp = await fetch('/api/command', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: trimmed, drone_id: activeDroneId, confirmed: true }),
                    });
                    const confirmData = await confirmResp.json();
                    updatePendingEntry(entryId, confirmData.status === 'approved' ? 'approved' : (confirmData.status || 'approved'), 'EXECUTED',
                        confirmData.feedback || 'Confirmed and executed');
                    if (confirmData.feedback) speak(confirmData.feedback);
                } catch (err) {
                    updatePendingEntry(entryId, 'error', 'ERROR', 'Confirmation failed: ' + err.message);
                }

                isProcessing = false;
                processingEl.classList.remove('active');
            } else {
                updatePendingEntry(entryId, 'cancelled', 'CANCELLED', 'Action cancelled by operator');
            }
            return;

        } else if (status === 'approved' || status === 'executed') {
            addLogEntry({ status: 'approved', badge: 'EXECUTED', ...entryData });

        } else if (status === 'rejected' || status === 'blocked') {
            addLogEntry({ status: 'blocked', badge: 'BLOCKED', ...entryData });

        } else if (status === 'not_supported') {
            addLogEntry({
                status: 'not_supported',
                badge: 'NOT SUPPORTED',
                ...entryData,
                feedback: data.feedback || 'Command not supported',
            });

        } else if (status === 'not_found') {
            addLogEntry({
                status: 'not_found',
                badge: 'NOT FOUND',
                ...entryData,
                feedback: data.feedback || 'Location not found',
            });

        } else if (status === 'iff_unknown') {
            // Unknown IFF — needs confirmation
            const entryId = addLogEntry({
                status: 'pending',
                badge: 'PENDING',
                ...entryData,
                safetyDecision: 'UNKNOWN — NOT IN IFF DATABASE',
            });

            isProcessing = false;
            processingEl.classList.remove('active');

            const confirmed = await showConfirmation(
                'Target not in IFF database. Proceed with action?',
                data.target || entryData.parsedAction
            );

            if (confirmed) {
                isProcessing = true;
                processingEl.classList.add('active');
                try {
                    const confirmResp = await fetch('/api/command', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: trimmed, drone_id: activeDroneId, confirmed: true }),
                    });
                    const confirmData = await confirmResp.json();
                    updatePendingEntry(entryId, 'approved', 'EXECUTED', confirmData.feedback || 'Confirmed and executed');
                    if (confirmData.feedback) speak(confirmData.feedback);
                } catch (err) {
                    updatePendingEntry(entryId, 'error', 'ERROR', 'Error: ' + err.message);
                }
                isProcessing = false;
                processingEl.classList.remove('active');
            } else {
                updatePendingEntry(entryId, 'cancelled', 'CANCELLED', 'Action cancelled by operator');
            }
            return;

        } else if (status === 'parse_error' || status === 'parse_fail') {
            addLogEntry({
                status: 'parse_fail',
                badge: 'PARSE FAIL',
                rawTranscript: trimmed,
                parsedAction: null,
                droneId: activeDroneId,
                feedback: data.feedback || 'Could not parse speech input',
            });

        } else if (status === 'query' || status === 'telemetry_response') {
            addLogEntry({
                status: 'query',
                badge: 'QUERY',
                ...entryData,
                feedback: data.feedback || data.response || '',
            });

        } else {
            // Default fallback
            addLogEntry({ status: status, badge: mapStatusToBadge(status), ...entryData });
        }

        if (data.feedback) speak(data.feedback);

    } catch (err) {
        addLogEntry({
            status: 'error',
            badge: 'ERROR',
            rawTranscript: trimmed,
            droneId: activeDroneId,
            feedback: 'Error: ' + err.message,
        });
    }

    isProcessing = false;
    processingEl.classList.remove('active');
}

function mapStatusToBadge(status) {
    const map = {
        approved: 'EXECUTED', executed: 'EXECUTED', executing: 'EXECUTING',
        rejected: 'BLOCKED', blocked: 'BLOCKED',
        error: 'ERROR', system: '',
        pending: 'PENDING', cancelled: 'CANCELLED',
        query: 'QUERY', telemetry_response: 'QUERY',
        not_supported: 'NOT SUPPORTED', not_found: 'NOT FOUND',
        parse_fail: 'PARSE FAIL', parse_error: 'PARSE FAIL',
    };
    return map[status] || status.toUpperCase();
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

function addLogEntry(opts) {
    // opts: { status, badge, rawTranscript, parsedAction, droneId, feedback, reason, safetyDecision, target, text, resolvedGps }
    const entry = document.createElement('div');
    const statusClass = (opts.status || 'system').replace(/\s+/g, '_');
    entry.className = 'log-entry ' + statusClass;

    const entryId = 'log-' + (++pendingCounter);
    entry.id = entryId;

    const time = new Date().toISOString().slice(11, 19) + 'Z';
    const badge = opts.badge || '';
    const badgeClass = badgeToCssClass(badge);

    let html = '<div class="log-header">' +
        '<span class="log-time">' + time + (opts.droneId ? ' [' + opts.droneId + ']' : '') + '</span>' +
        (badge ? '<span class="result-badge ' + badgeClass + '">' + escapeHtml(badge) + '</span>' : '') +
        '</div>';

    // Simple system/error entries with just text
    if (opts.text && !opts.rawTranscript) {
        html += '<div class="log-text">' + escapeHtml(opts.text) + '</div>';
    } else {
        // Raw transcript (always shown)
        if (opts.rawTranscript) {
            html += '<div class="log-raw"><span class="raw-label">STT:</span>' + escapeHtml(opts.rawTranscript) + '</div>';
        }
        // Parsed action (shown below raw if different)
        if (opts.parsedAction && opts.parsedAction !== opts.rawTranscript) {
            html += '<div class="log-text">' + escapeHtml(opts.parsedAction) + '</div>';
        }
    }

    // Safety decision
    if (opts.safetyDecision) {
        const iffClass = getIffClass(opts.safetyDecision);
        html += '<div class="log-safety ' + iffClass + '">IFF: ' + escapeHtml(opts.safetyDecision) + '</div>';
    }

    // Blocked reason
    if (opts.reason) {
        html += '<div class="log-reason">' + escapeHtml(opts.reason) + '</div>';
    }

    // Resolved GPS
    if (opts.resolvedGps) {
        html += '<div class="log-feedback">GPS: ' + escapeHtml(opts.resolvedGps) + '</div>';
    }

    // Feedback
    if (opts.feedback) {
        html += '<div class="log-feedback">' + escapeHtml(opts.feedback) + '</div>';
    }

    entry.innerHTML = html;
    logEntries.appendChild(entry);
    logEntries.scrollTop = logEntries.scrollHeight;

    // Track pending entries
    if (opts.status === 'pending') {
        pendingEntries.set(entryId, entry);
    }

    return entryId;
}

function updatePendingEntry(entryId, newStatus, newBadge, newFeedback) {
    const entry = document.getElementById(entryId);
    if (!entry) return;

    // Update status class
    entry.className = 'log-entry ' + newStatus;

    // Update badge
    const badgeEl = entry.querySelector('.result-badge');
    if (badgeEl) {
        badgeEl.textContent = newBadge;
        badgeEl.className = 'result-badge ' + badgeToCssClass(newBadge);
    }

    // Update or add feedback
    let feedbackEl = entry.querySelector('.log-feedback');
    if (newFeedback) {
        if (!feedbackEl) {
            feedbackEl = document.createElement('div');
            feedbackEl.className = 'log-feedback';
            entry.appendChild(feedbackEl);
        }
        feedbackEl.textContent = newFeedback;
    }

    pendingEntries.delete(entryId);
    logEntries.scrollTop = logEntries.scrollHeight;
}

function badgeToCssClass(badge) {
    const map = {
        'EXECUTED': 'executed', 'BLOCKED': 'blocked', 'PENDING': 'pending',
        'CANCELLED': 'cancelled', 'ERROR': 'error', 'QUERY': 'query',
        'NOT SUPPORTED': 'not-supported', 'NOT FOUND': 'not-found',
        'PARSE FAIL': 'parse-fail', 'EXECUTING': 'executed',
    };
    return map[badge] || 'error';
}

function getIffClass(decision) {
    const d = decision.toUpperCase();
    if (d.includes('FRIENDLY') || d.includes('CLEAR') || d.includes('ALLOWED'))  return 'iff-friendly';
    if (d.includes('HOSTILE')  || d.includes('BLOCKED') || d.includes('DENIED')) return 'iff-blocked';
    if (d.includes('UNKNOWN')  || d.includes('UNRECOGNIZED'))                    return 'iff-unknown';
    return 'iff-hostile';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ── Whisper Voice Input (server-side) ─────────────────────────────────────

async function startMicHold() {
    if (isListening || isProcessing) return;

    isListening = true;
    micBtn.classList.add('listening');
    transcriptEl.textContent = 'Listening...';

    try {
        const resp = await fetch('/api/listen', { method: 'POST' });
        const data = await resp.json();

        if (data.status === 'ok' && data.text) {
            // Persist last transcript — do not auto-clear
            transcriptEl.textContent = data.text;
            await sendCommand(data.text);
        } else {
            transcriptEl.textContent = data.message || 'No speech detected.';
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        transcriptEl.textContent = 'Mic error: ' + message;
    } finally {
        isListening = false;
        micBtn.classList.remove('listening');
    }
}

async function stopMicHold() {
    if (!isListening) return;
    transcriptEl.textContent = 'Stopping...';
    try {
        await fetch('/api/listen/stop', { method: 'POST' });
    } catch {
        // UI will recover when /api/listen resolves
    }
}

micBtn.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    startMicHold();
});

micBtn.addEventListener('pointerup', (event) => {
    event.preventDefault();
    stopMicHold();
});

micBtn.addEventListener('pointerleave', () => {
    stopMicHold();
});

micBtn.addEventListener('pointercancel', () => {
    stopMicHold();
});

document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && document.activeElement !== textInput && !event.repeat) {
        event.preventDefault();
        startMicHold();
    }
});

document.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && document.activeElement !== textInput) {
        event.preventDefault();
        stopMicHold();
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

// ── Landmarks Panel ──────────────────────────────────────────────────────

function toggleLandmarks() {
    const list = document.getElementById('landmarksList');
    const chevron = document.getElementById('landmarksChevron');
    list.classList.toggle('open');
    chevron.classList.toggle('open');
}

function populateLandmarks() {
    const list = document.getElementById('landmarksList');
    if (!list) return;
    list.innerHTML = '';
    for (const loc of LOCATIONS) {
        const div = document.createElement('div');
        div.className = 'landmark-entry';
        div.innerHTML =
            '<span class="lm-name">' + escapeHtml(loc.name) + '</span>' +
            '<span class="lm-type ' + loc.type + '">' + loc.type.toUpperCase() + '</span>';
        list.appendChild(div);
    }
}

// ── Init ──────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => { resizeCanvas(); drawMap(); });
resizeCanvas();
drawMap();
populateLandmarks();
