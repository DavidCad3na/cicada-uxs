#!/usr/bin/env python3
"""
Flask Application — REST API + SSE telemetry stream + static frontend.
Bridges the voice/UI frontend to the Python drone backend.
"""

import json
import os
import sys
import threading
import time
from datetime import datetime

from flask import Flask, Response, jsonify, request, send_from_directory

# Ensure both the challenge package and voice_input module are importable
_project_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, _project_root)

from voice_input import listen_and_transcribe

from drone_control import DroneController
from intent_parser import parse_command
from validator import resolve_location, validate
from voice_io import VoiceFeedback
from challenge.config import PYMAVLINK_CONNECTION

app = Flask(__name__, static_folder="static")
voice = VoiceFeedback(use_server_tts=False)

# Global drone controller (initialized on connect)
drone: DroneController | None = None
command_log: list[dict] = []
_listen_stop = threading.Event()  # set this to abort an active recording


# ── Static Frontend ──────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(app.static_folder, filename)


# ── API Endpoints ────────────────────────────────────────────────────────

@app.route("/api/listen", methods=["POST"])
def api_listen():
    """Record from the server microphone and return Whisper transcription."""
    _listen_stop.clear()
    try:
        text = listen_and_transcribe(language="en", stop_event=_listen_stop)
        return jsonify({"status": "ok", "text": text})
    except RuntimeError as e:
        return jsonify({"status": "error", "message": str(e)}), 400
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/listen/stop", methods=["POST"])
def api_listen_stop():
    """Signal an active recording to stop early."""
    _listen_stop.set()
    return jsonify({"status": "ok"})


@app.route("/api/connect", methods=["POST"])
def api_connect():
    """Connect to SITL."""
    global drone
    connection = request.json.get("connection", PYMAVLINK_CONNECTION) if request.json else PYMAVLINK_CONNECTION
    drone_id = request.json.get("drone_id", "Alpha") if request.json else "Alpha"

    drone = DroneController(connection_string=connection, drone_id=drone_id)
    success = drone.connect()

    if success:
        return jsonify({"status": "connected", "drone_id": drone_id})
    else:
        drone = None
        return jsonify({"status": "error", "message": "Failed to connect to SITL"}), 500


@app.route("/api/command", methods=["POST"])
def api_command():
    """Process a voice/text command through the full pipeline."""
    global command_log

    if not drone or not drone.is_connected():
        return jsonify({"status": "error", "message": "Drone not connected. Connect first."}), 400

    text = request.json.get("text", "").strip()
    if not text:
        return jsonify({"status": "error", "message": "No command text provided."}), 400

    timestamp = datetime.now().isoformat()

    # Step 1: Parse intent via Groq AI (or fallback)
    intent = parse_command(text)

    # Step 2: Resolve location to coordinates (if goto)
    if intent.get("action") == "goto" and "location" in intent:
        loc = resolve_location(intent["location"])
        if loc:
            intent["x"] = loc.x
            intent["y"] = loc.y
            if intent.get("altitude") is None:
                intent["altitude"] = loc.default_alt
            intent["resolved_name"] = loc.name
        else:
            # Unknown location
            entry = {
                "timestamp": timestamp, "text": text, "intent": intent,
                "status": "rejected", "reason": f"Unknown location: {intent['location']}",
                "feedback": f"Unknown location: {intent['location']}. Please specify a known compound location."
            }
            command_log.append(entry)
            return jsonify(entry)

    # For move_relative, compute the target coordinates for validation
    if intent.get("action") == "move_relative":
        pos = drone.get_position()
        direction_map = {
            "north": (0, 1), "south": (0, -1),
            "east": (1, 0), "west": (-1, 0),
            "northeast": (0.707, 0.707), "northwest": (-0.707, 0.707),
            "southeast": (0.707, -0.707), "southwest": (-0.707, -0.707),
        }
        d = intent.get("direction", "north").lower()
        dx, dy = direction_map.get(d, (0, 0))
        dist = intent.get("distance", 0)
        intent["x"] = pos["x"] + dx * dist
        intent["y"] = pos["y"] + dy * dist
        if intent.get("altitude") is None:
            intent["altitude"] = pos["alt"]

    # For change_altitude, set x/y to current position
    if intent.get("action") == "change_altitude":
        pos = drone.get_position()
        intent["x"] = pos["x"]
        intent["y"] = pos["y"]

    # Step 3: Validate
    current_pos = drone.get_position()
    validation = validate(intent, current_pos)

    # Step 4: Log
    entry = {
        "timestamp": timestamp,
        "text": text,
        "intent": {k: v for k, v in intent.items() if k != "original_text"},
        "status": "approved" if validation.approved else "rejected",
        "reason": validation.reason,
    }

    if not validation.approved:
        feedback = voice.generate_feedback("rejected", intent, reason=validation.reason)
        entry["feedback"] = feedback
        entry["suggestion"] = validation.suggestion
        command_log.append(entry)
        return jsonify(entry)

    # Step 5: Execute
    action = intent.get("action")
    result = None

    if action == "takeoff":
        result = drone.takeoff(intent.get("altitude", 10))
    elif action == "goto":
        result = drone.goto_location(intent["x"], intent["y"], intent.get("altitude", 10))
    elif action == "move_relative":
        result = drone.goto_location(intent["x"], intent["y"], intent.get("altitude", 10))
    elif action == "change_altitude":
        result = drone.change_altitude(intent["altitude"])
    elif action == "land":
        result = drone.land()
    elif action == "hover":
        result = drone.hover()
    elif action == "report_status":
        result = drone.report_status()
    else:
        result = None

    if result and result.success:
        feedback = voice.generate_feedback("approved", intent, drone_pos=current_pos)
        if action == "report_status":
            feedback = result.message
        entry["feedback"] = feedback
        entry["execution"] = result.message
    elif result:
        entry["status"] = "error"
        entry["feedback"] = f"Execution failed: {result.message}"
    else:
        entry["feedback"] = "Unknown action."

    command_log.append(entry)
    return jsonify(entry)


@app.route("/api/status")
def api_status():
    """Current drone state snapshot."""
    if not drone or not drone.is_connected():
        return jsonify({"connected": False})
    pos = drone.get_position()
    state = drone.get_state()
    return jsonify({**pos, **state, "connected": True})


@app.route("/api/telemetry")
def api_telemetry():
    """SSE stream of drone telemetry at ~4Hz."""
    def generate():
        while True:
            if drone and drone.is_connected():
                pos = drone.get_position()
                state = drone.get_state()
                data = json.dumps({**pos, **state, "connected": True})
            else:
                data = json.dumps({"connected": False})
            yield f"data: {data}\n\n"
            time.sleep(0.25)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/command-log")
def api_command_log():
    """Return full command history."""
    return jsonify(command_log)


# ── Main ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Calibrating microphone...")
    try:
        from voice_input.recorder import _calibrate
        _calibrate()  # warm up mic and cache threshold before any user interaction
    except Exception as e:
        print(f"  Mic calibration warning: {e} (will retry on first use)")

    print("╔══════════════════════════════════════════════╗")
    print("║  Voice Drone Operations Command Center       ║")
    print("║  Open http://localhost:5000 in your browser   ║")
    print("╚══════════════════════════════════════════════╝")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
