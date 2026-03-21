"""
voice_input — record from microphone and transcribe locally via Whisper.

No API key required. The model is downloaded once on first use (~145 MB for
the default "base" model) and cached locally.

Quickstart
----------
    from voice_input import listen_and_transcribe
    text = listen_and_transcribe()
    print(text)

Optional env var
----------------
    WHISPER_MODEL=small  # override the default "base" model size
"""

import os
import threading
from .recorder import record_until_silence
from .transcriber import transcribe

__all__ = ["listen_and_transcribe", "record_until_silence", "transcribe"]


def listen_and_transcribe(
    language: str | None = None,
    silence_threshold: float | None = None,
    silence_duration: float = 1.5,
    stop_event: threading.Event | None = None,
) -> str:
    """
    High-level convenience function: record speech then transcribe it.

    Captures audio from the default microphone, stopping automatically
    after a period of silence, then sends the recording to Whisper.

    Args:
        language:          Optional BCP-47 language hint (e.g. "en").
                           None lets Whisper auto-detect.
        silence_threshold: RMS amplitude threshold for silence detection.
                           Auto-calibrated from ambient noise if None.
        silence_duration:  Seconds of consecutive silence that triggers stop.

    Returns:
        Transcribed text string.

    Raises:
        RuntimeError:      If microphone is unavailable or no speech detected.
        FileNotFoundError: If the temp audio file is missing (shouldn't happen).
    """
    audio_path = None
    try:
        audio_path = record_until_silence(
            silence_threshold=silence_threshold,
            silence_duration=silence_duration,
            stop_event=stop_event,
        )
        return transcribe(audio_path, language=language)
    finally:
        # always clean up the temp file, even on error
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)
