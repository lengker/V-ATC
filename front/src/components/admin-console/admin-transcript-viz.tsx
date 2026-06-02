"use client";

import { useMemo } from "react";
import type { AdminAnnotation } from "@/lib/admin-console-data";
import { normalizeRelativeSeconds } from "@/lib/backend-api";
import { cn } from "@/lib/utils";

const MIN_BAR_PX = 4;

function segmentBounds(
  seg: AdminAnnotation,
  durationSec: number
): { start: number; end: number } {
  const start = normalizeRelativeSeconds(seg.relative_start, durationSec);
  const endRaw = normalizeRelativeSeconds(seg.relative_end, durationSec);
  const end =
    Number.isFinite(endRaw) && endRaw > start
      ? Math.min(endRaw, durationSec)
      : Math.min(start + 1, durationSec);
  return { start, end: Math.max(start + 0.05, end) };
}

export function AdminTranscriptViz({
  segments,
  durationSec,
  currentSec,
  selectedId,
  onSelect,
  onSeek,
}: {
  segments: AdminAnnotation[];
  durationSec: number;
  currentSec?: number;
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  onSeek?: (t: number) => void;
}) {
  const timelineSec = Math.max(durationSec, 1);

  const bars = useMemo(
    () =>
      segments.map((seg) => {
        const { start, end } = segmentBounds(seg, timelineSec);
        const leftPct = (start / timelineSec) * 100;
        const widthPct = ((end - start) / timelineSec) * 100;
        return { seg, start, end, leftPct, widthPct };
      }),
    [segments, timelineSec]
  );

  return (
    <div className="space-y-1.5">
      <div className="relative h-14 rounded-lg bg-slate-950 border border-slate-600 overflow-hidden">
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(148,163,184,0.15) 0, rgba(148,163,184,0.15) 1px, transparent 1px, transparent calc(100% / 12))",
          }}
        />
        {bars.map(({ seg, start, end, leftPct, widthPct }) => {
          const active = selectedId === seg.annotation_id;
          return (
            <button
              key={seg.annotation_id}
              type="button"
              title={`${start.toFixed(1)}s – ${end.toFixed(1)}s`}
              className={cn(
                "absolute top-1 bottom-1 rounded border text-[10px] overflow-hidden transition-colors",
                active
                  ? "bg-sky-600 border-sky-400 z-10 ring-1 ring-sky-300"
                  : "bg-violet-700/80 border-violet-500/60 hover:bg-violet-600/90 z-0"
              )}
              style={{
                left: `${leftPct}%`,
                width: `max(${MIN_BAR_PX}px, ${widthPct}%)`,
              }}
              onClick={() => {
                onSelect?.(seg.annotation_id);
                onSeek?.(start);
              }}
            >
              <span className="block truncate text-white/95 font-medium px-1 leading-tight">
                {(seg.annotation_text || seg.asr_content || "").slice(0, 12) ||
                  `#${seg.annotation_id}`}
              </span>
            </button>
          );
        })}
        {typeof currentSec === "number" ? (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-20 pointer-events-none"
            style={{ left: `${(Math.min(currentSec, timelineSec) / timelineSec) * 100}%` }}
          />
        ) : null}
      </div>
      <div className="flex justify-between text-xs text-slate-400 tabular-nums">
        <span>0s</span>
        <span>{timelineSec.toFixed(0)}s</span>
      </div>
    </div>
  );
}
