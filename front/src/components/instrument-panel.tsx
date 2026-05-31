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
    <div className={cn("overflow-hidden rounded-lg border border-border/70 efb-panel efb-glow", className)}>
      <div className="border-b border-border/60 p-2 flex items-center justify-between">
        <div className="text-sm font-semibold">飞行仪表</div>
        <div className="text-xs text-muted-foreground">{formatTime(currentTime)}</div>
      </div>

      <div className="grid grid-cols-3 gap-2 p-2">
        <div className="rounded-lg border border-border/60 bg-background/20 p-2">
          <div className="text-[10px] text-muted-foreground">航向</div>
          <div className="text-2xl font-semibold tabular-nums">{Math.round(heading)}°</div>
          <div className="h-2 mt-2 rounded-full bg-background/30 overflow-hidden">
            <div
              className="h-full bg-primary/80"
              style={{ width: `${((heading % 360) / 360) * 100}%` }}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/20 p-2">
          <div className="text-[10px] text-muted-foreground">速度</div>
          <div className="text-2xl font-semibold tabular-nums">{Math.round(speed)}</div>
          <div className="text-[10px] text-muted-foreground">节</div>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/20 p-2">
          <div className="text-[10px] text-muted-foreground">高度</div>
          <div className="text-2xl font-semibold tabular-nums">{Math.round(altitude)}</div>
          <div className="text-[10px] text-muted-foreground">英尺</div>
        </div>
      </div>

      <div className="px-2 pb-2">
        <div className="rounded-lg border border-border/60 bg-background/20 p-2">
          <div className="text-[10px] text-muted-foreground mb-2">已选目标</div>
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

