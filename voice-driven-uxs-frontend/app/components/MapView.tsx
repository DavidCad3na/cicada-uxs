"use client";

import { useRef, useEffect, useState, useCallback } from "react";

export interface DronePos {
  x: number;
  y: number;
  alt: number;
}

interface MapViewProps {
  alphaPos: DronePos;
  bravoPos: DronePos;
  alphaTrail: { x: number; y: number }[];
  bravoTrail: { x: number; y: number }[];
}

// ── Compound layout (mirrors challenge/config.py) ──────────────────────

const LOCATIONS = [
  { name: "Landing Pad",  x: -40,   y:   0,    type: "waypoint"  },
  { name: "West Gate",    x: -60,   y:   0,    type: "waypoint"  },
  { name: "NW Tower",     x: -57,   y:  37,    type: "waypoint"  },
  { name: "NE Tower",     x:  57,   y:  37,    type: "waypoint"  },
  { name: "SE Tower",     x:  57,   y: -37,    type: "waypoint"  },
  { name: "SW Tower",     x: -57,   y: -37,    type: "waypoint"  },
  { name: "Cmd Building", x:  20,   y:  10,    type: "structure" },
  { name: "Rooftop",      x:  25,   y:  14,    type: "structure" },
  { name: "Barracks 1",   x: -20,   y:  25,    type: "structure" },
  { name: "Barracks 2",   x: -20,   y: -25,    type: "structure" },
  { name: "Motor Pool",   x:  38,   y: -20,    type: "structure" },
  { name: "Containers",   x:   1.5, y: -16.5,  type: "structure" },
  { name: "Comms Tower",  x:  40,   y:  30,    type: "caution"   },
  { name: "Fuel Depot",   x: -27,   y: -32,    type: "danger"    },
];

const NO_FLY_ZONES = [
  { name: "Fuel Depot",  x: -27, y: -32, radius: 10, fill: "rgba(239,68,68,0.15)",  border: "#ef4444" },
  { name: "Comms Tower", x:  40, y:  30, radius:  8, fill: "rgba(245,158,11,0.12)", border: "#f59e0b" },
];

const MIN_ZOOM  = 0.4;
const MAX_ZOOM  = 4.0;
const ZOOM_STEP = 0.15;

// ── Helpers ────────────────────────────────────────────────────────────

function enuToCanvas(
  canvas: HTMLCanvasElement,
  x_enu: number,
  y_enu: number,
  zoomLevel: number,
): { px: number; py: number } {
  const dpr         = window.devicePixelRatio || 1;
  const canvasWidth  = canvas.width  / dpr;
  const canvasHeight = canvas.height / dpr;
  const pad         = 40;
  const scale       = Math.min((canvasWidth - 2 * pad) / 150, (canvasHeight - 2 * pad) / 100) * zoomLevel;
  return {
    px: canvasWidth  / 2 + x_enu * scale,
    py: canvasHeight / 2 - y_enu * scale, // canvas y-axis is inverted
  };
}

