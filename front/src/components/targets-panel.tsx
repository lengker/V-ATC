"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveWallClockTick } from "@/hooks/use-live-wall-clock-tick";
import { buildAdsbTrackIndex } from "@/lib/adsb-interpolation";
import { getAircraftStateForAuxInfo, sampleAircraftAtWallTime } from "@/lib/adsb-playback";
import {
  matchesFlightKey,
  passesMapDisplayQuality,
} from "@/lib/recording-adsb-alignment";
import { ADSBData } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { VirtualList } from "@/components/ui/virtual-list";
import { cn } from "@/lib/utils";

function latestByIcao(adsbData: ADSBData[]): Map<string, ADSBData> {
  const map = new Map<string, ADSBData>();
  for (const p of adsbData) {
    const prev = map.get(p.icao24);
    if (!prev || prev.timestamp < p.timestamp) map.set(p.icao24, p);
  }
  return map;
}

export function TargetsPanel({
  adsbData,
  visibleSet,
  onVisibleSetChange,
  selectedAircraft,
  onSelectAircraft,
  externalFilterQuery,
  currentTime = 0,
  recordingUtcStartSec,
  recordingDurationSec,
  useLiveWallClockNow = false,
  mapForceKeys = [],
}: {
  adsbData: ADSBData[];
  visibleSet: Set<string>;
  onVisibleSetChange: (next: Set<string>) => void;
  selectedAircraft?: string;
  onSelectAircraft: (icao24: string) => void;
  /** 顶栏全局搜索命中目标时同步筛选框 */
  externalFilterQuery?: string;
  currentTime?: number;
  recordingUtcStartSec?: number;
  recordingDurationSec?: number;
  /** 地图「实时 OpenSky」开启且未在播放录音 */
  useLiveWallClockNow?: boolean;
  /** 录音主目标等：全选时仍保留在可见集 */
  mapForceKeys?: string[];
}) {
  const [q, setQ] = useState("");

  useEffect(() => {
    if (externalFilterQuery !== undefined) setQ(externalFilterQuery);
  }, [externalFilterQuery]);
  const [minAlt, setMinAlt] = useState<string>("");
  const [maxAlt, setMaxAlt] = useState<string>("");

  const hasLiveLayer = useMemo(() => adsbData.some((p) => p.live), [adsbData]);
  const recordingWall =
    recordingUtcStartSec != null && recordingUtcStartSec > 1_000_000_000;
  const needLiveTick = useLiveWallClockNow || (hasLiveLayer && !recordingWall);
  const needPlaybackTick = recordingWall && !useLiveWallClockNow;
  const liveTick = useLiveWallClockTick(needLiveTick);
  const playbackTick = useLiveWallClockTick(needPlaybackTick, 250);

  const liveTrackIndex = useMemo(() => {
    const liveOnly = adsbData.filter((p) => p.live);
    return buildAdsbTrackIndex(liveOnly.length > 0 ? liveOnly : adsbData);
  }, [adsbData]);

  const forceKeysForMap = useMemo(
    () => new Set(mapForceKeys.map((k) => k.toLowerCase()).filter(Boolean)),
    [mapForceKeys]
  );

  const latestMap = useMemo(() => {
    if (!useLiveWallClockNow || !hasLiveLayer) return latestByIcao(adsbData);
    const wallSec = Date.now() / 1000;
    const liveOnly = adsbData.filter((p) => p.live);
    const index = buildAdsbTrackIndex(liveOnly);
    const map = new Map<string, ADSBData>();
    for (const [icao24, arr] of index.tracks) {
      const p = sampleAircraftAtWallTime(arr, wallSec, { maxExtrapolateSec: 120 });
      if (p) map.set(icao24.toLowerCase(), p);
    }
    for (const p of latestByIcao(adsbData).values()) {
      if (!map.has(p.icao24.toLowerCase())) map.set(p.icao24.toLowerCase(), p);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- liveTick 驱动墙钟重采样
  }, [adsbData, hasLiveLayer, liveTick, useLiveWallClockNow]);

  const auxOpts = useMemo(
    () => ({
      ...(useLiveWallClockNow ? { useLiveWallClockNow: true as const } : {}),
      ...(recordingWall && recordingDurationSec != null && recordingDurationSec > 0
        ? { recordingDurationSec }
        : {}),
    }),
    [recordingDurationSec, recordingWall, useLiveWallClockNow]
  );

  const selectedTarget = useMemo(() => {
    if (!selectedAircraft) return null;
    const fromAux = getAircraftStateForAuxInfo(
      adsbData,
      selectedAircraft,
      currentTime,
      recordingUtcStartSec,
      auxOpts
    );
    if (fromAux) return fromAux;
    if (useLiveWallClockNow) {
      return (
        latestMap.get(selectedAircraft) ??
        [...latestMap.values()].find((p) => matchesFlightKey(p, selectedAircraft)) ??
        null
      );
    }
    return (
      adsbData.find((p) => matchesFlightKey(p, selectedAircraft)) ??
      latestMap.get(selectedAircraft) ??
      [...latestMap.values()].find((p) => matchesFlightKey(p, selectedAircraft)) ??
      null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- liveTick/playbackTick 驱动墙钟重采样
  }, [
    adsbData,
    auxOpts,
    currentTime,
    latestMap,
    liveTick,
    playbackTick,
    recordingUtcStartSec,
    selectedAircraft,
  ]);

  const targets = useMemo(() => {
    const arr = Array.from(latestMap.values());
    const min = minAlt.trim() ? Number(minAlt) : Number.NEGATIVE_INFINITY;
    const max = maxAlt.trim() ? Number(maxAlt) : Number.POSITIVE_INFINITY;
    let filtered = arr.filter((x) => x.altitude >= min && x.altitude <= max);

    if (q.trim()) {
      const t = q.trim().toLowerCase();
      filtered = filtered.filter(
        (x) =>
          (x.callsign ?? "").toLowerCase().includes(t) ||
          x.icao24.toLowerCase().includes(t)
      );
    }

    const sel = selectedAircraft?.toLowerCase();
    return [...filtered].sort((a, b) => {
      const aPin = sel && matchesFlightKey(a, sel) ? 0 : 1;
      const bPin = sel && matchesFlightKey(b, sel) ? 0 : 1;
      if (aPin !== bPin) return aPin - bPin;
      const aVis = visibleSet.has(a.icao24.toLowerCase()) ? 0 : 1;
      const bVis = visibleSet.has(b.icao24.toLowerCase()) ? 0 : 1;
      if (aVis !== bVis) return aVis - bVis;
      const labelA = (a.callsign || a.icao24).toLowerCase();
      const labelB = (b.callsign || b.icao24).toLowerCase();
      return labelA.localeCompare(labelB);
    });
  }, [latestMap, q, minAlt, maxAlt, selectedAircraft, visibleSet]);

  const toggle = (icao24: string, checked: boolean) => {
    const key = icao24.toLowerCase();
    const next = new Set(visibleSet);
    if (checked) next.add(key);
    else next.delete(key);
    onVisibleSetChange(next);
  };

  const selectAllFiltered = () => {
    const next = new Set(visibleSet);
    const wallSec = Date.now() / 1000;
    for (const t of targets) {
      const arr =
        liveTrackIndex.tracks.get(t.icao24.toLowerCase()) ??
        [...liveTrackIndex.tracks.values()].find((pts) =>
          matchesFlightKey(pts[0], t.icao24)
        );
      if (
        arr &&
        !passesMapDisplayQuality(arr, {
          wallSec,
          forceKeys: forceKeysForMap,
        })
      ) {
        continue;
      }
      next.add(t.icao24.toLowerCase());
      if (t.callsign?.trim()) next.add(t.callsign.trim().toLowerCase());
    }
    onVisibleSetChange(next);
  };

  const clearAllFiltered = () => {
    const next = new Set(visibleSet);
    for (const t of targets) next.delete(t.icao24.toLowerCase());
    onVisibleSetChange(next);
  };

  return (
    <Card className="rounded-3xl border-border/70 efb-panel efb-glow">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Targets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {selectedTarget ? (
          <div className="rounded-2xl border border-primary/70 bg-primary/10 p-3 shadow-sm shadow-primary/10">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                当前选中
              </span>
              <span className="text-[10px] text-muted-foreground">
                {visibleSet.has(selectedTarget.icao24.toLowerCase()) ? "地图上显示" : "未勾选显示"}
              </span>
            </div>
            <button
              type="button"
              className="w-full text-left"
              onClick={() => onSelectAircraft(selectedTarget.icao24)}
            >
              <div className="text-base font-semibold leading-tight">
                {selectedTarget.callsign || selectedTarget.icao24}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{selectedTarget.icao24}</div>
            </button>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div>
                <dt className="text-muted-foreground">高度</dt>
                <dd className="font-medium tabular-nums">{Math.round(selectedTarget.altitude)} ft</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">速度</dt>
                <dd className="font-medium tabular-nums">{Math.round(selectedTarget.speed)} kts</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">航向</dt>
                <dd className="font-medium tabular-nums">
                  {Number.isFinite(selectedTarget.heading)
                    ? `${selectedTarget.heading.toFixed(1)}°`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">位置</dt>
                <dd className="font-medium tabular-nums">
                  {selectedTarget.latitude.toFixed(4)}, {selectedTarget.longitude.toFixed(4)}
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex items-center gap-2">
              <Checkbox
                checked={visibleSet.has(selectedTarget.icao24.toLowerCase())}
                onCheckedChange={(v) => toggle(selectedTarget.icao24, Boolean(v))}
              />
              <span className="text-xs text-muted-foreground">在地图上显示该目标</span>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
            点击地图上的飞机图标，此处将显示该目标详情并置顶到列表
          </p>
        )}
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索呼号 / ICAO…"
          className="h-9 bg-background/40 border-border/60"
        />
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={minAlt}
            onChange={(e) => setMinAlt(e.target.value)}
            placeholder="最小高度(ft)"
            className="h-9 bg-background/40 border-border/60"
          />
          <Input
            value={maxAlt}
            onChange={(e) => setMaxAlt(e.target.value)}
            placeholder="最大高度(ft)"
            className="h-9 bg-background/40 border-border/60"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" className="h-8 rounded-full text-xs px-3" onClick={selectAllFiltered}>
            全选过滤结果
          </Button>
          <Button type="button" variant="outline" className="h-8 rounded-full text-xs px-3" onClick={clearAllFiltered}>
            全不选过滤结果
          </Button>
        </div>
        <VirtualList
          items={targets}
          className="h-[180px] pr-2"
          gapPx={8}
          overscan={10}
          estimateSizePx={56}
          getKey={(t) => t.icao24}
          empty={
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              暂无目标
            </div>
          }
          renderItem={(t) => {
            const checked = visibleSet.has(t.icao24.toLowerCase());
            const active = selectedAircraft === t.icao24;
            return (
              <div
                className={cn(
                  "rounded-xl border p-2",
                  active
                    ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                    : "border-border/60 bg-background/20"
                )}
              >
                <div className="flex items-center gap-2">
                  <Checkbox checked={checked} onCheckedChange={(v) => toggle(t.icao24, Boolean(v))} />
                  <button className="flex-1 text-left" onClick={() => onSelectAircraft(t.icao24)}>
                    <div className="text-sm font-medium">{t.callsign || t.icao24}</div>
                    <div className="text-xs text-muted-foreground">{t.icao24}</div>
                  </button>
                  <div className="text-xs text-muted-foreground tabular-nums">{Math.round(t.altitude)}ft</div>
                </div>
              </div>
            );
          }}
        />
      </CardContent>
    </Card>
  );
}

