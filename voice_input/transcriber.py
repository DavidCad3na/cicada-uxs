"""
transcriber.py — transcribe audio locally using faster-whisper.

Runs the Whisper model on-device; no API key or internet connection required
after the first run. The model weights are downloaded once and cached in
~/.cache/huggingface/hub/ (or %USERPROFILE%\.cache\huggingface\hub on Windows).

Model size guide (set via WHISPER_MODEL env var or model_size arg):
    tiny   ~75 MB   fastest, least accurate
    base   ~145 MB  decent
    small  ~465 MB  good balance of speed + accuracy (default)
    medium ~1.5 GB  high accuracy
    large  ~3 GB    best accuracy, slow without GPU
"""

import os

# Suppress HuggingFace warnings before any hf imports execute:
#   - HF_HUB_DISABLE_SYMLINKS_WARNING: Windows can't create symlinks without
#     Developer Mode; the cache still works, just uses more disk space.
#   - HF_HUB_DISABLE_IMPLICIT_TOKEN: suppresses the "unauthenticated requests"
#     rate-limit nag (we don't need a token for public models).
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")

import numpy as np
from scipy.io.wavfile import read as wav_read, write as wav_write
import tempfile
from faster_whisper import WhisperModel

# ---------------------------------------------------------------------------
# Domain vocabulary prompt — primes the Whisper decoder toward the command
# vocabulary so it transcribes "northwest watchtower" instead of "north west
# watch tower", "meters" instead of "metres", etc.
# ---------------------------------------------------------------------------
_INITIAL_PROMPT = (
    "Take off to ten meters. Fly north fifty meters. "
    "Fly to the northwest watchtower. Descend to five meters. "
    "Fly east to the command building. Climb to twelve meters and hover over the rooftop. "
    "Fly to the fuel depot. Report current position and altitude. "
    "Fly south to the shipping containers. Drop to three meters and enter the motor pool. "
    "Go to the northeast tower at fifteen meters altitude. "
    "Head back to the landing pad. Land. Orbit the perimeter. Ascend to twenty-five meters. "
    "Return to base. Fly over the communications tower. Fly through the west gate."
)

# Module-level model cache — loaded once per process
_model: WhisperModel | None = None
_loaded_model_size: str | None = None


def _get_model(model_size: str) -> WhisperModel:
    """Load and cache the Whisper model (downloads on first use)."""
    global _model, _loaded_model_size
    if _model is None or _loaded_model_size != model_size:
        print(f"Loading Whisper '{model_size}' model (downloads once, then cached)...")
        _model = WhisperModel(model_size, device="cpu", compute_type="int8")
        _loaded_model_size = model_size
        print("Model ready.")
    return _model


def _preprocess_audio(audio_path: str, sample_rate: int = 16_000) -> str:
    """
    Apply pre-emphasis and normalization to the audio before transcription.

    Pre-emphasis (y[n] = x[n] - 0.97*x[n-1]) boosts high-frequency consonants
    like 'n', 's', 'th', 'st' that carry critical information in words such as
    "northwest", "ascend", "east" — exactly where Whisper makes most mistakes.

    Normalization scales the signal to use the full int16 dynamic range so
    Whisper doesn't treat quiet speech as low-confidence input.

    Padding adds 250 ms of silence at each end. Whisper's attention mechanism
    performs better when speech isn't hard-cut at the audio boundaries.

    Returns a path to a new temp .wav file. Caller must delete it.
    """
    rate, audio = wav_read(audio_path)

    # convert to float for processing
    signal = audio.astype(np.float64)

    # pre-emphasis filter: y[n] = x[n] - 0.97 * x[n-1]
    pre_emphasis = 0.97
    emphasized = np.append(signal[0], signal[1:] - pre_emphasis * signal[:-1])

    # normalize to 90% of int16 max (avoid clipping while maximising volume)
    peak = np.max(np.abs(emphasized))
    if peak > 0:
        emphasized = emphasized / peak * (32767 * 0.9)

    # pad with 250 ms of silence at each end
    pad_samples = int(sample_rate * 0.25)
    padded = np.concatenate([
        np.zeros(pad_samples),
        emphasized,
        np.zeros(pad_samples),
    ])

    result = padded.astype(np.int16)

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    wav_write(tmp.name, rate, result)
    return tmp.name


def transcribe(
    audio_path: str,
    language: str = "en",
    model_size: str | None = None,
    initial_prompt: str | None = _INITIAL_PROMPT,
) -> str:
    """
    Transcribe an audio file using a local Whisper model.

    Args:
        audio_path:     Path to a .wav audio file.
        language:       BCP-47 language code. Defaults to "en" (skips
                        auto-detection, which is slower and occasionally wrong).
        model_size:     Whisper model size. Reads WHISPER_MODEL env var if not
                        provided, falls back to "small".
        initial_prompt: Text to prime the Whisper decoder with domain vocabulary.
                        Pass None to disable.

    Returns:
        Transcribed text string.

    Raises:
        FileNotFoundError: If audio_path does not exist.
        ValueError:        If the audio file is empty.
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    if os.path.getsize(audio_path) == 0:
        raise ValueError(f"Audio file is empty: {audio_path}")

    size = model_size or os.environ.get("WHISPER_MODEL", "small")
    model = _get_model(size)

    processed_path = None
    try:
        processed_path = _preprocess_audio(audio_path)

        segments, _ = model.transcribe(
            processed_path,
            language=language,
            beam_size=5,
            # temperature=0 → fully greedy, deterministic, no random sampling
            temperature=0,
            # don't condition on previous segments — prevents hallucination/drift
            # on short isolated commands
            condition_on_previous_text=False,
            # domain vocab prompt shifts the decoder toward command vocabulary
            initial_prompt=initial_prompt,
            # built-in VAD to skip any residual silence faster-whisper missed
            vad_filter=True,
        )

        return " ".join(seg.text for seg in segments).strip()

    finally:
        if processed_path and os.path.exists(processed_path):
            os.remove(processed_path)
