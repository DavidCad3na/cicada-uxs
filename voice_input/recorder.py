"""
recorder.py — capture audio from the default microphone with silence detection.

Uses sounddevice for cross-platform audio I/O. Records in small chunks,
computing a smoothed RMS amplitude to classify each moment as speech or silence.
Recording stops automatically once a sustained period of silence follows speech.

Auto-calibration samples ambient noise at startup to derive a dynamic threshold,
so the module works across different microphones and environments without tuning.
"""

import tempfile
import threading

import numpy as np
import sounddevice as sd
from scipy.io.wavfile import write as wav_write

# ---------------------------------------------------------------------------
# Defaults (all overridable via function arguments)
# ---------------------------------------------------------------------------

SAMPLE_RATE = 16_000        # Hz — Whisper's preferred rate
CHANNELS = 1                # mono
CHUNK_DURATION = 0.030      # seconds per chunk (30 ms — finer resolution)
CHUNK_SIZE = int(SAMPLE_RATE * CHUNK_DURATION)

CALIBRATION_DURATION = 1.0  # seconds of ambient noise to sample
SILENCE_MULTIPLIER = 4.0    # threshold = ambient_rms * this (generous headroom)
SILENCE_FLOOR = 80          # absolute minimum threshold (for very quiet mics)

SILENCE_DURATION = 1.5      # seconds of consecutive silence → stop recording
MIN_SPEECH_DURATION = 0.3   # minimum speech before silence can trigger stop
MAX_RECORDING_DURATION = 30 # hard cap in seconds

SMOOTH_WINDOW = 3           # chunks to smooth RMS over (smaller = faster detection)
WARMUP_CHUNKS = 5           # discard first N chunks while mic driver stabilises

# Cached threshold — calibrated once per process so the user pressing the mic
# button quickly cannot accidentally speak during calibration and inflate it.
_cached_threshold: float | None = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _rms(chunk: np.ndarray) -> float:
    """Root-mean-square amplitude of an int16 audio chunk."""
    return float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2)))


