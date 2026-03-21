"use client";

import { useState } from "react";
import CommandLog, { LogEntry } from "./components/CommandLog";
import DroneStatus from "./components/DroneStatus";
import VoiceInput from "./components/VoiceInput";
import ConfirmationModal from "./components/ConfirmationModal";

const THEMES = {
  armed: {
    root:         "bg-[#0c0a00] text-amber-400",
    nav:          "border-amber-900 bg-[#110e00]",
    sysTag:       "text-amber-600",
    heading:      "text-amber-300",
    timestamp:    "text-amber-800",
    sectionBorder:"border-amber-900",
    sectionIcon:  "text-amber-600",
    sectionLabel: "text-amber-600",
    sidebar:      "border-amber-900 bg-[#110e00]",
    dronePanel:   "border-amber-900",
    droneLabel:   "text-amber-300",
    activeBadge:  "bg-amber-900 text-amber-300",
  },
  disarmed: {
    root:         "bg-[#0a0f0a] text-lime-400",
    nav:          "border-lime-900 bg-[#0d140d]",
    sysTag:       "text-lime-600",
    heading:      "text-lime-300",
    timestamp:    "text-lime-900",
    sectionBorder:"border-lime-900",
    sectionIcon:  "text-lime-600",
    sectionLabel: "text-lime-600",
    sidebar:      "border-lime-900 bg-[#0d140d]",
    dronePanel:   "border-lime-900",
    droneLabel:   "text-lime-300",
    activeBadge:  "bg-lime-900 text-lime-300",
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
  const [alphaArmed, setAlphaArmed] = useState(false);
  const [bravoArmed, setBravoArmed] = useState(false);
  const [alphaConnected, setAlphaConnected] = useState(false);
  const [bravoConnected, setBravoConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([
    { id: nextId++, time: "SYSTEM", status: "system", text: "UxS C2 ready. Awaiting connection." },
  ]);

  const isArmed = alphaArmed || bravoArmed;
  const t = isArmed ? THEMES.armed : THEMES.disarmed;

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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      addLogEntry("error", text.trim(), `Error: ${msg}`);
    }
    setIsProcessing(false);
  }

  return (
    <div className={`flex flex-col h-screen font-mono ${t.root}`}>

      {/* Header */}
      <nav className={`flex items-center justify-between px-6 py-3 border-b ${t.nav}`}>
        <div className="flex items-center gap-3">
          <span className={`text-xs tracking-widest uppercase ${t.sysTag}`}>[ SYS:ONLINE ]</span>
          <h1 className={`text-sm font-bold tracking-[0.2em] uppercase ${t.heading}`}>
            UxS Command &amp; Control
          </h1>
        </div>
        <span className={`text-xs tracking-widest uppercase ${t.timestamp}`}>
          {new Date().toISOString().replace("T", " ").slice(0, 19)}Z
        </span>
      </nav>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Command Log */}
        <main className="flex flex-col flex-1 overflow-y-auto px-6 py-4">
          <div className={`flex items-center gap-2 mb-4 border-b pb-2 ${t.sectionBorder}`}>
            <span className={`text-xs ${t.sectionIcon}`}>&#9654;</span>
            <h2 className={`text-xs font-bold uppercase tracking-widest ${t.sectionLabel}`}>
              Command Log // Voice Transcript
            </h2>
          </div>
          <CommandLog entries={logEntries} isProcessing={isProcessing} />
        </main>

        {/* Right: Drone Status Sidebar */}
        <aside className={`w-100 border-l flex flex-col gap-6 px-4 py-4 overflow-y-auto ${t.sidebar}`}>
          <div className={`flex items-center gap-2 border-b pb-2 ${t.sectionBorder}`}>
            <span className={`text-xs ${t.sectionIcon}`}>&#9654;</span>
            <h2 className={`text-xs font-bold uppercase tracking-widest ${t.sectionLabel}`}>
              Drone Status
            </h2>
          </div>

          {/* Alpha */}
          <div className={`border p-3 ${t.dronePanel}`}>
            <div className="flex items-center justify-between mb-3">
              <p className={`text-xs font-bold tracking-widest uppercase ${t.droneLabel}`}>
                &#9632; UxS-ALPHA
              </p>
              <div className="flex flex-row gap-1 items-center">
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${alphaConnected ? "bg-green-900 text-green-400" : "bg-zinc-800 text-zinc-400"}`}>
                  {alphaConnected ? "CONNECTED" : "DISCONNECTED"}
                </span>
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${alphaArmed ? t.activeBadge : "bg-zinc-800 text-zinc-400"}`}>
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
          <div className={`border p-3 ${t.dronePanel}`}>
            <div className="flex items-center justify-between mb-3">
              <p className={`text-xs font-bold tracking-widest uppercase ${t.droneLabel}`}>
                &#9632; UxS-BRAVO
              </p>
              <div className="flex flex-row gap-1 items-center">
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${bravoConnected ? "bg-green-900 text-green-400" : "bg-zinc-800 text-zinc-400"}`}>
                  {bravoConnected ? "CONNECTED" : "DISCONNECTED"}
                </span>
                <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${bravoArmed ? t.activeBadge : "bg-zinc-800 text-zinc-400"}`}>
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
      <div className={`flex items-center gap-3 px-6 py-3 border-t ${t.nav}`}>
        <span className={`text-xs uppercase tracking-widest shrink-0 ${t.sectionLabel}`}>CMD&gt;</span>
        <VoiceInput onCommand={sendCommand} isProcessing={isProcessing} />
      </div>

      {/* Confirmation Modal (overlay) */}
      <ConfirmationModal />
    </div>
  );
}
