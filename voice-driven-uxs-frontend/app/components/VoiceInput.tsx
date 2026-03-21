"use client";

import { useEffect, useRef, useState } from "react";
import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";

interface VoiceInputProps {
  onCommand: (text: string) => void;
  isProcessing: boolean;
}

// RNNoise assets are copied from node_modules to public/rnnoise/ at dev/build time
// (see scripts/copy-audio-assets.js)
const WORKLET_URL  = "/rnnoise/workletProcessor.js";
const WASM_URL     = "/rnnoise/rnnoise.wasm";
const WASM_SIMD_URL = "/rnnoise/rnnoise_simd.wasm";

export default function VoiceInput({ onCommand, isProcessing }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [textInput, setTextInput] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isListeningRef = useRef(false);
  const pendingStopRef = useRef(false);

  // RNNoise state — initialized once, reused across recordings
  const wasmBinaryRef = useRef<ArrayBuffer | null>(null);
  const workletLoadedRef = useRef(false);
  const rnnoiseReadyRef = useRef<boolean | null>(null); // null=untried, true/false=result

  // Keep ref in sync so keyup handler sees current value
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  async function initRnnoise(audioCtx: AudioContext): Promise<boolean> {
    if (rnnoiseReadyRef.current !== null) return rnnoiseReadyRef.current;

    try {
      // Load WASM binary once and cache it
      if (!wasmBinaryRef.current) {
        wasmBinaryRef.current = await loadRnnoise({ url: WASM_URL, simdUrl: WASM_SIMD_URL });
      }

      // Register AudioWorklet processor once per AudioContext
      if (!workletLoadedRef.current) {
        await audioCtx.audioWorklet.addModule(WORKLET_URL);
        workletLoadedRef.current = true;
      }

      rnnoiseReadyRef.current = true;
      return true;
    } catch (err) {
      console.warn("[RNNoise] Init failed, falling back to raw audio:", err);
      rnnoiseReadyRef.current = false;
      return false;
    }
  }

  async function startRecording() {
    if (isListeningRef.current || isProcessing) return;
    isListeningRef.current = true;
    pendingStopRef.current = false;

    try {
      // Disable browser-native suppression so RNNoise handles it
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // User released before getUserMedia resolved — abort
      if (pendingStopRef.current) {
        rawStream.getTracks().forEach((t) => t.stop());
        isListeningRef.current = false;
        return;
      }

      let recordingStream: MediaStream = rawStream;
      let audioCtx: AudioContext | null = null;
      let denoiser: RnnoiseWorkletNode | null = null;

      try {
        // RNNoise requires 48 kHz
        audioCtx = new AudioContext({ sampleRate: 48000 });
        await audioCtx.resume();

        const ready = await initRnnoise(audioCtx);
        if (ready && wasmBinaryRef.current) {
          const source = audioCtx.createMediaStreamSource(rawStream);
          const destination = audioCtx.createMediaStreamDestination();

          denoiser = new RnnoiseWorkletNode(audioCtx, {
            maxChannels: 1,
            wasmBinary: wasmBinaryRef.current,
          });

          source.connect(denoiser);
          denoiser.connect(destination);
          recordingStream = destination.stream;
        }
      } catch (err) {
        console.warn("[RNNoise] Audio graph setup failed, using raw audio:", err);
        audioCtx?.close();
        audioCtx = null;
        denoiser = null;
        recordingStream = rawStream;
      }

      const recorder = new MediaRecorder(recordingStream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        rawStream.getTracks().forEach((t) => t.stop());

        // Cleanup audio graph
        denoiser?.destroy();
        denoiser?.disconnect();
        await audioCtx?.close().catch(() => {});

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
      isListeningRef.current = false;
      pendingStopRef.current = false;
      setTranscript("Mic unavailable");
      setTimeout(() => setTranscript(""), 2000);
    }
  }

  function stopRecording() {
    if (!isListeningRef.current) return;
    pendingStopRef.current = true;
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
      if (event.repeat) return;
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
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startRecording(); }}
        onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); stopRecording(); }}
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
