"use client";

import { useState } from "react";
import CommandLog from "./components/CommandLog";
import DroneStatus from "./components/DroneStatus";
import VoiceInput from "./components/VoiceInput";
import ConfirmationModal from "./components/ConfirmationModal";

const THEMES = {
  armed: {
    root:        "bg-[#0c0a00] text-amber-400",
    nav:         "border-amber-900 bg-[#110e00]",
    sysTag:      "text-amber-600",
    heading:     "text-amber-300",
    timestamp:   "text-amber-800",
    sectionBorder:"border-amber-900",
    sectionIcon: "text-amber-600",
    sectionLabel:"text-amber-600",
    sidebar:     "border-amber-900 bg-[#110e00]",
    dronePanel:  "border-amber-900",
    droneLabel:  "text-amber-300",
    activeBadge: "bg-amber-900 text-amber-300",
  },
  disarmed: {
    root:        "bg-[#0a0f0a] text-lime-400",
    nav:         "border-lime-900 bg-[#0d140d]",
    sysTag:      "text-lime-600",
    heading:     "text-lime-300",
    timestamp:   "text-lime-900",
    sectionBorder:"border-lime-900",
    sectionIcon: "text-lime-600",
    sectionLabel:"text-lime-600",
    sidebar:     "border-lime-900 bg-[#0d140d]",
    dronePanel:  "border-lime-900",
    droneLabel:  "text-lime-300",
    activeBadge: "bg-lime-900 text-lime-300",
  },
};

export default function Home() {
  const [alphaArmed, setAlphaArmed] = useState(false);
  const [bravoArmed, setBravoArmed] = useState(false);

  const isArmed = alphaArmed || bravoArmed;
  const t = isArmed ? THEMES.armed : THEMES.disarmed;

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
        <div className="flex items-center gap-4">
          <span className={`text-xs tracking-widest uppercase ${t.timestamp}`}>
            {new Date().toISOString().replace("T", " ").slice(0, 19)}Z
          </span>
          <VoiceInput />
        </div>
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
          <CommandLog />
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
              <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${alphaArmed ? t.activeBadge : "bg-zinc-800 text-zinc-400"}`}>
                {alphaArmed ? "ARMED" : "DISARMED"}
              </span>
            </div>
            <DroneStatus onArmedChange={setAlphaArmed} />
          </div>

          {/* Bravo */}
          <div className={`border p-3 ${t.dronePanel}`}>
            <div className="flex items-center justify-between mb-3">
              <p className={`text-xs font-bold tracking-widest uppercase ${t.droneLabel}`}>
                &#9632; UxS-BRAVO
              </p>
              <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider ${bravoArmed ? t.activeBadge : "bg-zinc-800 text-zinc-400"}`}>
                {bravoArmed ? "ARMED" : "DISARMED"}
              </span>
            </div>
            <DroneStatus onArmedChange={setBravoArmed} />
          </div>
        </aside>
      </div>

      {/* Confirmation Modal (overlay) */}
      <ConfirmationModal />
    </div>
  );
}
