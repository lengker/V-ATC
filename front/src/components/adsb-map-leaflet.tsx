"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { ADSBData } from "@/types";
import {
  buildAdsbTrackIndex,
  dedupeAdsbPointsByFlight,
  formatVerticalRateFpm,
  queryAdsbTrailPoints,
  queryCurrentAdsbPoints,
} from "@/lib/adsb-interpolation";
import {
  buildLiveTrailLatLngs,
  queryLivePlaybackPoints,
  sampleAircraftAtWallTime,
  trimTrailBehindTip,
} from "@/lib/adsb-playback";
import type { VhhhStaticLayers } from "@/mock/vhhh-static";
import type { LayerTogglesState } from "@/components/layer-toggles";
import { buildDetourLiveAdsb, DETOUR_ICAO24, getDetourSnapshotAt, getDetourTrailLatLngs } from "@/lib/detour-aircraft";
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
  toggles?: Partial<LayerTogglesState>;
  liveAdsbStatus?: {
    aircraft: number;
    error?: string;
    updatedAt?: number;
    stale?: boolean;
    lastDataAt?: number;
    activeWithinMinutes?: number;
  } | null;
  /** 父组件地图轮询计数，确保航迹折线随数据刷新 */
  mapRefreshRevision?: number;
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

export function ADSBMap({
  adsbData,
  visibleAircraftSet,
  staticLayers,
  currentTime = 0,
  selectedAircraft,
  onAircraftSelect,
  toggles,
  liveAdsbStatus = null,
  mapRefreshRevision = 0,
}: ADSBMapProps) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const trailsLayerRef = useRef<L.LayerGroup | null>(null);
  const staticLayersRef = useRef<L.LayerGroup | null>(null);

  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const markerFadeTimeoutsRef = useRef<Map<string, number>>(new Map());
  const trailPolylinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const trailLatLngsRef = useRef<Map<string, [number, number][]>>(new Map());
  const liveTrailIdsRef = useRef<Set<string>>(new Set());
  const liveTrackIndexRef = useRef<ReturnType<typeof buildAdsbTrackIndex>>({ tracks: new Map() });
  const trackIndexRef = useRef<ReturnType<typeof buildAdsbTrackIndex>>({ tracks: new Map() });
  const currentTimeRef = useRef(currentTime);
  const lastMarkerStyleRef = useRef<Map<string, string>>(new Map());
  const smoothRafRef = useRef<number>(0);

  const suspendFollowUntilRef = useRef<number>(0);
  const mapAliveRef = useRef(false);

  const onAircraftSelectRef = useRef(onAircraftSelect);
  onAircraftSelectRef.current = onAircraftSelect;

  const [hoveredAircraft, setHoveredAircraft] = useState<ADSBData | null>(null);
  const [smoothSelectedPoint, setSmoothSelectedPoint] = useState<ADSBData | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(12);
  const [mapReady, setMapReady] = useState(false);

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

  const isAircraftVisible = useCallback(
    (icao24: string) => {
      if (String(icao24).toLowerCase() === DETOUR_ICAO24) return true;
      if (!normalizedVisibleSet || normalizedVisibleSet.size === 0) return true;
      return normalizedVisibleSet.has(String(icao24).toLowerCase());
    },
    [normalizedVisibleSet]
  );

  const dedupeOpts = useMemo(
    () => ({ minMoveMeters: 120, maxPointsPerFlight: 160 }),
    []
  );

  const { liveAdsb, timelineAdsb, rawPointCount } = useMemo(() => {
    const sane = adsbData.filter(
      (p) =>
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude) &&
        Math.abs(p.latitude) <= 90 &&
        Math.abs(p.longitude) <= 180 &&
        Number.isFinite(p.timestamp)
    );
    const withoutDetour = sane.filter((p) => p.icao24 !== DETOUR_ICAO24);
    const liveRaw = withoutDetour.filter((p) => p.live);
    const timelineRaw = withoutDetour.filter((p) => !p.live);
    const hadDetour = sane.some((p) => p.icao24 === DETOUR_ICAO24);
    const detourTrack = hadDetour ? buildDetourLiveAdsb() : [];
    return {
      liveAdsb: [...dedupeAdsbPointsByFlight(liveRaw, dedupeOpts), ...detourTrack],
      timelineAdsb: dedupeAdsbPointsByFlight(timelineRaw, dedupeOpts),
      rawPointCount: sane.length,
    };
  }, [adsbData, dedupeOpts]);

  const saneAdsb = useMemo(() => [...liveAdsb, ...timelineAdsb], [liveAdsb, timelineAdsb]);

  const boundsAll = useMemo(() => {
    const llAll = saneAdsb
      .filter((p) => isAircraftVisible(p.icao24))
      .map((p) => [p.latitude, p.longitude] as [number, number])
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));

    return llAll.length ? L.latLngBounds(llAll.map(([a, b]) => L.latLng(a, b))) : null;
  }, [isAircraftVisible, saneAdsb]);

  const trackIndex = useMemo(
    () => buildAdsbTrackIndex(timelineAdsb, isAircraftVisible, dedupeOpts),
    [dedupeOpts, isAircraftVisible, timelineAdsb]
  );

  const liveTrackIndex = useMemo(
    () => buildAdsbTrackIndex(liveAdsb, isAircraftVisible, dedupeOpts),
    [dedupeOpts, isAircraftVisible, liveAdsb]
  );

  const currentPoints = useMemo(() => {
    const timeline = queryCurrentAdsbPoints(trackIndex, currentTime);
    const wallSec = Date.now() / 1000;
    const liveNow =
      liveAdsb.length > 0
        ? queryLivePlaybackPoints(liveTrackIndex, wallSec, { maxExtrapolateSec: 120 })
        : [];
    const byIcao = new Map<string, ADSBData>();
    for (const p of timeline) byIcao.set(p.icao24, p);
    for (const p of liveNow) {
      if (p.icao24 === DETOUR_ICAO24) continue;
      byIcao.set(p.icao24, p);
    }
    if (liveAdsb.some((p) => p.icao24 === DETOUR_ICAO24)) {
      byIcao.set(DETOUR_ICAO24, getDetourSnapshotAt(wallSec));
    }
    return [...byIcao.values()];
  }, [currentTime, liveAdsb, liveTrackIndex, trackIndex, mapRefreshRevision]);

  const trailRenderTime = Math.floor((currentTime || 0) * 2) / 2;
  const filteredPoints = useMemo(() => {
    return queryAdsbTrailPoints(trackIndex, trailRenderTime);
  }, [trackIndex, trailRenderTime, mapRefreshRevision]);

  useEffect(() => {
    liveTrackIndexRef.current = liveTrackIndex;
    trackIndexRef.current = trackIndex;
    currentTimeRef.current = currentTime;
  }, [liveTrackIndex, trackIndex, currentTime]);

  const selectedCurrentPoint = useMemo(() => {
    if (smoothSelectedPoint?.icao24 === selectedAircraft) return smoothSelectedPoint;
    return currentPoints.find((p) => p.icao24 === selectedAircraft) ?? null;
  }, [currentPoints, selectedAircraft, smoothSelectedPoint]);

  useEffect(() => {
    if (!mapReady || !mapAliveRef.current) return;

    let frame = 0;
    const loop = () => {
      if (!mapAliveRef.current) return;

      const wallSec = Date.now() / 1000;
      const animated = new Map<string, ADSBData>();

      for (const p of queryCurrentAdsbPoints(trackIndexRef.current, currentTimeRef.current)) {
        animated.set(p.icao24, p);
      }

      for (const [id, arr] of liveTrackIndexRef.current.tracks) {
        if (id === DETOUR_ICAO24) {
          animated.set(id, getDetourSnapshotAt(wallSec));
          continue;
        }
        const p = sampleAircraftAtWallTime(arr, wallSec, { maxExtrapolateSec: 120 });
        if (p) animated.set(id, p);
      }

      if (selectedAircraft) {
        const sel = animated.get(selectedAircraft);
        if (sel && frame % 2 === 0) setSmoothSelectedPoint(sel);
      } else if (frame % 15 === 0) {
        setSmoothSelectedPoint((prev) => (prev ? null : prev));
      }

      for (const [id, p] of animated) {
        const marker = markersRef.current.get(id);
        if (!marker) continue;
        try {
          marker.setLatLng([p.latitude, p.longitude]);
        } catch {
          continue;
        }
        const isSelected = id === selectedAircraft;
        const styleKey = `${Math.round(p.heading)}-${isSelected}`;
        if (lastMarkerStyleRef.current.get(id) !== styleKey) {
          marker.setIcon(buildAircraftDivIcon(p, isSelected));
          marker.setZIndexOffset(isSelected ? 1000 : 0);
          lastMarkerStyleRef.current.set(id, styleKey);
        }
      }

      if (show.trails) {
        for (const id of liveTrailIdsRef.current) {
          const line = trailPolylinesRef.current.get(id);
          if (!line) continue;

          if (id === DETOUR_ICAO24) {
            const latlngs = getDetourTrailLatLngs(wallSec);
            if (latlngs.length < 2) continue;
            try {
              line.setLatLngs(latlngs);
            } catch {
              // ignore
            }
            continue;
          }

          const arr = liveTrackIndexRef.current.tracks.get(id);
          if (!arr || arr.length < 2) continue;
          const latlngs = buildLiveTrailLatLngs(arr, wallSec, {
            maxExtrapolateSec: 120,
            maxPoints: 200,
          });
          if (latlngs.length < 2) continue;
          try {
            line.setLatLngs(latlngs);
          } catch {
            // ignore
          }
        }

        for (const [id, base] of trailLatLngsRef.current) {
          if (liveTrailIdsRef.current.has(id)) continue;
          const tip = animated.get(id);
          const line = trailPolylinesRef.current.get(id);
          if (!tip || !line || base.length < 2) continue;
          try {
            const tipLl: [number, number] = [tip.latitude, tip.longitude];
            const trimmed = trimTrailBehindTip(
              [...base.slice(0, -1), tipLl],
              tipLl
            );
            line.setLatLngs(trimmed.length >= 2 ? trimmed : trimmed);
          } catch {
            // ignore
          }
        }
      }

      const map = mapRef.current;
      const follow = selectedAircraft ? animated.get(selectedAircraft) : null;
      if (map && follow && Date.now() >= suspendFollowUntilRef.current) {
        const host = mapHostRef.current;
        if (host) {
          const rect = host.getBoundingClientRect();
          const w = rect.width;
          const h = rect.height;
          if (w > 0 && h > 0) {
            const MARGIN_PX = 90;
            const latlng = L.latLng(follow.latitude, follow.longitude);
            const pt = map.latLngToContainerPoint(latlng);
            const inSafeX = pt.x >= MARGIN_PX && pt.x <= w - MARGIN_PX;
            const inSafeY = pt.y >= MARGIN_PX && pt.y <= h - MARGIN_PX;
            if (!inSafeX || !inSafeY) {
              suspendFollowUntilRef.current = Date.now() + 450;
              try {
                map.panTo(latlng, { animate: true, duration: 0.45, easeLinearity: 0.25, noMoveStart: true });
              } catch {
                // ignore
              }
            }
          }
        }
      }

      frame++;
      smoothRafRef.current = requestAnimationFrame(loop);
    };

    smoothRafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(smoothRafRef.current);
      smoothRafRef.current = 0;
    };
  }, [mapReady, selectedAircraft, show.trails]);

  useEffect(() => {
    const host = mapHostRef.current;
    if (!host) return;
    if (mapRef.current) return;

    mapAliveRef.current = true;

    const safeInvalidateSize = () => {
      const map = mapRef.current;
      if (!mapAliveRef.current || !map) return;
      const container = map.getContainer();
      if (!container?.isConnected) return;
      // Leaflet 在卸载/HMR 过程中 _mapPane 可能尚未就绪
      if (!(map as unknown as { _mapPane?: HTMLElement })._mapPane) return;
      try {
        map.invalidateSize();
      } catch {
        // ignore teardown races
      }
    };

    // Defensive cleanup for HMR/StrictMode
    if ((host as any)._leaflet_id) {
      (host as any)._leaflet_id = undefined;
      delete (host as any)._leaflet_id;
    }

    const map = L.map(host, {
      zoomControl: false,
      attributionControl: true,
      // preferCanvas 在频繁 setLatLngs / 组件卸载时易触发 CanvasRenderer._clear 读 undefined.save
      preferCanvas: false,
    });

    mapRef.current = map;
    setZoomLevel(map.getZoom());

    const base = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    baseLayerRef.current = base;

    staticLayersRef.current = L.layerGroup().addTo(map);
    trailsLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    setMapReady(true);

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

    let ro: ResizeObserver | null = null;
    map.whenReady(() => {
      safeInvalidateSize();
      ro = new ResizeObserver(() => safeInvalidateSize());
      ro.observe(host);
    });

    // fallback view
    map.setView([22.308, 113.918], 12);
    requestAnimationFrame(() => safeInvalidateSize());

    return () => {
      mapAliveRef.current = false;
      ro?.disconnect();
      setMapReady(false);
      map.off("zoomend", onZoomEnd);

      map.off("dragstart", onDragStart);
      map.off("dragend", onDragEnd);
      map.off("zoomstart", onZoomStart);
      map.off("movestart", onMoveStart);

      for (const m of markersRef.current.values()) m.remove();
      markersRef.current.clear();

      for (const pl of trailPolylinesRef.current.values()) pl.remove();
      trailPolylinesRef.current.clear();

      staticLayersRef.current?.remove();
      trailsLayerRef.current?.remove();
      markersLayerRef.current?.remove();
      baseLayerRef.current?.remove();

      staticLayersRef.current = null;
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
    if (!mapAliveRef.current || !map) return;
    if (fitOnceRef.current) return;
    if (!boundsAll || saneAdsb.length < 2) return;

    map.fitBounds(boundsAll, { padding: [24, 24] });
    fitOnceRef.current = true;
  }, [boundsAll, saneAdsb.length]);

  useEffect(() => {
    if (!mapAliveRef.current || !mapRef.current) return;
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
        existing.setZIndexOffset(isSelected ? 1000 : 0);
        const styleKey = `${Math.round(p.heading)}-${isSelected}`;
        if (lastMarkerStyleRef.current.get(p.icao24) !== styleKey) {
          existing.setIcon(icon);
          lastMarkerStyleRef.current.set(p.icao24, styleKey);
        }
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
      lastMarkerStyleRef.current.set(
        p.icao24,
        `${Math.round(p.heading)}-${p.icao24 === selectedAircraft}`
      );
    }

    setHoveredAircraft((prev) => (prev ? currentPoints.find((x) => x.icao24 === prev.icao24) ?? prev : prev));
  }, [currentPoints, selectedAircraft, mapRefreshRevision]);

  useEffect(() => {
    if (!mapAliveRef.current || !mapRef.current) return;
    const layer = trailsLayerRef.current;
    if (!layer) return;

    // Remove all if trails disabled
    if (!show.trails) {
      for (const pl of trailPolylinesRef.current.values()) pl.remove();
      trailPolylinesRef.current.clear();
      trailLatLngsRef.current.clear();
      return;
    }

    // Build per-aircraft track points (sorted)
    const byAircraft = new Map<string, ADSBData[]>();
    for (const p of filteredPoints) {
      if (liveTrailIdsRef.current.has(p.icao24)) continue;
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
        trailLatLngsRef.current.delete(id);
      }
    }

    const MAX_POINTS_PER_TRAIL = 2000;

    for (const [icao24, pts] of byAircraft.entries()) {
      if (pts.length < 2) continue;

      const isSelected = icao24 === selectedAircraft;
      const isLiveTrail = pts.some((p) => p.live);
      const color = isSelected ? "#ef4444" : "#3b82f6";
      const weight = isSelected ? 3 : 2;
      const opacity = isSelected ? 0.82 : 0.55;

      const cap = isLiveTrail ? 200 : MAX_POINTS_PER_TRAIL;
      const step = Math.max(1, Math.ceil(pts.length / cap));
      const latlngs: L.LatLngExpression[] = [];
      for (let i = 0; i < pts.length; i += step) {
        latlngs.push([pts[i].latitude, pts[i].longitude]);
      }
      const last = pts[pts.length - 1];
      const tipLl: [number, number] = [last.latitude, last.longitude];
      const trimmed = trimTrailBehindTip(
        latlngs.map((ll) => {
          const t = ll as [number, number];
          return [t[0], t[1]] as [number, number];
        }),
        tipLl
      );
      if (trimmed.length < 2) continue;

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

      const tuples = trimmed;
      trailLatLngsRef.current.set(icao24, tuples);

      try {
        line.setLatLngs(tuples);
        line.setStyle({ color, opacity, weight });
      } catch {
        // 地图卸载/HMR 竞态时忽略
      }
    }
  }, [filteredPoints, selectedAircraft, show.trails, mapRefreshRevision]);

  useEffect(() => {
    if (!mapAliveRef.current || !mapRef.current) return;
    const layer = trailsLayerRef.current;
    if (!layer) return;

    const nextLiveIds = new Set<string>();
    if (show.trails && liveAdsb.length > 0) {
      for (const [icao24, arr] of liveTrackIndex.tracks) {
        if (arr.length >= 2) nextLiveIds.add(icao24);
      }
    }

    for (const id of liveTrailIdsRef.current) {
      if (nextLiveIds.has(id)) continue;
      liveTrailIdsRef.current.delete(id);
      const line = trailPolylinesRef.current.get(id);
      if (line && !filteredPoints.some((p) => p.icao24 === id)) {
        line.remove();
        trailPolylinesRef.current.delete(id);
        trailLatLngsRef.current.delete(id);
      }
    }

    if (!show.trails || liveAdsb.length === 0) {
      for (const id of [...liveTrailIdsRef.current]) {
        const line = trailPolylinesRef.current.get(id);
        if (line) {
          line.remove();
          trailPolylinesRef.current.delete(id);
          trailLatLngsRef.current.delete(id);
        }
      }
      liveTrailIdsRef.current.clear();
      return;
    }

    for (const icao24 of nextLiveIds) {
      liveTrailIdsRef.current.add(icao24);
      if (trailPolylinesRef.current.has(icao24)) continue;
      const arr = liveTrackIndex.tracks.get(icao24);
      if (!arr || arr.length < 2) continue;

      const isSelected = icao24 === selectedAircraft;
      const color = isSelected ? "#ef4444" : "#3b82f6";
      const weight = isSelected ? 3 : 2;
      const opacity = isSelected ? 0.82 : 0.55;

      const line = L.polyline([], {
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
  }, [filteredPoints, liveAdsb.length, liveTrackIndex, selectedAircraft, show.trails, mapRefreshRevision]);

  useEffect(() => {
    const layer = staticLayersRef.current;
    if (!layer || !mapReady) return;
    layer.clearLayers();

    const toLatLngs = (points: Array<{ lat: number; lon: number }>) => {
      const latlngs: L.LatLngExpression[] = [];
      for (const p of points) {
        if (
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lon) &&
          Math.abs(p.lat) <= 90 &&
          Math.abs(p.lon) <= 180
        ) {
          latlngs.push([p.lat, p.lon]);
        }
      }
      return latlngs;
    };

    if (show.obstacles) {
      for (const z of staticLayers?.obstacleZones ?? []) {
        const latlngs = toLatLngs(z.polygon);
        if (latlngs.length < 3) continue;
        const fill =
          z.kind === "weather"
            ? "rgba(249, 115, 22, 0.22)"
            : z.kind === "nfz"
              ? "rgba(239, 68, 68, 0.18)"
              : "rgba(120, 113, 108, 0.2)";
        const stroke =
          z.kind === "weather"
            ? "rgba(251, 146, 60, 0.85)"
            : z.kind === "nfz"
              ? "rgba(248, 113, 113, 0.9)"
              : "rgba(168, 162, 158, 0.75)";
        L.polygon(latlngs, {
          color: stroke,
          fillColor: fill,
          fillOpacity: 1,
          weight: 1.5,
          dashArray: "6 4",
          interactive: false,
        })
          .bindTooltip(z.name, { permanent: false, direction: "center", className: "text-xs" })
          .addTo(layer);
      }
    }

    if (show.runways) {
      for (const rw of staticLayers?.runways ?? []) {
        const latlngs = toLatLngs(rw.points);
        if (latlngs.length < 2) continue;
        L.polyline(latlngs, {
          color: "#fde68a",
          weight: 6,
          opacity: 0.92,
          lineCap: "round",
          interactive: false,
        }).addTo(layer);
      }
    }

    if (show.taxiways) {
      for (const twy of staticLayers?.taxiways ?? []) {
        const latlngs = toLatLngs(twy.points);
        if (latlngs.length < 2) continue;
        L.polyline(latlngs, {
          color: "#38bdf8",
          weight: 3,
          opacity: 0.82,
          dashArray: "10 6",
          lineCap: "round",
          interactive: false,
        }).addTo(layer);
      }
    }

    if (show.routes) {
      for (const route of staticLayers?.routeLines ?? []) {
        const latlngs = toLatLngs(route.points);
        if (latlngs.length < 2) continue;
        const color =
          route.kind === "detour" ? "#eab308" : route.kind === "missed" ? "#a855f7" : "#22d3ee";
        L.polyline(latlngs, {
          color,
          weight: route.kind === "detour" ? 3 : 2,
          opacity: 0.85,
          dashArray: route.kind === "planned" ? undefined : "8 6",
          interactive: false,
        })
          .bindTooltip(route.name, { permanent: false, direction: "top", className: "text-xs" })
          .addTo(layer);
      }
    }

    if (show.waypoints) {
      for (const wp of staticLayers?.waypoints ?? []) {
        if (!Number.isFinite(wp.lat) || !Number.isFinite(wp.lon)) continue;
        L.circleMarker([wp.lat, wp.lon], {
          radius: 7,
          color: "#22c55e",
          fillColor: "#22c55e",
          fillOpacity: 0.75,
          weight: 2,
          interactive: false,
        })
          .bindTooltip(wp.name, { permanent: true, direction: "right", offset: [8, 0], className: "font-semibold text-xs" })
          .addTo(layer);
      }
    }

    if (show.landmarks) {
      for (const lm of staticLayers?.landmarks ?? []) {
        if (!Number.isFinite(lm.lat) || !Number.isFinite(lm.lon)) continue;
        L.circleMarker([lm.lat, lm.lon], {
          radius: 8,
          color: "#fbbf24",
          fillColor: "#fbbf24",
          fillOpacity: 0.85,
          weight: 2,
          interactive: false,
        })
          .bindTooltip(lm.name, { permanent: true, direction: "right", offset: [8, 0], className: "font-semibold text-xs" })
          .addTo(layer);
      }
    }
  }, [
    mapReady,
    staticLayers,
    show.runways,
    show.taxiways,
    show.waypoints,
    show.landmarks,
    show.routes,
    show.obstacles,
  ]);

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
          <span className="text-muted-foreground">
            {liveAdsb.length > 0
              ? `${new Set(liveAdsb.map((p) => p.icao24)).size} 架在线`
              : liveAdsbStatus?.stale
                ? "数据已冻结"
                : ""}{" "}
            {saneAdsb.length > 0 ? `${saneAdsb.length} 点` : ""}
            {rawPointCount > saneAdsb.length
              ? `（已去重 ${rawPointCount - saneAdsb.length}）`
              : ""}
          </span>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800">
        {(liveAdsbStatus?.stale || (liveAdsb.length === 0 && liveAdsbStatus?.error)) ? (
          <div className="absolute inset-x-4 top-4 z-[1100] rounded-lg border border-amber-500/40 bg-amber-950/80 px-3 py-2 text-xs text-amber-100">
            {liveAdsbStatus?.error ||
              "航迹已冻结：数据库里还是旧飞机位置，因为 OpenSky 暂时不让拉新数据。"}
            <div className="mt-1 text-[10px] opacity-80">
              处理：关掉所有「a1_live_collector」窗口，只留 1 个；等 3–5 分钟；看窗口里是否出现 opensky= 成功行。
            </div>
          </div>
        ) : null}
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
                  <div className="text-cyan-300 font-mono">
                    {formatVerticalRateFpm(hoveredAircraft.verticalRate)} f/m
                  </div>
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