function drawDrone(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  pos: DronePos,
  zoomLevel: number,
  color: string,
  glowRgba: string,
  callsign: string,
) {
  const dronePoint = enuToCanvas(canvas, pos.x, pos.y, zoomLevel);
  const glowRadius = 18 * Math.min(zoomLevel, 1.5);

  const glowGradient = ctx.createRadialGradient(
    dronePoint.px, dronePoint.py, 0,
    dronePoint.px, dronePoint.py, glowRadius,
  );
  glowGradient.addColorStop(0, glowRgba);
  glowGradient.addColorStop(1, "rgba(0,0,0,0)");

  ctx.fillStyle = glowGradient;
  ctx.beginPath();
  ctx.arc(dronePoint.px, dronePoint.py, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(dronePoint.px, dronePoint.py, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${callsign} ${pos.alt.toFixed(1)}m`, dronePoint.px, dronePoint.py - 12);
}

// ── Component ──────────────────────────────────────────────────────────

export default function MapView({ alphaPos, bravoPos, alphaTrail, bravoTrail }: MapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1.0);

  // Refs so draw always has the latest values without stale closures
  const zoomRef  = useRef(zoom);
  const propsRef = useRef({ alphaPos, bravoPos, alphaTrail, bravoTrail });
  useEffect(() => { zoomRef.current = zoom; });
  useEffect(() => { propsRef.current = { alphaPos, bravoPos, alphaTrail, bravoTrail }; });

  // ── Draw ──────────────────────────────────────────────────────────────

  const draw = useCallback((
    canvas: HTMLCanvasElement,
    data: typeof propsRef.current,
    zoomLevel: number,
  ) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr          = window.devicePixelRatio || 1;
    const canvasWidth  = canvas.width  / dpr;
    const canvasHeight = canvas.height / dpr;
    const toCanvas     = (x: number, y: number) => enuToCanvas(canvas, x, y, zoomLevel);

    // Background
    ctx.fillStyle = "#0f1923";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Grid
    ctx.strokeStyle = "rgba(45,58,77,0.4)";
    ctx.lineWidth = 0.5;
    for (let x = -70; x <= 70; x += 10) {
      const gridStart = toCanvas(x, -50);
      const gridEnd   = toCanvas(x,  50);
      ctx.beginPath(); ctx.moveTo(gridStart.px, gridStart.py); ctx.lineTo(gridEnd.px, gridEnd.py); ctx.stroke();
    }
    for (let y = -50; y <= 50; y += 10) {
      const gridStart = toCanvas(-70, y);
      const gridEnd   = toCanvas( 70, y);
      ctx.beginPath(); ctx.moveTo(gridStart.px, gridStart.py); ctx.lineTo(gridEnd.px, gridEnd.py); ctx.stroke();
    }

    // Compass labels
    ctx.fillStyle = "#64748b";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    const northPoint = toCanvas(0,  48); ctx.fillText("N", northPoint.px, northPoint.py - 4);
    const eastPoint  = toCanvas(72,  0); ctx.fillText("E", eastPoint.px,  eastPoint.py);

    // Perimeter walls
    ctx.strokeStyle = "#4a5568";
    ctx.lineWidth = 2;
    const gateBottom = toCanvas(-57, -5);
    const gateTop    = toCanvas(-57,  5);

    ctx.beginPath();
    let point = toCanvas(-57,  37); ctx.moveTo(point.px, point.py);
    point     = toCanvas( 57,  37); ctx.lineTo(point.px, point.py);
    point     = toCanvas( 57, -37); ctx.lineTo(point.px, point.py);
    point     = toCanvas(-57, -37); ctx.lineTo(point.px, point.py);
    ctx.lineTo(gateBottom.px, gateBottom.py);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(gateTop.px, gateTop.py);
    point = toCanvas(-57, 37); ctx.lineTo(point.px, point.py);
    ctx.stroke();

    // Gate gap (dashed amber)
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(gateBottom.px, gateBottom.py);
    ctx.lineTo(gateTop.px,    gateTop.py);
    ctx.stroke();
    ctx.setLineDash([]);

    // No-fly zones
    for (const zone of NO_FLY_ZONES) {
      const zoneCenter = toCanvas(zone.x, zone.y);
      const zoneEdge   = toCanvas(zone.x + zone.radius, zone.y);
      const radiusPx   = zoneEdge.px - zoneCenter.px;

      ctx.fillStyle = zone.fill;
      ctx.beginPath(); ctx.arc(zoneCenter.px, zoneCenter.py, radiusPx, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = zone.border;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.arc(zoneCenter.px, zoneCenter.py, radiusPx, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = zone.border;
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("NO FLY ZONE", zoneCenter.px, zoneCenter.py - radiusPx - 4);
    }

    // Named locations
    for (const loc of LOCATIONS) {
      const locationPoint = toCanvas(loc.x, loc.y);
      const color = loc.type === "structure" ? "#64748b" : loc.type === "danger" ? "#ef4444" : "#f59e0b";
      const dotSize = loc.type === "structure" ? 3 : 4;

      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(locationPoint.px, locationPoint.py, dotSize, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = "#94a3b8";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(loc.name, locationPoint.px, locationPoint.py - dotSize - 4);
    }

    // Trails
    function drawTrail(context: CanvasRenderingContext2D, trail: { x: number; y: number }[], color: string) {
      if (trail.length < 2) return;
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.beginPath();
      let trailPoint = toCanvas(trail[0].x, trail[0].y);
      context.moveTo(trailPoint.px, trailPoint.py);
      for (let index = 1; index < trail.length; index++) {
        trailPoint = toCanvas(trail[index].x, trail[index].y);
        context.lineTo(trailPoint.px, trailPoint.py);
      }
      context.stroke();
    }
    drawTrail(ctx, data.alphaTrail, "rgba(34,197,94,0.3)");
    drawTrail(ctx, data.bravoTrail, "rgba(6,182,212,0.3)");

    // Drones
    drawDrone(canvas, ctx, data.alphaPos, zoomLevel, "#22c55e", "rgba(34,197,94,0.3)", "α");
    drawDrone(canvas, ctx, data.bravoPos, zoomLevel, "#06b6d4", "rgba(6,182,212,0.3)", "β");
  }, []);

  // ── Resize ────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      if (!canvas) return;
      const dpr       = window.devicePixelRatio || 1;
      const container = canvas.parentElement;
      if (!container) return;
      canvas.width        = container.clientWidth  * dpr;
      canvas.height       = container.clientHeight * dpr;
      canvas.style.width  = container.clientWidth  + "px";
      canvas.style.height = container.clientHeight + "px";
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(canvas, propsRef.current, zoomRef.current);
    }

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draw]);

  // ── Redraw on data / zoom change ──────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    draw(canvas, { alphaPos, bravoPos, alphaTrail, bravoTrail }, zoom);
  }, [alphaPos, bravoPos, alphaTrail, bravoTrail, zoom, draw]);

  // ── Wheel zoom ────────────────────────────────────────────────────────

  function onWheel(wheelEvent: React.WheelEvent) {
    wheelEvent.preventDefault();
    setZoom((prevZoom) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom - wheelEvent.deltaY * 0.001))
    );
  }

  function adjustZoom(delta: number) {
    setZoom((prevZoom) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(prevZoom + delta).toFixed(2)))
    );
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full" onWheel={onWheel}>
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* Zoom controls — top right */}
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <button
          onClick={() => adjustZoom(ZOOM_STEP)}
          className="w-7 h-7 border border-zinc-700 bg-[#0a0f14]/90 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 text-sm flex items-center justify-center transition-colors"
          title="Zoom in"
        >+</button>
        <button
          onClick={() => setZoom(1.0)}
          className="w-7 h-7 border border-zinc-700 bg-[#0a0f14]/90 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 text-[9px] flex items-center justify-center transition-colors font-mono"
          title="Reset zoom"
        >{(zoom * 100).toFixed(0)}%</button>
        <button
          onClick={() => adjustZoom(-ZOOM_STEP)}
          className="w-7 h-7 border border-zinc-700 bg-[#0a0f14]/90 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 text-sm flex items-center justify-center transition-colors"
          title="Zoom out"
        >−</button>
      </div>

      {/* Legend — bottom left */}
      <div className="absolute bottom-2 left-2 flex flex-col gap-1 bg-[#0a0f14]/85 border border-zinc-700 px-2 py-1.5">
        {[
          { color: "#22c55e", label: "Alpha"    },
          { color: "#06b6d4", label: "Bravo"    },
          { color: "#ef4444", label: "No Fly"   },
          { color: "#f59e0b", label: "Waypoint" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
