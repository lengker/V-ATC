"use client";

import { getAircraftStateForAuxInfo } from "@/lib/adsb-playback";
import { cn, formatTime } from "@/lib/utils";
import { ADSBData } from "@/types";
import { useMemo } from "react";
import { useLiveWallClockTick } from "@/hooks/use-live-wall-clock-tick";

export function InstrumentPanel({
  currentTime = 0,
  selectedAircraft,
  adsbData = [],
  recordingUtcStartSec,
  recordingDurationSec,
  useLiveWallClockNow = false,
  className,
}: {
  currentTime?: number;
  selectedAircraft?: string;
  adsbData?: ADSBData[];
  recordingUtcStartSec?: number;
  recordingDurationSec?: number;
  useLiveWallClockNow?: boolean;
  className?: string;
}) {
  const hasLiveLayer = useMemo(() => adsbData.some((p) => p.live), [adsbData]);
  const recordingWall =
    recordingUtcStartSec != null && recordingUtcStartSec > 1_000_000_000;
  const needLiveTick = useLiveWallClockNow || (hasLiveLayer && !recordingWall);
  const liveTick = useLiveWallClockTick(needLiveTick);
  const auxOpts = useMemo(
    () => ({
      ...(useLiveWallClockNow ? { useLiveWallClockNow: true as const } : {}),
      ...(recordingWall && recordingDurationSec != null && recordingDurationSec > 0
        ? { recordingDurationSec }
        : {}),
    }),
    [recordingDurationSec, recordingWall, useLiveWallClockNow]
  );

  const current = useMemo(
    () =>
      getAircraftStateForAuxInfo(
        adsbData,
        selectedAircraft,
        currentTime,
        recordingUtcStartSec,
        auxOpts
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- liveTick 驱动墙钟重采样
    [adsbData, auxOpts, liveTick, selectedAircraft, currentTime, recordingUtcStartSec]
  );

  const hasData = Boolean(current);
  const heading = hasData ? current!.heading : null;
  const speed = hasData ? current!.speed : null;
  const altitude = hasData ? current!.altitude : null;

  return (
    <div className={cn("rounded-3xl border border-border/70 efb-panel efb-glow", className)}>
      <div className="p-4 border-b border-border/60 flex items-center justify-between">
        <div className="text-sm font-semibold">Flight Instruments</div>
        <div className="text-xs text-muted-foreground">{formatTime(currentTime)}</div>
      </div>

      <div className="p-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border/60 bg-background/20 p-3">
          <div className="text-[10px] text-muted-foreground">HDG</div>
          <div className="text-2xl font-semibold tabular-nums">
            {heading != null && Number.isFinite(heading) ? `${Math.round(heading)}°` : "—"}
          </div>
          <div className="h-2 mt-2 rounded-full bg-background/30 overflow-hidden">
            <div
              className="h-full bg-primary/80"
              style={{
                width: `${heading != null && Number.isFinite(heading) ? ((heading % 360) / 360) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/20 p-3">
          <div className="text-[10px] text-muted-foreground">SPD</div>
          <div className="text-2xl font-semibold tabular-nums">
            {speed != null && Number.isFinite(speed) ? Math.round(speed) : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">kts</div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/20 p-3">
          <div className="text-[10px] text-muted-foreground">ALT</div>
          <div className="text-2xl font-semibold tabular-nums">
            {altitude != null && Number.isFinite(altitude) ? Math.round(altitude) : "—"}
          </div>
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

