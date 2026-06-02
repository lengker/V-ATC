"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { ADSBData, VhhhStaticLayers } from "@/types";
import { formatTime } from "@/lib/utils";
import { buildAdsbTrackIndex, queryAdsbTrailPoints, queryCurrentAdsbPoints } from "@/lib/adsb-interpolation";
import { Plane, ZoomIn, ZoomOut, Maximize2, Focus, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const HONG_KONG_BOUNDS = L.latLngBounds(
  [21.1, 112.45],
  [23.5, 115.39]
);
const VHHH_AIRPORT_CENTER: L.LatLngExpression = [22.308, 113.9185];
const VHHH_DEFAULT_ZOOM = 13;

function enforceHongKongViewport(map: L.Map, animate = false) {
  const minZoom = map.getBoundsZoom(HONG_KONG_BOUNDS, true);
  const targetZoom = Math.max(minZoom, VHHH_DEFAULT_ZOOM);

  map.setMinZoom(minZoom);
  map.setMaxBounds(HONG_KONG_BOUNDS);
  map.setView(VHHH_AIRPORT_CENTER, targetZoom, { animate });
}

interface ADSBMapProps {
  adsbData: ADSBData[];
  visibleAircraftSet?: Set<string>;
  staticLayers?: VhhhStaticLayers;
  currentTime?: number;
  selectedAircraft?: string;
  onAircraftSelect?: (icao24: string) => void;
  toggles?: {
    runways?: boolean;
    taxiways?: boolean;
    waypoints?: boolean;
    landmarks?: boolean;
    trails?: boolean;
    routes?: boolean;
    obstacles?: boolean;
  };
}

function clampHeading(deg: unknown) {
  const n = typeof deg === "number" ? deg : Number(deg);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
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
    className: "adsb-aircraft-icon",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatStaticPointKind(kind?: string) {
  if (kind === "navaid") return "导航台";
  if (kind === "landmark") return "地标";
  return "航路点";
}

export function ADSBMap({
  adsbData,
  visibleAircraftSet,
  staticLayers,
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
  const staticLayerRef = useRef<L.LayerGroup | null>(null);

  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const markerFadeTimeoutsRef = useRef<Map<string, number>>(new Map());
  const trailPolylinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const trailPointMarkersRef = useRef<Map<string, L.CircleMarker>>(new Map());

  const suspendFollowUntilRef = useRef<number>(0);

  const onAircraftSelectRef = useRef(onAircraftSelect);
  onAircraftSelectRef.current = onAircraftSelect;

  const [hoveredAircraft, setHoveredAircraft] = useState<ADSBData | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(12);

  const show = {
    runways: toggles?.runways ?? true,
    taxiways: toggles?.taxiways ?? true,
    waypoints: toggles?.waypoints ?? true,
    landmarks: toggles?.landmarks ?? true,
    trails: toggles?.trails ?? true,
    routes: toggles?.routes ?? true,
    obstacles: toggles?.obstacles ?? true,
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

  const trackIndex = useMemo(() => {
    const isVisible = (icao24: string) => {
      return (
        !normalizedVisibleSet ||
        normalizedVisibleSet.size === 0 ||
        normalizedVisibleSet.has(String(icao24).toLowerCase())
      );
    };

    return buildAdsbTrackIndex(saneAdsb, isVisible);
  }, [normalizedVisibleSet, saneAdsb]);

  const effectiveCurrentTime = useMemo(() => {
    return Number.isFinite(currentTime) ? currentTime : 0;
  }, [currentTime]);

  const currentPoints = useMemo(
    () => queryCurrentAdsbPoints(trackIndex, effectiveCurrentTime),
    [effectiveCurrentTime, trackIndex]
  );

  const trailRenderTime = Math.floor((effectiveCurrentTime || 0) * 2) / 2;
  const filteredPoints = useMemo(
    () => queryAdsbTrailPoints(trackIndex, trailRenderTime),
    [trackIndex, trailRenderTime]
  );

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
      maxBounds: HONG_KONG_BOUNDS,
      maxBoundsViscosity: 1,
      worldCopyJump: false,
    });

    mapRef.current = map;
    setZoomLevel(map.getZoom());

    const base = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      bounds: HONG_KONG_BOUNDS,
      maxZoom: 19,
      noWrap: true,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    baseLayerRef.current = base;

    markersLayerRef.current = L.layerGroup().addTo(map);
    trailsLayerRef.current = L.layerGroup().addTo(map);
    staticLayerRef.current = L.layerGroup().addTo(map);

    const onZoomEnd = () => setZoomLevel(map.getZoom());
    map.on("zoomend", onZoomEnd);

    const suspendFollowFor = (ms: number) => {
      suspendFollowUntilRef.current = Math.max(suspendFollowUntilRef.current, Date.now() + ms);
    };

    const onDragStart = () => suspendFollowFor(1200);
    const onDragEnd = () => suspendFollowFor(400);
    const onZoomStart = () => suspendFollowFor(1200);
    const onMoveStart = () => suspendFollowFor(250);

    map.on("dragstart", onDragStart);
    map.on("dragend", onDragEnd);
    map.on("zoomstart", onZoomStart);
    map.on("movestart", onMoveStart);

    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      enforceHongKongViewport(map);
    });
    ro.observe(host);

    requestAnimationFrame(() => {
      map.invalidateSize();
      enforceHongKongViewport(map);
    });

    return () => {
      ro.disconnect();
      map.off("zoomend", onZoomEnd);

      map.off("dragstart", onDragStart);
      map.off("dragend", onDragEnd);
      map.off("zoomstart", onZoomStart);
      map.off("movestart", onMoveStart);

      for (const m of markersRef.current.values()) m.remove();
      markersRef.current.clear();

      for (const pl of trailPolylinesRef.current.values()) pl.remove();
      trailPolylinesRef.current.clear();
      for (const marker of trailPointMarkersRef.current.values()) marker.remove();
      trailPointMarkersRef.current.clear();

      trailsLayerRef.current?.remove();
      markersLayerRef.current?.remove();
      staticLayerRef.current?.remove();
      baseLayerRef.current?.remove();

      trailsLayerRef.current = null;
      markersLayerRef.current = null;
      staticLayerRef.current = null;
      baseLayerRef.current = null;

      map.remove();
      mapRef.current = null;

      if ((host as any)._leaflet_id) {
        (host as any)._leaflet_id = undefined;
        delete (host as any)._leaflet_id;
      }
    };
  }, []);

  useEffect(() => {
    const layer = staticLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!staticLayers) return;

    if (show.obstacles) {
      for (const zone of staticLayers.obstacleZones ?? []) {
        L.polygon(
          zone.polygon.map((p) => [p.lat, p.lon] as L.LatLngExpression),
          {
            color: "#f97316",
            fillColor: "#f97316",
            fillOpacity: 0.12,
            opacity: 0.7,
            weight: 2,
          }
        )
          .bindTooltip(zone.name, { sticky: true })
          .addTo(layer);
      }
    }

    const lineGroups = [
      ...(show.runways ? staticLayers.runways ?? [] : []),
      ...(show.taxiways ? staticLayers.taxiways ?? [] : []),
    ];
    for (const line of lineGroups) {
      const isRunway = line.kind === "runway";
      L.polyline(
        line.points.map((p) => [p.lat, p.lon] as L.LatLngExpression),
        {
          color: isRunway ? "#f59e0b" : "#94a3b8",
          opacity: isRunway ? 0.86 : 0.65,
          weight: isRunway ? 3 : 2,
          lineCap: "round",
        }
      )
        .bindTooltip(`${line.name}${line.note ? ` · ${line.note}` : ""}`, { sticky: true })
        .addTo(layer);
    }

    if (show.routes) {
      for (const route of staticLayers.routeLines ?? []) {
        L.polyline(
          route.points.map((p) => [p.lat, p.lon] as L.LatLngExpression),
          {
            color: route.kind === "detour" ? "#22c55e" : route.kind === "missed" ? "#ef4444" : "#38bdf8",
            opacity: 0.8,
            weight: 3,
            dashArray: route.kind === "planned" ? "6 6" : undefined,
          }
        )
          .bindTooltip(route.name, { sticky: true })
          .addTo(layer);
      }
    }

    const points = [
      ...(show.waypoints ? staticLayers.waypoints ?? [] : []),
      ...(show.landmarks ? staticLayers.landmarks ?? [] : []),
    ];
    for (const point of points) {
      const isNavaid = point.kind === "navaid";
      const isLandmark = point.kind === "landmark";
      const popupHtml = `
        <div style="min-width:160px">
          <div style="font-weight:700;margin-bottom:4px">${escapeHtml(point.name)}</div>
          <div>类型：${escapeHtml(formatStaticPointKind(point.kind))}</div>
          ${point.note ? `<div>备注：${escapeHtml(point.note)}</div>` : ""}
          <div>坐标：${Number(point.lat).toFixed(5)}, ${Number(point.lon).toFixed(5)}</div>
        </div>
      `;
      L.circleMarker([point.lat, point.lon], {
        radius: isLandmark ? 7 : 5,
        color: isNavaid ? "#a855f7" : isLandmark ? "#10b981" : "#38bdf8",
        fillColor: isNavaid ? "#a855f7" : isLandmark ? "#10b981" : "#38bdf8",
        fillOpacity: 0.85,
        opacity: 0.95,
        weight: 2,
      })
        .bindTooltip(point.name, {
          direction: "top",
          opacity: 0.95,
          sticky: true,
        })
        .bindPopup(popupHtml)
        .addTo(layer);
    }
  }, [
    show.landmarks,
    show.obstacles,
    show.routes,
    show.runways,
    show.taxiways,
    show.waypoints,
    staticLayers,
  ]);

  // Smart viewport follow: keep selected aircraft inside a safe margin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedCurrentPoint) return;

    // If user is interacting or we just moved the map, don't fight.
    if (Date.now() < suspendFollowUntilRef.current) return;

    const host = mapHostRef.current;
    if (!host) return;

    const rect = host.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;

    const MARGIN_PX = 90;
    const latlng = L.latLng(selectedCurrentPoint.latitude, selectedCurrentPoint.longitude);
    const p = map.latLngToContainerPoint(latlng);

    const inSafeX = p.x >= MARGIN_PX && p.x <= w - MARGIN_PX;
    const inSafeY = p.y >= MARGIN_PX && p.y <= h - MARGIN_PX;
    if (inSafeX && inSafeY) return;

    suspendFollowUntilRef.current = Date.now() + 450;
    map.panTo(latlng, { animate: true, duration: 0.45, easeLinearity: 0.25, noMoveStart: true });
  }, [selectedCurrentPoint, currentTime]);

  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;

    const cancelFadeOutIfAny = (icao24: string, marker: L.Marker) => {
      const timeoutId = markerFadeTimeoutsRef.current.get(icao24);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        markerFadeTimeoutsRef.current.delete(icao24);
      }
      const el = marker.getElement();
      if (el) {
        el.style.transition = "opacity 300ms ease";
        el.style.opacity = "1";
        el.style.pointerEvents = "auto";
      }
    };

    const fadeOutAndRemove = (icao24: string, marker: L.Marker) => {
      if (markerFadeTimeoutsRef.current.has(icao24)) return;

      const el = marker.getElement();
      if (el) {
        el.style.transition = "opacity 300ms ease";
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
      }

      const timeoutId = window.setTimeout(() => {
        marker.remove();
        markersRef.current.delete(icao24);
        markerFadeTimeoutsRef.current.delete(icao24);
      }, 320);

      markerFadeTimeoutsRef.current.set(icao24, timeoutId);
    };

    const nextIds = new Set(currentPoints.map((p) => p.icao24));
    for (const [icao24, marker] of markersRef.current) {
      if (!nextIds.has(icao24)) {
        fadeOutAndRemove(icao24, marker);
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
        cancelFadeOutIfAny(p.icao24, existing);
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
      cancelFadeOutIfAny(p.icao24, marker);
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
      for (const pl of trailPolylinesRef.current.values()) pl.remove();
      trailPolylinesRef.current.clear();
      for (const marker of trailPointMarkersRef.current.values()) marker.remove();
      trailPointMarkersRef.current.clear();
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
        trailPolylinesRef.current.get(id)?.remove();
        trailPolylinesRef.current.delete(id);
      }
    }

    const existingPointIds = new Set(trailPointMarkersRef.current.keys());
    for (const id of existingPointIds) {
      const pts = byAircraft.get(id);
      if (!pts || pts.length !== 1) {
        trailPointMarkersRef.current.get(id)?.remove();
        trailPointMarkersRef.current.delete(id);
      }
    }

    const MAX_POINTS_PER_TRAIL = 220;

    for (const [icao24, pts] of byAircraft.entries()) {
      const isSelected = icao24 === selectedAircraft;
      const color = isSelected ? "#ef4444" : "#3b82f6";

      if (pts.length === 1) {
        const p = pts[0];
        let marker = trailPointMarkersRef.current.get(icao24);
        if (!marker) {
          marker = L.circleMarker([p.latitude, p.longitude], {
            radius: isSelected ? 4 : 3,
            color,
            fillColor: color,
            fillOpacity: isSelected ? 0.85 : 0.65,
            opacity: isSelected ? 0.9 : 0.65,
            weight: 1.5,
            interactive: false,
            bubblingMouseEvents: false,
          }).addTo(layer);
          trailPointMarkersRef.current.set(icao24, marker);
        }
        marker.setLatLng([p.latitude, p.longitude]);
        marker.setRadius(isSelected ? 4 : 3);
        marker.setStyle({
          color,
          fillColor: color,
          fillOpacity: isSelected ? 0.85 : 0.65,
          opacity: isSelected ? 0.9 : 0.65,
        });
        continue;
      }

      if (pts.length < 2) continue;

      const weight = isSelected ? 3 : 2;
      const opacity = isSelected ? 0.82 : 0.55;

      const step = Math.max(1, Math.ceil(pts.length / MAX_POINTS_PER_TRAIL));
      const latlngs: L.LatLngExpression[] = [];
      for (let i = 0; i < pts.length; i += step) {
        latlngs.push([pts[i].latitude, pts[i].longitude]);
      }
      const last = pts[pts.length - 1];
      const lastLatLng = latlngs[latlngs.length - 1] as [number, number] | undefined;
      if (!lastLatLng || lastLatLng[0] !== last.latitude || lastLatLng[1] !== last.longitude) {
        latlngs.push([last.latitude, last.longitude]);
      }

      let line = trailPolylinesRef.current.get(icao24);
      if (!line) {
        line = L.polyline([], {
          color,
          opacity,
          weight,
          lineCap: "round",
          lineJoin: "round",
          interactive: false,
          bubblingMouseEvents: false,
        }).addTo(layer);
        trailPolylinesRef.current.set(icao24, line);
      }

      line.setLatLngs(latlngs);
      line.setStyle({ color, opacity, weight });
    }
  }, [filteredPoints, selectedAircraft, show.trails]);

  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();

  const handleFitVisible = () => {
    const map = mapRef.current;
    if (!map) return;
    enforceHongKongViewport(map, true);
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
    if (!map) return;
    enforceHongKongViewport(map, true);
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
        <div className="absolute top-4 right-4 flex flex-col gap-1 z-[1200] pointer-events-auto bg-black/40 backdrop-blur-sm rounded-lg p-1">
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

        <div ref={mapHostRef} className="absolute inset-0 z-0" />

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
          <div>{currentPoints.length} 个目标</div>
          <div>{filteredPoints.length} 个点</div>
          {selectedCurrentPoint ? (
            <div className="text-cyan-300 max-w-[11rem] truncate">已选：{selectedCurrentPoint.callsign || selectedCurrentPoint.icao24}</div>
          ) : null}
        </div>

        <div className="absolute bottom-4 left-4 z-[1200] rounded-lg border border-border/30 bg-black/55 px-3 py-2 text-xs text-white/90 backdrop-blur-sm">
          <div className="mb-1 font-semibold">VSP/AIP 叠加层</div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-6 rounded-full bg-amber-500" />
            <span>跑道</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-purple-500" />
            <span>导航台</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
            <span>航路点</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span>机场点</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-1.5 w-6 rounded-full bg-cyan-400" />
            <span>程序路径</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
            <span>航空器 / 航迹</span>
          </div>
        </div>
      </div>
    </div>
  );
}
