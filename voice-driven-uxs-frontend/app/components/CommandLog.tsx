"use client";

import { useEffect, useRef } from "react";

export interface LogEntry {
  id: number;
  time: string;
  status: "approved" | "rejected" | "error" | "system" | "executing" | "unknown";
  text: string;
  feedback?: string;
}

interface CommandLogProps {
  entries: LogEntry[];
  isProcessing: boolean;
}

const BORDER: Record<string, string> = {
  approved:  "border-green-500",
  rejected:  "border-red-500",
  error:     "border-red-800",
  system:    "border-zinc-600",
  executing: "border-blue-500",
  unknown:   "border-zinc-700",
};

const TEXT: Record<string, string> = {
  approved:  "text-green-400",
  rejected:  "text-red-400",
  error:     "text-red-600",
  system:    "text-zinc-400",
  executing: "text-blue-400",
  unknown:   "text-zinc-500",
};

export default function CommandLog({ entries, isProcessing }: CommandLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`border-l-2 pl-3 py-1 ${BORDER[entry.status] ?? BORDER.unknown}`}
        >
          <div className="text-[10px] text-zinc-600 font-mono">{entry.time}</div>
          <div className="text-sm text-zinc-200">{entry.text}</div>
          {entry.feedback && (
            <div className={`text-xs mt-0.5 italic ${TEXT[entry.status] ?? TEXT.unknown}`}>
              {entry.feedback}
            </div>
          )}
        </div>
      ))}

      {isProcessing && (
        <div className="border-l-2 border-amber-600 pl-3 py-1 text-amber-400 text-xs animate-pulse">
          Processing...
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
