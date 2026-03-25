"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type LayerTogglesState = {
  runways: boolean;
  taxiways: boolean;
  waypoints: boolean;
  landmarks: boolean;
  trails: boolean;
};

export function LayerToggles({
  value,
  onChange,
  className,
}: {
  value: LayerTogglesState;
  onChange: (next: LayerTogglesState) => void;
  className?: string;
}) {
  const set = (k: keyof LayerTogglesState, v: boolean) => onChange({ ...value, [k]: v });

  return (
    <div className={cn("rounded-2xl border border-border/60 bg-background/20 p-3", className)}>
      <div className="text-xs font-semibold text-muted-foreground mb-2">Layers</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox checked={value.runways} onCheckedChange={(v) => set("runways", Boolean(v))} />
          <span className="text-sm">Runways</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox checked={value.taxiways} onCheckedChange={(v) => set("taxiways", Boolean(v))} />
          <span className="text-sm">Taxiways</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox checked={value.waypoints} onCheckedChange={(v) => set("waypoints", Boolean(v))} />
          <span className="text-sm">Waypoints</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox checked={value.landmarks} onCheckedChange={(v) => set("landmarks", Boolean(v))} />
          <span className="text-sm">Landmarks</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none col-span-2">
          <Checkbox checked={value.trails} onCheckedChange={(v) => set("trails", Boolean(v))} />
          <span className="text-sm">ADSB Trails</span>
        </label>
      </div>
    </div>
  );
}

