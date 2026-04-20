"use client";

import { useMemo, useState } from "react";
import { ADSBData } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { VirtualList } from "@/components/ui/virtual-list";

export function TargetsPanel({
  adsbData,
  visibleSet,
  onVisibleSetChange,
  selectedAircraft,
  onSelectAircraft,
}: {
  adsbData: ADSBData[];
  visibleSet: Set<string>;
  onVisibleSetChange: (next: Set<string>) => void;
  selectedAircraft?: string;
  onSelectAircraft: (icao24: string) => void;
}) {
  const [q, setQ] = useState("");
  const [minAlt, setMinAlt] = useState<string>("");
  const [maxAlt, setMaxAlt] = useState<string>("");

  const targets = useMemo(() => {
    const latestByAircraft = new Map<string, ADSBData>();
    for (const p of adsbData) {
      const prev = latestByAircraft.get(p.icao24);
      if (!prev || prev.timestamp < p.timestamp) latestByAircraft.set(p.icao24, p);
    }
    const arr = Array.from(latestByAircraft.values()).sort((a, b) => a.icao24.localeCompare(b.icao24));
    const min = minAlt.trim() ? Number(minAlt) : Number.NEGATIVE_INFINITY;
    const max = maxAlt.trim() ? Number(maxAlt) : Number.POSITIVE_INFINITY;
    const altFiltered = arr.filter((x) => x.altitude >= min && x.altitude <= max);

    if (!q.trim()) return altFiltered;
    const t = q.trim().toLowerCase();
    return altFiltered.filter(
      (x) => (x.callsign ?? "").toLowerCase().includes(t) || x.icao24.toLowerCase().includes(t)
    );
  }, [adsbData, q, minAlt, maxAlt]);

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
                className={`rounded-xl border p-2 ${active ? "border-primary bg-primary/10" : "border-border/60 bg-background/20"}`}
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

