"use client";

import { useEffect, useRef, useState } from "react";

interface VoiceInputProps {
  onCommand: (text: string) => void;
  isProcessing: boolean;
}

export default function VoiceInput({ onCommand, isProcessing }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [textInput, setTextInput] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isListeningRef = useRef(false);

  // Keep ref in sync so keyup handler sees current value
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  async function startRecording() {
    if (isListeningRef.current || isProcessing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setTranscript("Processing...");
        try {
          const form = new FormData();
          form.append("audio", blob, "recording.webm");
          const resp = await fetch("/api/voice", { method: "POST", body: form });
          const data = await resp.json();
          if (data.transcript) {
            setTranscript(data.transcript);
            onCommand(data.transcript);
            setTimeout(() => setTranscript(""), 2000);
          }
        } catch {
          setTranscript("Mic error");
          setTimeout(() => setTranscript(""), 2000);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsListening(true);
      setTranscript("Listening...");
    } catch {
      setTranscript("Mic unavailable");
      setTimeout(() => setTranscript(""), 2000);
    }
  }

  function stopRecording() {
    if (!isListeningRef.current) return;
    mediaRecorderRef.current?.stop();
    setIsListening(false);
  }

  function sendText() {
    if (!textInput.trim() || isProcessing) return;
    onCommand(textInput.trim());
    setTextInput("");
  }

  // Spacebar push-to-talk
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Space" && (document.activeElement as HTMLElement)?.tagName !== "INPUT") {
        event.preventDefault();
        startRecording();
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space" && (document.activeElement as HTMLElement)?.tagName !== "INPUT") {
        event.preventDefault();
        stopRecording();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [isProcessing]);

  return (
    <div className="flex items-center gap-3 w-full">

      {/* Mic button — hold to record */}
      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onMouseLeave={stopRecording}
        disabled={isProcessing}
        title="Hold to talk (or hold Space)"
        className={`w-10 h-10 shrink-0 rounded-full border text-sm flex items-center justify-center transition-all disabled:opacity-40 ${
          isListening
            ? "border-red-500 text-red-400 bg-red-950 animate-pulse"
            : "border-zinc-600 text-zinc-400 hover:border-zinc-400"
        }`}
      >
        ●
      </button>

      {/* Transcript / status feedback */}
      {transcript && (
        <span className="text-xs text-amber-400 italic shrink-0">
          {transcript}
        </span>
      )}

      {/* Text input */}
      <input
        type="text"
        value={textInput}
        onChange={(event) => setTextInput(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && sendText()}
        placeholder="Type command and press Enter or Send..."
        disabled={isProcessing}
        className="flex-1 bg-transparent border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-600 outline-none px-3 py-2 focus:border-zinc-400 disabled:opacity-40"
      />

      {/* Send button — only useful when typing */}
      <button
        onClick={sendText}
        disabled={isProcessing || !textInput.trim()}
        className="shrink-0 border border-zinc-700 px-4 py-2 text-xs uppercase tracking-widest text-zinc-400 hover:border-zinc-400 hover:text-zinc-200 disabled:opacity-30 transition-all"
      >
        Send
      </button>

    </div>
  );
}
