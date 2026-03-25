"use client";

import { cn, formatTime } from "@/lib/utils";
import { ADSBData } from "@/types";

export function InstrumentPanel({
  currentTime = 0,
  selectedAircraft,
  adsbData = [],
  className,
}: {
  currentTime?: number;
  selectedAircraft?: string;
  adsbData?: ADSBData[];
  className?: string;
}) {
  const current = adsbData
    .filter((d) => (selectedAircraft ? d.icao24 === selectedAircraft : true) && d.timestamp <= currentTime)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  const heading = current?.heading ?? 0;
  const speed = current?.speed ?? 0;
  const altitude = current?.altitude ?? 0;

  return (
    <div className={cn("rounded-3xl border border-border/70 efb-panel efb-glow", className)}>
      <div className="p-4 border-b border-border/60 flex items-center justify-between">
        <div className="text-sm font-semibold">Flight Instruments</div>
        <div className="text-xs text-muted-foreground">{formatTime(currentTime)}</div>
      </div>

      <div className="p-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border/60 bg-background/20 p-3">
          <div className="text-[10px] text-muted-foreground">HDG</div>
          <div className="text-2xl font-semibold tabular-nums">{Math.round(heading)}°</div>
          <div className="h-2 mt-2 rounded-full bg-background/30 overflow-hidden">
            <div
              className="h-full bg-primary/80"
              style={{ width: `${((heading % 360) / 360) * 100}%` }}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/20 p-3">
          <div className="text-[10px] text-muted-foreground">SPD</div>
          <div className="text-2xl font-semibold tabular-nums">{Math.round(speed)}</div>
          <div className="text-[10px] text-muted-foreground">kts</div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/20 p-3">
          <div className="text-[10px] text-muted-foreground">ALT</div>
          <div className="text-2xl font-semibold tabular-nums">{Math.round(altitude)}</div>
          <div className="text-[10px] text-muted-foreground">ft</div>
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="rounded-2xl border border-border/60 bg-background/20 p-3">
          <div className="text-[10px] text-muted-foreground mb-2">Selected Target</div>
          <div className="text-sm">
            {selectedAircraft ? (
              <span className="font-medium">{selectedAircraft}</span>
            ) : (
              <span className="text-muted-foreground">未选择</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

