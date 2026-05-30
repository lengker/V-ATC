"use client";

import { useEffect, useMemo, useState } from "react";
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
}: {
  adsbData: ADSBData[];
  visibleSet: Set<string>;
  onVisibleSetChange: (next: Set<string>) => void;
  selectedAircraft?: string;
  onSelectAircraft: (icao24: string) => void;
  /** 顶栏全局搜索命中目标时同步筛选框 */
  externalFilterQuery?: string;
}) {
  const [q, setQ] = useState("");

  useEffect(() => {
    if (externalFilterQuery !== undefined) setQ(externalFilterQuery);
  }, [externalFilterQuery]);
  const [minAlt, setMinAlt] = useState<string>("");
  const [maxAlt, setMaxAlt] = useState<string>("");

  const latestMap = useMemo(() => latestByIcao(adsbData), [adsbData]);

  const selectedTarget = useMemo(() => {
    if (!selectedAircraft) return null;
    return latestMap.get(selectedAircraft) ?? null;
  }, [latestMap, selectedAircraft]);

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
      const aPin = sel && a.icao24.toLowerCase() === sel ? 0 : 1;
      const bPin = sel && b.icao24.toLowerCase() === sel ? 0 : 1;
      if (aPin !== bPin) return aPin - bPin;
      const aVis = visibleSet.has(a.icao24) ? 0 : 1;
      const bVis = visibleSet.has(b.icao24) ? 0 : 1;
      if (aVis !== bVis) return aVis - bVis;
      const labelA = (a.callsign || a.icao24).toLowerCase();
      const labelB = (b.callsign || b.icao24).toLowerCase();
      return labelA.localeCompare(labelB);
    });
  }, [latestMap, q, minAlt, maxAlt, selectedAircraft, visibleSet]);

  const toggle = (icao24: string, checked: boolean) => {
    const next = new Set(visibleSet);
    if (checked) next.add(icao24);
    else next.delete(icao24);
    onVisibleSetChange(next);
  };

  const selectAllFiltered = () => {
    const next = new Set(visibleSet);
    for (const t of targets) next.add(t.icao24);
    onVisibleSetChange(next);
  };

  const clearAllFiltered = () => {
    const next = new Set(visibleSet);
    for (const t of targets) next.delete(t.icao24);
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
                {visibleSet.has(selectedTarget.icao24) ? "地图上显示" : "未勾选显示"}
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
                checked={visibleSet.has(selectedTarget.icao24)}
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
            const checked = visibleSet.has(t.icao24);
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

