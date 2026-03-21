"use client";

import { useEffect, useState } from "react";

interface Telemetry {
  connected: boolean;
  x: number;
  y: number;
  alt: number;
  armed: boolean;
  mode: string;
  battery: number;
  heading: number;
  gps_fix: boolean;
}

interface DroneStatusProps {
  drone: "alpha" | "bravo";
  onArmedChange?: (armed: boolean) => void;
  onConnectedChange?: (connected: boolean) => void;
}

export default function DroneStatus({ drone, onArmedChange, onConnectedChange }: DroneStatusProps) {
  const [telem, setTelem] = useState<Telemetry | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/telemetry/${drone}`);

    es.onmessage = (e) => {
      const data: Telemetry = JSON.parse(e.data);
      setTelem(data);
      onArmedChange?.(data.armed);
      onConnectedChange?.(data.connected);
    };

    es.onerror = () => {
      onConnectedChange?.(false);
    };

    return () => es.close();
  }, [drone, onArmedChange, onConnectedChange]);

  const rows = telem
    ? [
        { label: "MODE", value: telem.mode || "—", warn: "" },
        { label: "ALT",  value: `${(telem.alt ?? 0).toFixed(1)}m`, warn: "" },
        { label: "POS X", value: (telem.x ?? 0).toFixed(1), warn: "" },
        { label: "POS Y", value: (telem.y ?? 0).toFixed(1), warn: "" },
        { label: "HDG",  value: `${(telem.heading ?? 0).toFixed(0)}°`, warn: "" },
        {
          label: "BAT",
          value: `${telem.battery ?? 100}%`,
          warn: (telem.battery ?? 100) < 30 ? "danger" : (telem.battery ?? 100) < 60 ? "warn" : "",
        },
        {
          label: "GPS",
          value: telem.gps_fix ? "FIX" : "NO FIX",
          warn: telem.gps_fix ? "" : "danger",
        },
      ]
    : [];

  return (
    <div className="space-y-1 text-xs font-mono">
      {telem === null && (
        <p className="text-zinc-600 text-[10px] uppercase tracking-wider">
          Awaiting telemetry...
        </p>
      )}
      {rows.map(({ label, value, warn }) => (
        <div key={label} className="flex justify-between">
          <span className="text-zinc-500 uppercase tracking-wider">{label}</span>
          <span
            className={
              warn === "danger"
                ? "text-red-400"
                : warn === "warn"
                ? "text-amber-400"
                : "text-zinc-200"
            }
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}
