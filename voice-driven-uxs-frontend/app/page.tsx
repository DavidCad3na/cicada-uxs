"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import CommandLog, { LogEntry } from "./components/CommandLog";
import DroneStatus from "./components/DroneStatus";
import VoiceInput from "./components/VoiceInput";
import ConfirmationModal from "./components/ConfirmationModal";
import type { DronePos } from "./components/MapView";

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
  const [alphaArmed,     setAlphaArmed]     = useState(false);
  const [bravoArmed,     setBravoArmed]      = useState(false);
  const [alphaConnected, setAlphaConnected]  = useState(false);
  const [bravoConnected, setBravoConnected]  = useState(false);
  const [isProcessing,   setIsProcessing]    = useState(false);

  const [alphaPos,   setAlphaPos]   = useState<DronePos>({ x: -40, y: 0, alt: 0 });
  const [bravoPos,   setBravoPos]   = useState<DronePos>({ x: -40, y: 0, alt: 0 });
  const [alphaTrail, setAlphaTrail] = useState<{ x: number; y: number }[]>([]);
  const [bravoTrail, setBravoTrail] = useState<{ x: number; y: number }[]>([]);

  const [logEntries, setLogEntries] = useState<LogEntry[]>([
    { id: nextId++, time: "SYSTEM", status: "system", text: "UxS C2 ready. Awaiting connection." },
  ]);

  const isArmed = alphaArmed || bravoArmed;
  const theme = isArmed ? THEMES.armed : THEMES.disarmed;

  // ── SSE telemetry ──────────────────────────────────────────────────────
  // Expects: { drone: "alpha"|"bravo", x, y, alt, armed, mode, battery,
  //            heading, gps_fix, connected }
  useEffect(() => {
    const src = new EventSource("/api/telemetry");

    src.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const isAlpha = (data.drone ?? "alpha").toLowerCase() === "alpha";

        if (data.connected) {
          const pos: DronePos = {
            x:   data.x   ?? -40,
            y:   data.y   ?? 0,
            alt: data.alt ?? 0,
          };

          if (isAlpha) {
            setAlphaPos(pos);
            setAlphaArmed(data.armed ?? false);
            setAlphaConnected(true);
            setAlphaTrail((prev) => {
              const next = [...prev, { x: pos.x, y: pos.y }];
              return next.length > MAX_TRAIL ? next.slice(-MAX_TRAIL) : next;
            });
          } else {
            setBravoPos(pos);
            setBravoArmed(data.armed ?? false);
            setBravoConnected(true);
            setBravoTrail((prev) => {
              const next = [...prev, { x: pos.x, y: pos.y }];
              return next.length > MAX_TRAIL ? next.slice(-MAX_TRAIL) : next;
            });
          }
        }
      } catch {
        // malformed SSE frame — ignore
      }
    };

    src.onerror = () => {
      // EventSource auto-reconnects; no action needed
    };

    return () => src.close();
  }, []);

  // ── Command dispatch ───────────────────────────────────────────────────

  function addLogEntry(status: LogEntry["status"], text: string, feedback?: string) {
    const time = new Date().toISOString().slice(11, 19) + "Z";
    setLogEntries((prev) => [...prev, { id: nextId++, time, status, text, feedback }]);
  }

  async function sendCommand(text: string) {
    if (!text.trim() || isProcessing) return;
    setIsProcessing(true);
    try {
      const resp = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = await resp.json();
      addLogEntry(data.status ?? "unknown", text.trim(), data.feedback ?? data.reason);
      if (data.feedback) speak(data.feedback);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      addLogEntry("error", text.trim(), `Error: ${msg}`);
    }
    setIsProcessing(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col h-screen font-mono ${theme.root}`}>

      {/* Header */}
      <nav className={`flex items-center justify-between px-6 py-3 border-b ${theme.nav}`}>
        <div className="flex items-center gap-3">
          <span className={`text-xs tracking-widest uppercase ${theme.sysTag}`}>[ SYS:ONLINE ]</span>
          <h1 className={`text-sm font-bold tracking-[0.2em] uppercase ${theme.heading}`}>
            UxS Command &amp; Control
          </h1>
        </div>
        <span className={`text-xs tracking-widest uppercase ${theme.timestamp}`}>
          {new Date().toISOString().replace("T", " ").slice(0, 19)}Z
        </span>
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
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${alphaConnected ? "bg-green-900 text-green-400" : "bg-zinc-800 text-zinc-400"}`}>
                  {alphaConnected ? "CONNECTED" : "DISCONNECTED"}
                </span>
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${alphaArmed ? theme.activeBadge : "bg-zinc-800 text-zinc-400"}`}>
                  {alphaArmed ? "ARMED" : "DISARMED"}
                </span>
              </div>
            </div>
            <DroneStatus
              drone="alpha"
              onArmedChange={setAlphaArmed}
              onConnectedChange={setAlphaConnected}
            />
          </div>

          {/* Bravo */}
          <div className={`border p-3 ${theme.dronePanel}`}>
            <div className="flex items-center justify-between mb-3">
              <p className={`text-xs font-bold tracking-widest uppercase ${theme.droneLabel}`}>
                &#9632; UxS-BRAVO
              </p>
              <div className="flex flex-row gap-1 items-center">
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${bravoConnected ? "bg-green-900 text-green-400" : "bg-zinc-800 text-zinc-400"}`}>
                  {bravoConnected ? "CONNECTED" : "DISCONNECTED"}
                </span>
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${bravoArmed ? theme.activeBadge : "bg-zinc-800 text-zinc-400"}`}>
                  {bravoArmed ? "ARMED" : "DISARMED"}
                </span>
              </div>
            </div>
            <DroneStatus
              drone="bravo"
              onArmedChange={setBravoArmed}
              onConnectedChange={setBravoConnected}
            />
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
