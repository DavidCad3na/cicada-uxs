#!/usr/bin/env python3
"""
Voice I/O — generates human-readable feedback text for all command outcomes.
Optionally speaks feedback server-side via pyttsx3 (browser TTS is primary).
"""


class VoiceFeedback:
    """Generates spoken feedback strings and optionally speaks them server-side."""

    def __init__(self, use_server_tts: bool = False):
        self.use_server_tts = use_server_tts
        self._engine = None
        if use_server_tts:
            try:
                import pyttsx3
                self._engine = pyttsx3.init()
                self._engine.setProperty("rate", 170)
            except Exception:
                self._engine = None

    def generate_feedback(self, status: str, intent: dict,
                          reason: str = "", drone_pos: dict = None) -> str:
        """Generate a human-readable feedback string for a command result."""
        if status == "rejected":
            return f"Command rejected. {reason}"

        action = intent.get("action", "")

        if action == "takeoff":
            alt = intent.get("altitude", 10)
            return f"Taking off to {alt} meters."

        if action == "goto":
            loc = intent.get("location", "target")
            alt = intent.get("altitude")
            if alt:
                return f"Flying to {loc} at {alt} meters altitude."
            return f"Flying to {loc}."

        if action == "move_relative":
            d = intent.get("direction", "forward")
            dist = intent.get("distance", 0)
            return f"Moving {d} {dist} meters."

        if action == "change_altitude":
            alt = intent.get("altitude", 0)
            return f"Changing altitude to {alt} meters."

        if action == "land":
            return "Landing now."

        if action == "hover":
            return "Holding position."

        if action == "report_status":
            if drone_pos:
                return (f"Current position: {drone_pos.get('x', 0):.1f} east, "
                        f"{drone_pos.get('y', 0):.1f} north, "
                        f"at {drone_pos.get('alt', 0):.1f} meters altitude.")
            return "Status report."

        if action == "identify":
            target = intent.get("target", "unknown")
            return f"Identifying {target}."

        return "Command acknowledged."

    def speak(self, text: str):
        """Speak text server-side (fallback). Primary TTS is browser-side."""
        if self._engine:
            try:
                self._engine.say(text)
                self._engine.runAndWait()
            except Exception:
                pass
