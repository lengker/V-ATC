"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { ADSBData } from "@/types";
import { formatTime } from "@/lib/utils";
import type { VhhhStaticLayers } from "@/mock/vhhh-static";
import { deriveBoundsFromData } from "@/mock/vhhh-static";

interface ADSBMapProps {
  adsbData: ADSBData[];
  visibleAircraftSet?: Set<string>;
  staticLayers?: VhhhStaticLayers;
  toggles?: {
    runways?: boolean;
    taxiways?: boolean;
    waypoints?: boolean;
    landmarks?: boolean;
    trails?: boolean;
    /** 计划航路 / 绕飞航路 */
    routes?: boolean;
    /** 天气等障碍多边形 */
    obstacles?: boolean;
  };
  currentTime?: number;
  selectedAircraft?: string;
  onAircraftSelect?: (icao24: string) => void;
}

export function ADSBMap({
  adsbData,
  visibleAircraftSet,
  staticLayers,
  toggles,
  currentTime = 0,
  selectedAircraft,
  onAircraftSelect,
}: ADSBMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const onAircraftSelectRef = useRef(onAircraftSelect);
  onAircraftSelectRef.current = onAircraftSelect;

  const { bounds, currentPoints } = useMemo(() => {
    const sane = adsbData.filter(
      (p) =>
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude) &&
        Math.abs(p.latitude) <= 90 &&
        Math.abs(p.longitude) <= 180 &&
        Number.isFinite(p.timestamp)
    );

    const derived = deriveBoundsFromData({ adsb: sane, statics: staticLayers });

    const filtered = sane.filter((p) => {
      const timeOk = p.timestamp <= currentTime;
      const targetOk = !visibleAircraftSet || visibleAircraftSet.size === 0 || visibleAircraftSet.has(p.icao24);
      return timeOk && targetOk;
    });

    const byAircraft = new Map<string, ADSBData>();
    for (const p of filtered) {
      const prev = byAircraft.get(p.icao24);
      if (!prev || p.timestamp >= prev.timestamp) byAircraft.set(p.icao24, p);
    }

    return {
      bounds: derived,
      currentPoints: Array.from(byAircraft.values()),
    };
  }, [adsbData, currentTime, staticLayers, visibleAircraftSet]);

  const show = {
    trails: toggles?.trails ?? true,
  };

  const fitOnceRef = useRef(false);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    if (mapRef.current) return;

    // Dev/HMR/StrictMode 下更稳的容器清理，避免 “Map container is already initialized”
    if ((container as any)._leaflet_id) {
      (container as any)._leaflet_id = undefined;
      delete (container as any)._leaflet_id;
    }

    const map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
    });

    mapRef.current = map;
    markersLayerRef.current = L.layerGroup().addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    // 初始视图：先给一个兜底视角；bounds 准备好后会 fitBounds
    map.setView([22.308, 113.918], 12);
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      try {
        for (const m of markersRef.current.values()) m.remove();
        markersRef.current.clear();
        markersLayerRef.current?.remove();
        markersLayerRef.current = null;
        map.remove();
      } finally {
        mapRef.current = null;
        if ((container as any)._leaflet_id) {
          (container as any)._leaflet_id = undefined;
          delete (container as any)._leaflet_id;
        }
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (fitOnceRef.current) return;

    const { minLat, maxLat, minLon, maxLon } = bounds;
    if (![minLat, maxLat, minLon, maxLon].every((v) => Number.isFinite(v))) return;
    if (minLat === maxLat && minLon === maxLon) return;

    const b = L.latLngBounds(
      L.latLng(minLat, minLon),
      L.latLng(maxLat, maxLon)
    );
    map.fitBounds(b, { padding: [24, 24] });
    fitOnceRef.current = true;
  }, [bounds]);

  const buildAircraftIcon = (p: ADSBData, isSelected: boolean) => {
    const size = 26;
    const heading = Number.isFinite(p.heading as number) ? (p.heading as number) : 0;
    const base = isSelected ? "#ef4444" : "#0ea5e9";
    const nose = isSelected ? "#fbbf24" : "#ffffff";
    const ring = isSelected ? "rgba(239,68,68,0.35)" : "rgba(14,165,233,0.28)";

    const html = `
      <div style="width:${size}px;height:${size}px;position:relative;">
        <div style="position:absolute;left:50%;top:50%;width:${size}px;height:${size}px;transform:translate(-50%,-50%);border-radius:9999px;border:1px solid ${ring};background:rgba(0,0,0,0.18);"></div>
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
  };

  useEffect(() => {
    if (!show.trails) {
      for (const m of markersRef.current.values()) m.remove();
      markersRef.current.clear();
      return;
    }

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
      const isSelected = p.icao24 === selectedAircraft;
      const lat = p.latitude;
      const lon = p.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const icon = buildAircraftIcon(p, isSelected);
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

      marker.on("click", () => {
        onAircraftSelectRef.current?.(p.icao24);
      });

      marker.addTo(layer);
      marker.setZIndexOffset(isSelected ? 1000 : 0);
      markersRef.current.set(p.icao24, marker);
    }
  }, [currentPoints, selectedAircraft, show.trails]);

  return (
    <div className="w-full h-full rounded-lg border bg-muted/20 flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-foreground">🗺️ ADSB Leaflet 地图</span>
          <span className="text-muted-foreground">t={formatTime(currentTime || 0)}</span>
        </div>
        <div className="text-muted-foreground">{currentPoints.length} targets</div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
