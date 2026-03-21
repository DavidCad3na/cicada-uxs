"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import CommandLog, { LogEntry } from "./components/CommandLog";
import DroneStatus, { Telemetry } from "./components/DroneStatus";
import VoiceInput from "./components/VoiceInput";
import ConfirmationModal from "./components/ConfirmationModal";
import type { DronePos } from "./components/MapView";

// Canvas map is browser-only — never SSR
const MapView = dynamic(() => import("./components/MapView"), { ssr: false });

const MAX_TRAIL = 200;

const THEMES = {
  armed: {
    root:          "bg-[#0c0a00] text-amber-400",
    nav:           "border-amber-900 bg-[#110e00]",
    sysTag:        "text-amber-600",
    heading:       "text-amber-300",
    timestamp:     "text-amber-800",
    sectionBorder: "border-amber-900",
    sectionIcon:   "text-amber-600",
    sectionLabel:  "text-amber-600",
    sidebar:       "border-amber-900 bg-[#110e00]",
    dronePanel:    "border-amber-900",
    droneLabel:    "text-amber-300",
    activeBadge:   "bg-amber-900 text-amber-300",
    connectBtn:    "border-amber-700 text-amber-400 hover:bg-amber-900",
  },
  disarmed: {
    root:          "bg-[#0a0f0a] text-lime-400",
    nav:           "border-lime-900 bg-[#0d140d]",
    sysTag:        "text-lime-600",
    heading:       "text-lime-300",
    timestamp:     "text-lime-900",
    sectionBorder: "border-lime-900",
    sectionIcon:   "text-lime-600",
    sectionLabel:  "text-lime-600",
    sidebar:       "border-lime-900 bg-[#0d140d]",
    dronePanel:    "border-lime-900",
    droneLabel:    "text-lime-300",
    activeBadge:   "bg-lime-900 text-lime-300",
    connectBtn:    "border-lime-700 text-lime-400 hover:bg-lime-900",
  },
};

let nextId = 0;

function speak(text: string) {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 0.95;
    utterance.volume = 0.9;
    window.speechSynthesis.speak(utterance);
  }
}

