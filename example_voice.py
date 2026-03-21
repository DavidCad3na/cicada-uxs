"""
example_voice.py — shows how another backend module calls voice_input.

Run:
    python example_voice.py
"""
"""
For testing purposes specifically
"""

from voice_input import listen_and_transcribe


def handle_voice_command() -> str:
    """
    Record a single spoken command and return the transcribed text.
    Plug this into your command parser, REST handler, or drone controller.
    """
    print("=== Voice command listener ===")
    text = listen_and_transcribe(language="en")
    print(f"Transcribed: {text!r}")
    return text


if __name__ == "__main__":
    command = handle_voice_command()
    # pass command to command parser here
    print(f"\nCommand ready for processing: {command!r}")