def _calibrate(multiplier: float = SILENCE_MULTIPLIER) -> float:
    """
    Sample ambient noise to derive a dynamic silence threshold.

    Result is cached for the lifetime of the process — calibration only runs
    once so the user pressing the mic button cannot accidentally speak during
    calibration on a later press and inflate the threshold above speech level.

    Uses the 90th-percentile RMS across calibration chunks so that brief
    transient noises don't inflate the threshold.

    Returns:
        float: RMS threshold. Audio above this value is treated as speech.
    """
    global _cached_threshold
    if _cached_threshold is not None:
        return _cached_threshold

    print("Calibrating ambient noise (one-time)...")
    n_samples = int(SAMPLE_RATE * CALIBRATION_DURATION)
    chunk_count = n_samples // CHUNK_SIZE

    rms_values: list[float] = []
    try:
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="int16",
            blocksize=CHUNK_SIZE,
        ) as stream:
            # warm-up: discard first few chunks (mic driver often returns zeros)
            for _ in range(WARMUP_CHUNKS):
                stream.read(CHUNK_SIZE)
            for _ in range(chunk_count):
                raw, _ = stream.read(CHUNK_SIZE)
                rms_values.append(_rms(np.squeeze(raw)))
    except sd.PortAudioError as e:
        raise RuntimeError(f"Calibration failed: {e}") from e

    ambient_rms = float(np.percentile(rms_values, 90))
    threshold = max(ambient_rms * multiplier, SILENCE_FLOOR)
    print(f"  Ambient RMS = {ambient_rms:.1f}  |  Threshold = {threshold:.1f}")
    _cached_threshold = threshold
    return threshold


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def record_until_silence(
    silence_threshold: float | None = None,
    silence_duration: float = SILENCE_DURATION,
    min_speech_duration: float = MIN_SPEECH_DURATION,
    max_duration: float = MAX_RECORDING_DURATION,
    sample_rate: int = SAMPLE_RATE,
    debug: bool = False,
    stop_event: threading.Event | None = None,
) -> str:
    """
    Record audio from the default microphone until silence is detected.

    Blocks until complete. Stops when `silence_duration` consecutive seconds
    of silence follow at least `min_speech_duration` seconds of speech,
    or when `max_duration` is reached.

    Args:
        silence_threshold:   RMS amplitude below which audio is "silence".
                             Auto-calibrated from ambient noise when None.
        silence_duration:    Seconds of consecutive silence that trigger stop.
        min_speech_duration: Minimum seconds of speech before stop is allowed.
        max_duration:        Hard cap on total recording length in seconds.
        sample_rate:         Audio sample rate in Hz.
        debug:               Print live RMS levels to help diagnose threshold issues.
        stop_event:          Optional threading.Event. Set it from another thread
                             to stop recording early (e.g. mic button pressed again).

    Returns:
        str: Absolute path to a temporary .wav file.
             The CALLER is responsible for deleting this file after use.

    Raises:
        RuntimeError: If no microphone is found, recording fails,
                      or no speech was detected.
    """
    # --- verify a microphone is available ---
    try:
        if sd.query_devices(kind="input") is None:
            raise RuntimeError("No input audio device found.")
    except Exception as e:
        raise RuntimeError(f"Microphone unavailable: {e}") from e

    if silence_threshold is None:
        silence_threshold = _calibrate()

    # pre-compute chunk counts from time targets
    chunks_for_silence = int(silence_duration / CHUNK_DURATION)
    chunks_for_min_speech = int(min_speech_duration / CHUNK_DURATION)
    max_chunks = int(max_duration / CHUNK_DURATION)

    print("Listening... (speak now, stops after silence)")

    chunks: list[np.ndarray] = []
    rms_window: list[float] = []  # rolling window for smoothed RMS
    silent_chunks = 0
    speech_chunks = 0
    speech_started = False

    try:
        with sd.InputStream(
            samplerate=sample_rate,
            channels=CHANNELS,
            dtype="int16",
            blocksize=CHUNK_SIZE,
        ) as stream:
            # discard initial chunks — mic driver often returns stale/zero data
            for _ in range(WARMUP_CHUNKS):
                stream.read(CHUNK_SIZE)

            # clear any stop signal that arrived during warm-up (e.g. from a
            # double-click or repeated keydown before recording actually started)
            if stop_event:
                stop_event.clear()

            while len(chunks) < max_chunks:
                raw, _ = stream.read(CHUNK_SIZE)
                chunk = np.squeeze(raw).copy()
                chunks.append(chunk)

                # smooth RMS over a short window to reduce jitter between chunks
                rms_window.append(_rms(chunk))
                if len(rms_window) > SMOOTH_WINDOW:
                    rms_window.pop(0)
                level = float(np.mean(rms_window))

                if debug:
                    bar = "#" * int(level / 50)
                    tag = "SPEECH " if level >= silence_threshold else "silence"
                    print(f"  [{tag}] RMS={level:6.1f}  threshold={silence_threshold:.1f}  {bar}")

                if level >= silence_threshold:
                    speech_started = True
                    speech_chunks += 1
                    silent_chunks = 0
                elif speech_started:
                    silent_chunks += 1

                # manual stop: mic button pressed again
                if stop_event and stop_event.is_set():
                    break

                if (
                    speech_started
                    and speech_chunks >= chunks_for_min_speech
                    and silent_chunks >= chunks_for_silence
                ):
                    break

    except sd.PortAudioError as e:
        raise RuntimeError(f"Recording error: {e}") from e

    if not chunks:
        raise RuntimeError("No audio captured.")

    if not speech_started:
        raise RuntimeError(
            "No speech detected.\n"
            "  → Run with debug=True to see live RMS values.\n"
            "  → Lower silence_threshold if your mic is quiet.\n"
            f"  → Current threshold: {silence_threshold:.1f}"
        )

    # trim trailing silence that triggered the stop
    trim = min(silent_chunks, len(chunks))
    audio = np.concatenate(chunks[: len(chunks) - trim])
    print(f"Captured {len(audio) / sample_rate:.1f}s of speech.")

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    wav_write(tmp.name, sample_rate, audio)
    return tmp.name
