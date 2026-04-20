"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { ADSBData } from "@/types";
import { formatTime } from "@/lib/utils";
import type { VhhhStaticLayers } from "@/mock/vhhh-static";
import { Plane, ZoomIn, ZoomOut, Maximize2, Focus, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ADSBMapProps {
  adsbData: ADSBData[];
  visibleAircraftSet?: Set<string>;
  staticLayers?: VhhhStaticLayers;
  currentTime?: number;
  selectedAircraft?: string;
  onAircraftSelect?: (icao24: string) => void;
  toggles?: {
    trails?: boolean;
  };
}

function clampHeading(deg: unknown) {
  const n = typeof deg === "number" ? deg : Number(deg);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

function rgba(rgb: { r: number; g: number; b: number }, a: number) {
  const aa = Math.max(0, Math.min(1, a));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${aa})`;
}

function buildAircraftDivIcon(p: ADSBData, isSelected: boolean) {
  const size = 28;
  const heading = clampHeading(p.heading);

  const base = isSelected ? "#ef4444" : "#0ea5e9";
  const nose = isSelected ? "#fbbf24" : "#ffffff";
  const ring = isSelected ? "rgba(239,68,68,0.35)" : "rgba(14,165,233,0.28)";

  // Rotate only the inner SVG; Leaflet positions outer container via transform.
  const html = `
    <div style="width:${size}px;height:${size}px;position:relative;">
      <div style="position:absolute;left:50%;top:50%;width:${size}px;height:${size}px;transform:translate(-50%,-50%);border-radius:9999px;border:1px solid ${ring};background:rgba(0,0,0,0.16);"></div>
      <div style="position:absolute;left:50%;top:50%;width:9px;height:9px;transform:translate(-50%,-50%);border-radius:9999px;background:${base};opacity:0.92;"></div>
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(${heading}deg);transform-origin:50% 50%;">
        <path d="M12 2 L16.8 20 L12 16 L7.2 20 Z" fill="${nose}" opacity="0.9" stroke="rgba(0,0,0,0.35)" stroke-width="0.8" />
      </svg>
    </div>
  `;

  return L.divIcon({
    className: "",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function ADSBMap({
  adsbData,
  visibleAircraftSet,
  staticLayers: _staticLayers,
  currentTime = 0,
  selectedAircraft,
  onAircraftSelect,
  toggles,
}: ADSBMapProps) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const trailsLayerRef = useRef<L.LayerGroup | null>(null);

  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const trailPolylinesRef = useRef<Map<string, L.Polyline[]>>(new Map());

  const onAircraftSelectRef = useRef(onAircraftSelect);
  onAircraftSelectRef.current = onAircraftSelect;

  const [hoveredAircraft, setHoveredAircraft] = useState<ADSBData | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(12);

  const show = {
    trails: toggles?.trails ?? true,
  };

  const normalizedVisibleSet = useMemo(() => {
    if (!visibleAircraftSet) return null;
    const s = new Set<string>();
    for (const id of visibleAircraftSet) s.add(String(id).toLowerCase());
    return s;
  }, [visibleAircraftSet]);

  const saneAdsb = useMemo(() => {
    return adsbData.filter(
      (p) =>
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude) &&
        Math.abs(p.latitude) <= 90 &&
        Math.abs(p.longitude) <= 180 &&
        Number.isFinite(p.timestamp)
    );
  }, [adsbData]);

  const { filteredPoints, currentPoints, boundsAll } = useMemo(() => {
    const filtered = saneAdsb.filter((p) => {
      const timeOk = p.timestamp <= currentTime;
      const targetOk =
        !normalizedVisibleSet || normalizedVisibleSet.size === 0 || normalizedVisibleSet.has(p.icao24.toLowerCase());
      return timeOk && targetOk;
    });

    const byAircraft: Record<string, ADSBData[]> = {};
    for (const p of filtered) {
      if (!byAircraft[p.icao24]) byAircraft[p.icao24] = [];
      byAircraft[p.icao24].push(p);
    }

    const current: ADSBData[] = Object.values(byAircraft).map((arr) =>
      arr.sort((a, b) => a.timestamp - b.timestamp)[arr.length - 1]
    );

    // Fallback: if time filter yields nothing, still show a point per aircraft (first point)
    if (current.length === 0) {
      const firstByAircraft = new Map<string, ADSBData>();
      for (const p of saneAdsb) {
        const targetOk =
          !normalizedVisibleSet || normalizedVisibleSet.size === 0 || normalizedVisibleSet.has(p.icao24.toLowerCase());
        if (!targetOk) continue;
        const prev = firstByAircraft.get(p.icao24);
        if (!prev || p.timestamp < prev.timestamp) firstByAircraft.set(p.icao24, p);
      }
      current.push(...Array.from(firstByAircraft.values()));
    }

    const llAll = saneAdsb
      .map((p) => [p.latitude, p.longitude] as [number, number])
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));

    const boundsAll = llAll.length ? L.latLngBounds(llAll.map(([a, b]) => L.latLng(a, b))) : null;

    return {
      filteredPoints: filtered,
      currentPoints: current,
      boundsAll,
    };
  }, [currentTime, normalizedVisibleSet, saneAdsb]);

  const selectedCurrentPoint = useMemo(
    () => currentPoints.find((p) => p.icao24 === selectedAircraft),
    [currentPoints, selectedAircraft]
  );

  useEffect(() => {
    const host = mapHostRef.current;
    if (!host) return;
    if (mapRef.current) return;

    // Defensive cleanup for HMR/StrictMode
    if ((host as any)._leaflet_id) {
      (host as any)._leaflet_id = undefined;
      delete (host as any)._leaflet_id;
    }

    const map = L.map(host, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });

    mapRef.current = map;
    setZoomLevel(map.getZoom());

    const base = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    baseLayerRef.current = base;

    markersLayerRef.current = L.layerGroup().addTo(map);
    trailsLayerRef.current = L.layerGroup().addTo(map);

    const onZoomEnd = () => setZoomLevel(map.getZoom());
    map.on("zoomend", onZoomEnd);

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(host);

    // fallback view
    map.setView([22.308, 113.918], 12);
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      ro.disconnect();
      map.off("zoomend", onZoomEnd);

      for (const m of markersRef.current.values()) m.remove();
      markersRef.current.clear();

      for (const arr of trailPolylinesRef.current.values()) {
        for (const pl of arr) pl.remove();
      }
      trailPolylinesRef.current.clear();

      trailsLayerRef.current?.remove();
      markersLayerRef.current?.remove();
      baseLayerRef.current?.remove();

      trailsLayerRef.current = null;
      markersLayerRef.current = null;
      baseLayerRef.current = null;

      map.remove();
      mapRef.current = null;

      if ((host as any)._leaflet_id) {
        (host as any)._leaflet_id = undefined;
        delete (host as any)._leaflet_id;
      }
    };
  }, []);

  const fitOnceRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (fitOnceRef.current) return;
    if (!boundsAll) return;

    map.fitBounds(boundsAll, { padding: [24, 24] });
    fitOnceRef.current = true;
  }, [boundsAll]);

  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;

    const nextIds = new Set(currentPoints.map((p) => p.icao24));
    for (const [icao24, marker] of markersRef.current) {
      if (!nextIds.has(icao24)) {
        marker.remove();
        markersRef.current.delete(icao24);
      }
    }

    for (const p of currentPoints) {
      const lat = p.latitude;
      const lon = p.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const isSelected = p.icao24 === selectedAircraft;
      const icon = buildAircraftDivIcon(p, isSelected);

      const existing = markersRef.current.get(p.icao24);
      if (existing) {
        existing.setLatLng([lat, lon]);
        existing.setIcon(icon);
        existing.setZIndexOffset(isSelected ? 1000 : 0);
        continue;
      }

      const marker = L.marker([lat, lon], {
        icon,
        interactive: true,
        keyboard: false,
        bubblingMouseEvents: true,
      });

      marker.on("click", () => onAircraftSelectRef.current?.(p.icao24));
      marker.on("mouseover", () => setHoveredAircraft(p));
      marker.on("mouseout", () => setHoveredAircraft((prev) => (prev?.icao24 === p.icao24 ? null : prev)));

      marker.addTo(layer);
      marker.setZIndexOffset(isSelected ? 1000 : 0);
      markersRef.current.set(p.icao24, marker);
    }

    setHoveredAircraft((prev) => (prev ? currentPoints.find((x) => x.icao24 === prev.icao24) ?? prev : prev));
  }, [currentPoints, selectedAircraft]);

  useEffect(() => {
    const layer = trailsLayerRef.current;
    if (!layer) return;

    // Remove all if trails disabled
    if (!show.trails) {
      for (const arr of trailPolylinesRef.current.values()) {
        for (const pl of arr) pl.remove();
      }
      trailPolylinesRef.current.clear();
      return;
    }

    // Build per-aircraft track points (sorted)
    const byAircraft = new Map<string, ADSBData[]>();
    for (const p of filteredPoints) {
      const arr = byAircraft.get(p.icao24) ?? [];
      arr.push(p);
      byAircraft.set(p.icao24, arr);
    }
    for (const arr of byAircraft.values()) arr.sort((a, b) => a.timestamp - b.timestamp);

    const existingIds = new Set(trailPolylinesRef.current.keys());
    const nextIds = new Set(byAircraft.keys());

    for (const id of existingIds) {
      if (!nextIds.has(id)) {
        const arr = trailPolylinesRef.current.get(id) ?? [];
        for (const pl of arr) pl.remove();
        trailPolylinesRef.current.delete(id);
      }
    }

    const MAX_SEGMENTS = 180;
    const minAlpha = 0.12;
    const maxAlpha = 0.85;

    const blue = { r: 59, g: 130, b: 246 };
    const red = { r: 239, g: 68, b: 68 };

    for (const [icao24, pts] of byAircraft.entries()) {
      if (pts.length < 2) continue;

      const isSelected = icao24 === selectedAircraft;
      const base = isSelected ? red : blue;
      const weight = isSelected ? 3 : 2;

      const step = Math.max(1, Math.ceil((pts.length - 1) / MAX_SEGMENTS));
      const sampled: ADSBData[] = [];
      for (let i = 0; i < pts.length; i += step) sampled.push(pts[i]);
      if (sampled[sampled.length - 1] !== pts[pts.length - 1]) sampled.push(pts[pts.length - 1]);

      const segCount = Math.max(0, sampled.length - 1);
      const want = segCount;
      const have = trailPolylinesRef.current.get(icao24) ?? [];

      // Resize polyline list
      if (have.length > want) {
        for (let i = want; i < have.length; i++) have[i].remove();
        have.length = want;
      } else if (have.length < want) {
        for (let i = have.length; i < want; i++) {
          const pl = L.polyline([], { weight, lineCap: "round" });
          pl.addTo(layer);
          have.push(pl);
        }
      }

      // Update segments
      for (let i = 0; i < want; i++) {
        const a = minAlpha + ((maxAlpha - minAlpha) * (i + 1)) / want;
        const p0 = sampled[i];
        const p1 = sampled[i + 1];
        have[i].setLatLngs([
          [p0.latitude, p0.longitude],
          [p1.latitude, p1.longitude],
        ]);
        have[i].setStyle({
          color: rgba(base, a),
          opacity: 1,
          weight,
        });
      }

      trailPolylinesRef.current.set(icao24, have);
    }
  }, [filteredPoints, selectedAircraft, show.trails]);

  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();

  const handleFitVisible = () => {
    const map = mapRef.current;
    if (!map) return;
    const ll = filteredPoints
      .map((p) => [p.latitude, p.longitude] as [number, number])
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
    if (ll.length === 0) return;
    map.fitBounds(L.latLngBounds(ll.map(([a, b]) => L.latLng(a, b))), { padding: [24, 24] });
  };

  const handleFocusSelected = () => {
    const map = mapRef.current;
    if (!map || !selectedCurrentPoint) return;
    map.setView([selectedCurrentPoint.latitude, selectedCurrentPoint.longitude], Math.max(map.getZoom(), 15), {
      animate: true,
    });
  };

  const handleResetView = () => {
    const map = mapRef.current;
    if (!map || !boundsAll) return;
    map.fitBounds(boundsAll, { padding: [24, 24] });
  };

  return (
    <div className="w-full h-full rounded-lg border bg-muted/20 flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-foreground">🗺️ ADSB Leaflet 地图</span>
          <span className="text-muted-foreground hidden sm:inline">动态点位 · 渐变尾迹</span>
          <span className="text-muted-foreground">t={formatTime(currentTime || 0)}</span>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="absolute top-4 right-4 flex flex-col gap-1 z-10 bg-black/40 backdrop-blur-sm rounded-lg p-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleFitVisible}
            className="h-8 w-8 hover:bg-primary/30"
            title="适配当前可见航迹"
          >
            <Focus className="h-4 w-4" />
          </Button>
          <div className="h-0.5 bg-border/30 mx-2" />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleFocusSelected}
            className="h-8 w-8 hover:bg-primary/30"
            title="聚焦选中目标"
            disabled={!selectedCurrentPoint}
          >
            <LocateFixed className="h-4 w-4" />
          </Button>
          <div className="h-0.5 bg-border/30 mx-2" />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomIn}
            className="h-8 w-8 hover:bg-primary/30"
            title="放大 (滚轮也可缩放)"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="h-0.5 bg-border/30 mx-2" />
          <Button variant="ghost" size="icon" onClick={handleZoomOut} className="h-8 w-8 hover:bg-primary/30">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <div className="h-0.5 bg-border/30 mx-2" />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleResetView}
            className="h-8 w-8 hover:bg-primary/30"
            title="重置视图"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>

        <div ref={mapHostRef} className="absolute inset-0" />

        {hoveredAircraft && (
          <Card className="absolute bottom-4 right-4 p-3 bg-black/90 border-primary/40 text-white text-xs max-w-[min(18rem,calc(100%-2rem))] z-30 backdrop-blur-md shadow-xl ring-1 ring-white/10">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-sm border-b border-primary/30 pb-1.5">
                <Plane className="h-4 w-4 text-cyan-400" />
                {hoveredAircraft.callsign || `ICAO: ${hoveredAircraft.icao24}`}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div className="text-muted-foreground/80">
                  <span className="text-xs">高度</span>
                  <div className="text-cyan-300 font-mono">{hoveredAircraft.altitude?.toLocaleString() || "—"} ft</div>
                </div>
                <div className="text-muted-foreground/80">
                  <span className="text-xs">速度</span>
                  <div className="text-cyan-300 font-mono">{hoveredAircraft.speed?.toFixed(0) || "—"} kts</div>
                </div>
                <div className="text-muted-foreground/80">
                  <span className="text-xs">航向</span>
                  <div className="text-cyan-300 font-mono">{hoveredAircraft.heading || "—"}°</div>
                </div>
                <div className="text-muted-foreground/80">
                  <span className="text-xs">爬升率</span>
                  <div className="text-cyan-300 font-mono">{hoveredAircraft.verticalRate || "—"} f/m</div>
                </div>
              </div>
              <div className="text-muted-foreground/70 text-xs border-t border-primary/30 pt-1.5 font-mono">
                📍 {hoveredAircraft.latitude.toFixed(4)}, {hoveredAircraft.longitude.toFixed(4)}
              </div>
            </div>
          </Card>
        )}

        <div className="absolute top-4 left-4 bg-black/45 backdrop-blur-sm rounded px-2 py-1 text-xs text-muted-foreground border border-border/30">
          <div className="font-mono">z={zoomLevel}</div>
          <div>{currentPoints.length} targets</div>
          <div>{filteredPoints.length} pts</div>
          {selectedCurrentPoint ? (
            <div className="text-cyan-300 max-w-[11rem] truncate">SEL: {selectedCurrentPoint.callsign || selectedCurrentPoint.icao24}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