export default function Home() {
  // ── Connection state ────────────────────────────────────────────────
  const [isConnected,  setIsConnected]  = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // ── Telemetry ───────────────────────────────────────────────────────
  const [alphaTelemetry, setAlphaTelemetry] = useState<Telemetry | null>(null);
  const [bravoTelemetry, setBravoTelemetry] = useState<Telemetry | null>(null);

  // ── Map positions + trails (derived from SSE) ───────────────────────
  const [alphaPos,   setAlphaPos]   = useState<DronePos>({ x: -40, y: 0, alt: 0 });
  const [bravoPos,   setBravoPos]   = useState<DronePos>({ x: -40, y: 0, alt: 0 });
  const [alphaTrail, setAlphaTrail] = useState<{ x: number; y: number }[]>([]);
  const [bravoTrail, setBravoTrail] = useState<{ x: number; y: number }[]>([]);

  // ── Command log ─────────────────────────────────────────────────────
  const [isProcessing, setIsProcessing] = useState(false);
  const [logEntries,   setLogEntries]   = useState<LogEntry[]>([
    { id: nextId++, time: "SYSTEM", status: "system", text: "UxS C2 ready. Awaiting connection." },
  ]);

  // ── Derived state ───────────────────────────────────────────────────
  const alphaArmed     = alphaTelemetry?.armed     ?? false;
  const bravoArmed     = bravoTelemetry?.armed      ?? false;
  const alphaConnected = alphaTelemetry?.connected  ?? false;
  const bravoConnected = bravoTelemetry?.connected  ?? false;
  const isArmed        = alphaArmed || bravoArmed;
  const theme          = isArmed ? THEMES.armed : THEMES.disarmed;

  // ── Connect to backend ──────────────────────────────────────────────
  async function connectDrones() {
    if (isConnecting || isConnected) return;
    setIsConnecting(true);
    try {
      const response = await fetch("/api/connect", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    "{}",
      });
      const data = await response.json();
      if (data.status === "connected") {
        setIsConnected(true);
        addLogEntry("system", `Connected — ${data.drone_id ?? "UxS Fleet"}`);
      } else {
        addLogEntry("error", "Connection failed", data.message ?? "Unknown error");
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      addLogEntry("error", "Connection failed", msg);
    }
    setIsConnecting(false);
  }

  // ── Single SSE telemetry stream (starts after connect) ─────────────
  // Expects: { drone: "alpha"|"bravo", x, y, alt, armed, mode,
  //            battery, heading, gps_fix, connected }
  useEffect(() => {
    if (!isConnected) return;

    const eventSource = new EventSource("/api/telemetry");

    eventSource.onmessage = (event) => {
      try {
        const data: Telemetry & { drone?: string } = JSON.parse(event.data);
        const isAlpha = (data.drone ?? "alpha").toLowerCase() === "alpha";
        const position: DronePos = {
          x:   data.x   ?? -40,
          y:   data.y   ?? 0,
          alt: data.alt ?? 0,
        };

        if (isAlpha) {
          setAlphaTelemetry(data);
          setAlphaPos(position);
          setAlphaTrail((prev) => {
            const updated = [...prev, { x: position.x, y: position.y }];
            return updated.length > MAX_TRAIL ? updated.slice(-MAX_TRAIL) : updated;
          });
        } else {
          setBravoTelemetry(data);
          setBravoPos(position);
          setBravoTrail((prev) => {
            const updated = [...prev, { x: position.x, y: position.y }];
            return updated.length > MAX_TRAIL ? updated.slice(-MAX_TRAIL) : updated;
          });
        }
      } catch {
        // malformed SSE frame — ignore
      }
    };

    eventSource.onerror = () => {
      // EventSource auto-reconnects; mark as disconnected if stream drops
      setIsConnected(false);
      addLogEntry("error", "Telemetry stream lost", "Reconnecting...");
    };

    return () => eventSource.close();
  }, [isConnected]);

  // ── Command dispatch ────────────────────────────────────────────────

  function addLogEntry(status: LogEntry["status"], text: string, feedback?: string) {
    const time = new Date().toISOString().slice(11, 19) + "Z";
    setLogEntries((prev) => [...prev, { id: nextId++, time, status, text, feedback }]);
  }

  async function sendCommand(text: string) {
    if (!text.trim() || isProcessing) return;
    setIsProcessing(true);
    try {
      const response = await fetch("/api/command", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text: text.trim() }),
      });
      const data = await response.json();
      addLogEntry(data.status ?? "unknown", text.trim(), data.feedback ?? data.reason);
      if (data.feedback) speak(data.feedback);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      addLogEntry("error", text.trim(), `Error: ${msg}`);
    }
    setIsProcessing(false);
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col h-screen font-mono ${theme.root}`}>

      {/* Header */}
      <nav className={`flex items-center justify-between px-6 py-3 border-b ${theme.nav}`}>
        <div className="flex items-center gap-3">
          <span className={`text-xs tracking-widest uppercase ${theme.sysTag}`}>
            [ SYS:{isConnected ? "ONLINE" : "STANDBY"} ]
          </span>
          <h1 className={`text-sm font-bold tracking-[0.2em] uppercase ${theme.heading}`}>
            UxS Command &amp; Control
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {/* Connect button */}
          <button
            onClick={connectDrones}
            disabled={isConnecting || isConnected}
            className={`text-[10px] uppercase tracking-widest border px-3 py-1 transition-colors disabled:opacity-50 ${
              isConnected
                ? "border-green-700 text-green-400 cursor-default"
                : theme.connectBtn
            }`}
          >
            {isConnected ? "● CONNECTED" : isConnecting ? "CONNECTING..." : "CONNECT"}
          </button>
          <span className={`text-xs tracking-widest uppercase ${theme.timestamp}`}>
            {new Date().toISOString().replace("T", " ").slice(0, 19)}Z
          </span>
        </div>
      </nav>

      {/* Main 3-column layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Command Log */}
        <main className="flex flex-col w-80 shrink-0 overflow-y-auto px-4 py-4 border-r border-inherit">
          <div className={`flex items-center gap-2 mb-4 border-b pb-2 ${theme.sectionBorder}`}>
            <span className={`text-xs ${theme.sectionIcon}`}>&#9654;</span>
            <h2 className={`text-xs font-bold uppercase tracking-widest ${theme.sectionLabel}`}>
              Command Log
            </h2>
          </div>
          <CommandLog entries={logEntries} isProcessing={isProcessing} />
        </main>

        {/* Centre: Tactical Map */}
        <section className="flex flex-col flex-1 overflow-hidden">
          <div className={`flex items-center gap-2 px-4 py-2 border-b ${theme.sectionBorder}`}>
            <span className={`text-xs ${theme.sectionIcon}`}>&#9654;</span>
            <h2 className={`text-xs font-bold uppercase tracking-widest ${theme.sectionLabel}`}>
              Tactical Map // ENU
            </h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <MapView
              alphaPos={alphaPos}
              bravoPos={bravoPos}
              alphaTrail={alphaTrail}
              bravoTrail={bravoTrail}
            />
          </div>
        </section>

        {/* Right: Drone Status Sidebar */}
        <aside className={`w-80 shrink-0 border-l flex flex-col gap-6 px-4 py-4 overflow-y-auto ${theme.sidebar}`}>
          <div className={`flex items-center gap-2 border-b pb-2 ${theme.sectionBorder}`}>
            <span className={`text-xs ${theme.sectionIcon}`}>&#9654;</span>
            <h2 className={`text-xs font-bold uppercase tracking-widest ${theme.sectionLabel}`}>
              Drone Status
            </h2>
          </div>

          {/* Alpha */}
          <div className={`border p-3 ${theme.dronePanel}`}>
            <div className="flex items-center justify-between mb-3">
              <p className={`text-xs font-bold tracking-widest uppercase ${theme.droneLabel}`}>
                &#9632; UxS-ALPHA
              </p>
              <div className="flex flex-row gap-1 items-center">
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${
                  alphaConnected ? "bg-green-900 text-green-400" : "bg-zinc-800 text-zinc-400"
                }`}>
                  {alphaConnected ? "CONNECTED" : "DISCONNECTED"}
                </span>
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${
                  alphaArmed ? theme.activeBadge : "bg-zinc-800 text-zinc-400"
                }`}>
                  {alphaArmed ? "ARMED" : "DISARMED"}
                </span>
              </div>
            </div>
            <DroneStatus telemetry={alphaTelemetry} />
          </div>

          {/* Bravo */}
          <div className={`border p-3 ${theme.dronePanel}`}>
            <div className="flex items-center justify-between mb-3">
              <p className={`text-xs font-bold tracking-widest uppercase ${theme.droneLabel}`}>
                &#9632; UxS-BRAVO
              </p>
              <div className="flex flex-row gap-1 items-center">
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${
                  bravoConnected ? "bg-green-900 text-green-400" : "bg-zinc-800 text-zinc-400"
                }`}>
                  {bravoConnected ? "CONNECTED" : "DISCONNECTED"}
                </span>
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${
                  bravoArmed ? theme.activeBadge : "bg-zinc-800 text-zinc-400"
                }`}>
                  {bravoArmed ? "ARMED" : "DISARMED"}
                </span>
              </div>
            </div>
            <DroneStatus telemetry={bravoTelemetry} />
          </div>
        </aside>
      </div>

      {/* Bottom command bar */}
      <div className={`flex items-center gap-3 px-6 py-3 border-t ${theme.nav}`}>
        <span className={`text-xs uppercase tracking-widest shrink-0 ${theme.sectionLabel}`}>CMD&gt;</span>
        <VoiceInput onCommand={sendCommand} isProcessing={isProcessing} />
      </div>

      {/* Confirmation Modal (overlay) */}
      <ConfirmationModal />
    </div>
  );
}
