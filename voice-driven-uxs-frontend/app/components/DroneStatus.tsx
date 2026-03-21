"use client";

export interface Telemetry {
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
  telemetry: Telemetry | null;
}

export default function DroneStatus({ telemetry }: DroneStatusProps) {
  const rows = telemetry
    ? [
        { label: "MODE",  value: telemetry.mode || "—",                          warn: ""       },
        { label: "ALT",   value: `${(telemetry.alt ?? 0).toFixed(1)}m`,          warn: ""       },
        { label: "POS X", value: (telemetry.x ?? 0).toFixed(1),                  warn: ""       },
        { label: "POS Y", value: (telemetry.y ?? 0).toFixed(1),                  warn: ""       },
        { label: "HDG",   value: `${(telemetry.heading ?? 0).toFixed(0)}°`,      warn: ""       },
        {
          label: "BAT",
          value: `${telemetry.battery ?? 100}%`,
          warn:  (telemetry.battery ?? 100) < 30 ? "danger" : (telemetry.battery ?? 100) < 60 ? "warn" : "",
        },
        {
          label: "GPS",
          value: telemetry.gps_fix ? "FIX" : "NO FIX",
          warn:  telemetry.gps_fix ? "" : "danger",
        },
      ]
    : [];

  return (
    <div className="space-y-1 text-xs font-mono">
      {telemetry === null && (
        <p className="text-zinc-600 text-[10px] uppercase tracking-wider">
          Awaiting telemetry...
        </p>
      )}
      {rows.map(({ label, value, warn }) => (
        <div key={label} className="flex justify-between">
          <span className="text-zinc-500 uppercase tracking-wider">{label}</span>
          <span
            className={
              warn === "danger" ? "text-red-400"
              : warn === "warn" ? "text-amber-400"
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
