"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { ADSBData } from "@/types";
import {
  buildAdsbTrackIndex,
  dedupeAdsbPointsByFlight,
  formatVerticalRateFpm,
  interpolateAdsbAtTime,
  queryAdsbTrailPoints,
  queryCurrentAdsbPoints,
  upperBoundByTime,
} from "@/lib/adsb-interpolation";
import {
  filterWallClockPoolForRecordingPlayback,
  matchesFlightKey,
  passesMapDisplayQuality,
} from "@/lib/recording-adsb-alignment";
import {
  buildLiveTrailLatLngs,
  buildRecordingTrailAtAircraft,
  filterAdsbPoolToRecordingPlayback,
  queryLivePlaybackPoints,
  recordingPlaybackTrackBounds,
  resolveRecordingSampleSec,
  sampleAircraftAtWallTime,
  sampleRecordingWallPlayback,
  trimTrailBehindTip,
} from "@/lib/adsb-playback";
import type { VhhhStaticLayers } from "@/mock/vhhh-static";
import type { LayerTogglesState } from "@/components/layer-toggles";
import { cn } from "@/lib/utils";
import { buildDetourLiveAdsb, DETOUR_ICAO24, getDetourSnapshotAt, getDetourTrailLatLngs, shouldInjectDetourAdsb, stripSyntheticDetour } from "@/lib/detour-aircraft";
import { Plane, ZoomIn, ZoomOut, Maximize2, Focus, LocateFixed, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function isWallClockLivePoint(p: ADSBData): boolean {
  return Boolean(p.live) || p.timestamp > 1_000_000_000;
}

type LeafletMapInternal = L.Map & { _mapPane?: HTMLElement; _animatingZoom?: boolean };

function isMapOperational(map: L.Map | null | undefined): map is L.Map {
  if (!map) return false;
  const m = map as LeafletMapInternal;
  const container = map.getContainer?.();
  if (!container?.isConnected || !m._mapPane) return false;
  return true;
}

/** 避免 zoom 动画未结束时 panTo/setView 触发 _leaflet_pos 报错 */
function safeMapOp(map: L.Map | null | undefined, fn: (map: L.Map) => void, allowDuringZoom = false) {
  if (!isMapOperational(map)) return;
  const m = map as LeafletMapInternal;
  if (!allowDuringZoom && m._animatingZoom) return;
  try {
    fn(map);
  } catch {
    // HMR / 卸载竞态
  }
}

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
  /** 切换录音时自动缩放至该录音时段航迹 */
  focusRecordingId?: string;
  /** 录音 UTC 对齐回放：主目标跟播放条，其余机仍实时 */
  timelinePlaybackMode?: boolean;
  /** 当前录音的主目标（呼号 / icao24，小写） */
  primaryRecordingAircraft?: string;
  /** 录音 UTC 起点（Unix 秒），用于无历史航迹时按播放条对齐 OpenSky 墙钟缓存 */
  recordingUtcStartSec?: number;
  /** 录音时长（秒），用于播完后继续沿墙钟航迹前进 */
  audioDurationSec?: number;
  /** 波形是否在播放（含播完后的尾迹延续） */
  mapPlaybackActive?: boolean;
  /** OpenSky 实时全量（与录音对齐数据分离，避免只剩演示机） */
  mapLiveAdsb?: ADSBData[];
  /** 用户切换「实时 OpenSky」时通知父组件，同步目标/仪表面板 */
  onLiveRealtimeModeChange?: (active: boolean) => void;
}

function clampHeading(deg: unknown) {
  const n = typeof deg === "number" ? deg : Number(deg);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

function markerKeyFor(p: ADSBData | { icao24: string }): string {
  return String(p.icao24).toLowerCase();
}

function getTrackForFlightKey(
  index: ReturnType<typeof buildAdsbTrackIndex>,
  key: string
): ADSBData[] | undefined {
  if (!key) return undefined;
  const direct = index.tracks.get(key);
  if (direct?.length) return direct;
  for (const arr of index.tracks.values()) {
    if (arr.some((p) => matchesFlightKey(p, key))) return arr;
  }
  return undefined;
}

/** 回放尾迹优先用密采样索引，不足 2 点则回退 live 全航迹 */
function resolvePlaybackTrailArr(
  fk: string,
  mapKey: string,
  positionArr: ADSBData[],
  indices: {
    trail: ReturnType<typeof buildAdsbTrackIndex>;
    track: ReturnType<typeof buildAdsbTrackIndex>;
    live: ReturnType<typeof buildAdsbTrackIndex>;
  }
): ADSBData[] {
  const pick = (index: ReturnType<typeof buildAdsbTrackIndex>) =>
    getTrackForFlightKey(index, fk) ??
    index.tracks.get(mapKey) ??
    index.tracks.get(fk);
  const playback =
    pick(indices.trail) ?? pick(indices.track);
  if (playback && playback.length >= 2) return playback;
  const live = pick(indices.live);
  if (live && live.length >= 2) return live;
  return positionArr;
}

/** 仅对勾选/主目标键采样，禁止 queryLivePlaybackPoints 扫全库 */
function sampleVisibleFromIndex(
  index: ReturnType<typeof buildAdsbTrackIndex>,
  keys: Iterable<string>,
  wallSec: number,
  options?: Parameters<typeof sampleAircraftAtWallTime>[2]
): ADSBData[] {
  const out: ADSBData[] = [];
  for (const key of keys) {
    if (!key || key === DETOUR_ICAO24) continue;
    const arr = getTrackForFlightKey(index, key);
    if (!arr?.length) continue;
    const p = sampleAircraftAtWallTime(arr, wallSec, options);
    if (p) out.push(p);
  }
  return out;
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
  focusRecordingId,
  timelinePlaybackMode = false,
  primaryRecordingAircraft,
  recordingUtcStartSec,
  audioDurationSec,
  mapPlaybackActive = false,
  mapLiveAdsb = [],
  onLiveRealtimeModeChange,
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
  const playbackTrackIndexRef = useRef<ReturnType<typeof buildAdsbTrackIndex>>({ tracks: new Map() });
  const playbackTrailIndexRef = useRef<ReturnType<typeof buildAdsbTrackIndex>>({ tracks: new Map() });
  const useLiveHistoricalPlaybackRef = useRef(false);
  const trackIndexRef = useRef<ReturnType<typeof buildAdsbTrackIndex>>({ tracks: new Map() });
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime ?? 0;
  const currentPointsRef = useRef<ADSBData[]>([]);
  const lastMarkerStyleRef = useRef<Map<string, string>>(new Map());
  const smoothRafRef = useRef<number>(0);

  const suspendFollowUntilRef = useRef<number>(0);
  const followSelectedRef = useRef(false);
  const mapAliveRef = useRef(false);

  const onAircraftSelectRef = useRef(onAircraftSelect);
  onAircraftSelectRef.current = onAircraftSelect;

  const primaryRecordingAircraftRef = useRef(primaryRecordingAircraft);
  primaryRecordingAircraftRef.current = primaryRecordingAircraft;
  const selectedAircraftRef = useRef(selectedAircraft);
  selectedAircraftRef.current = selectedAircraft;

  const recordingUtcStartSecRef = useRef(recordingUtcStartSec);
  recordingUtcStartSecRef.current = recordingUtcStartSec;

  const audioDurationSecRef = useRef(audioDurationSec ?? 0);
  audioDurationSecRef.current = audioDurationSec ?? 0;

  const mapPlaybackActiveRef = useRef(mapPlaybackActive);
  mapPlaybackActiveRef.current = mapPlaybackActive;

  const postRecordingExtraRef = useRef(0);
  const lastRafMsRef = useRef(0);

  const wallClockSyncRef = useRef(false);
  const useTimelinePlayheadRef = useRef(false);

  const [hoveredAircraft, setHoveredAircraft] = useState<ADSBData | null>(null);
  const [smoothSelectedPoint, setSmoothSelectedPoint] = useState<ADSBData | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(12);
  const [mapReady, setMapReady] = useState(false);
  /** 暂停时切换为 OpenSky 实时层（播放中自动回到录音墙钟回放） */
  const [liveRealtimeMode, setLiveRealtimeMode] = useState(false);
  const liveRealtimeModeRef = useRef(false);
  liveRealtimeModeRef.current = liveRealtimeMode;

  useEffect(() => {
    onLiveRealtimeModeChange?.(liveRealtimeMode);
  }, [liveRealtimeMode, onLiveRealtimeModeChange]);
  /** 录音回放期间累积 OpenSky 点，避免轮询刷新把历史段裁掉导致中途全消失 */
  const [frozenPlaybackPool, setFrozenPlaybackPool] = useState<ADSBData[]>([]);

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

  const dedupeOpts = useMemo(
    () =>
      timelinePlaybackMode
        ? { minMoveMeters: 25, maxPointsPerFlight: 800 }
        : { minMoveMeters: 120, maxPointsPerFlight: 160 },
    [timelinePlaybackMode]
  );

  const primaryKey = primaryRecordingAircraft?.toLowerCase() ?? "";
  const selectedKey = selectedAircraft?.toLowerCase() ?? "";

  const { liveAdsb, timelineAdsb, rawPointCount } = useMemo(() => {
    const sane = [...adsbData, ...mapLiveAdsb].filter(
      (p) =>
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude) &&
        Math.abs(p.latitude) <= 90 &&
        Math.abs(p.longitude) <= 180 &&
        Number.isFinite(p.timestamp)
    );
    const withoutDetour = stripSyntheticDetour(sane);
    const liveFromProp = stripSyntheticDetour(mapLiveAdsb).filter(isWallClockLivePoint);
    const liveRaw =
      liveFromProp.length > 0
        ? liveFromProp
        : withoutDetour.filter(isWallClockLivePoint);
    const timelineRaw = withoutDetour.filter((p) => !isWallClockLivePoint(p));
    const injectDetour = shouldInjectDetourAdsb(sane);
    const detourTrack = injectDetour ? buildDetourLiveAdsb() : [];
    const timelineDedupe = { minMoveMeters: 40, maxPointsPerFlight: 400 };
    return {
      liveAdsb: [...dedupeAdsbPointsByFlight(liveRaw, dedupeOpts), ...detourTrack],
      timelineAdsb: dedupeAdsbPointsByFlight(timelineRaw, timelineDedupe),
      rawPointCount: withoutDetour.length,
    };
  }, [adsbData, dedupeOpts, mapLiveAdsb]);

  const hasRecordingWallClock =
    recordingUtcStartSec != null && recordingUtcStartSec > 1_000_000_000;

  const recordingPlayback =
    timelinePlaybackMode && hasRecordingWallClock;

  useEffect(() => {
    setFrozenPlaybackPool([]);
    postRecordingExtraRef.current = 0;
    lastRafMsRef.current = 0;
    setLiveRealtimeMode(false);
  }, [focusRecordingId, recordingUtcStartSec]);

  useEffect(() => {
    if (!hasRecordingWallClock) return;
    const mapPts = stripSyntheticDetour(mapLiveAdsb).filter(isWallClockLivePoint);
    const fallbackPts = stripSyntheticDetour(adsbData).filter(isWallClockLivePoint);
    const incoming = mapPts.length > 0 ? mapPts : fallbackPts;
    if (incoming.length === 0) return;
    setFrozenPlaybackPool((prev) => {
      const byKey = new Map<string, ADSBData>();
      for (const p of [...prev, ...incoming]) {
        byKey.set(`${p.icao24.toLowerCase()}-${p.timestamp}-${p.id}`, p);
      }
      return [...byKey.values()];
    });
  }, [adsbData, hasRecordingWallClock, mapLiveAdsb, mapRefreshRevision]);

  /** 录音回放专用：OpenSky 墙钟全量（优先 mapLiveAdsb，回放期间只增不减） */
  const playbackLivePool = useMemo(() => {
    if (hasRecordingWallClock && frozenPlaybackPool.length > 0) return frozenPlaybackPool;
    const mapPts = stripSyntheticDetour(mapLiveAdsb).filter(isWallClockLivePoint);
    if (mapPts.length > 0) return mapPts;
    return stripSyntheticDetour(adsbData).filter(isWallClockLivePoint);
  }, [adsbData, frozenPlaybackPool, hasRecordingWallClock, mapLiveAdsb]);

  const effectivePlaybackPool = useMemo(() => {
    if (playbackLivePool.length > 0) return playbackLivePool;
    if (hasRecordingWallClock) {
      return liveAdsb.filter((p) => p.icao24 !== DETOUR_ICAO24);
    }
    return playbackLivePool;
  }, [hasRecordingWallClock, liveAdsb, playbackLivePool]);

  const recordingPlaybackPool = useMemo(() => {
    if (!hasRecordingWallClock || recordingUtcStartSec == null || recordingUtcStartSec < 1_000_000_000) {
      return effectivePlaybackPool;
    }
    const dur = audioDurationSec ?? 62;
    const alwaysKeys = primaryKey ? ([primaryKey] as string[]) : [];
    const inWindow = filterWallClockPoolForRecordingPlayback(
      effectivePlaybackPool,
      recordingUtcStartSec,
      dur,
      { alwaysIncludeKeys: alwaysKeys }
    );
    return filterAdsbPoolToRecordingPlayback(inWindow, recordingUtcStartSec, dur);
  }, [
    audioDurationSec,
    effectivePlaybackPool,
    primaryKey,
    hasRecordingWallClock,
    recordingUtcStartSec,
  ]);

  const useLiveHistoricalPlayback =
    hasRecordingWallClock && (recordingPlaybackPool.length > 0 || liveAdsb.length > 0);
  const hasRelativeTimeline =
    !useLiveHistoricalPlayback &&
    timelineAdsb.length > 0 &&
    timelineAdsb.some((p) => p.timestamp < 1_000_000_000);
  const useTimelinePlayhead = recordingPlayback && hasRelativeTimeline;
  /** 有 UTC 起点即可墙钟对齐（OpenSky 池），不强制依赖稀疏时间轴 ADS-B */
  const useRecordingWallPlayhead = hasRecordingWallClock;
  const useLiveRealtimeNow =
    recordingPlayback && liveRealtimeMode && !mapPlaybackActive && liveAdsb.length > 0;
  const useRecordingPlayheadNow = useRecordingWallPlayhead && !useLiveRealtimeNow;

  const getRecordingRelTime = useCallback(
    (forRaf: boolean) => {
      const ct = forRaf ? currentTimeRef.current : currentTime || 0;
      const dur = audioDurationSecRef.current;
      if (!hasRecordingWallClock || dur <= 0) return ct;
      if (ct < dur - 0.05) {
        if (forRaf) {
          postRecordingExtraRef.current = 0;
          lastRafMsRef.current = 0;
        }
        return ct;
      }
      if (forRaf && mapPlaybackActiveRef.current) {
        const now = performance.now();
        if (lastRafMsRef.current > 0) {
          postRecordingExtraRef.current += (now - lastRafMsRef.current) / 1000;
        }
        lastRafMsRef.current = now;
      }
      return dur + postRecordingExtraRef.current;
    },
    [currentTime, hasRecordingWallClock]
  );

  const playbackWallSec = (recordingUtcStartSec ?? 0) + getRecordingRelTime(false);

  wallClockSyncRef.current = useRecordingPlayheadNow;
  useTimelinePlayheadRef.current = useLiveHistoricalPlayback ? false : useTimelinePlayhead;

  const wallClockQueryOpts = useMemo(
    () => ({ maxExtrapolateSec: 900, historicalPlayback: true as const }),
    []
  );

  const playbackForceKeys = useMemo(
    () => [primaryKey, selectedKey].filter(Boolean) as string[],
    [primaryKey, selectedKey]
  );

  const wallClockQueryWithForce = useMemo(
    () => ({ ...wallClockQueryOpts, forceKeys: playbackForceKeys }),
    [playbackForceKeys, wallClockQueryOpts]
  );

  const playbackQueryOpts = useMemo(
    () => ({ clampBeforeFirst: true as const }),
    []
  );

  const isSelectedFlight = useCallback(
    (icao24: string, callsign?: string) => {
      if (!selectedKey) return false;
      const p = { icao24, callsign } as ADSBData;
      return matchesFlightKey(p, selectedKey);
    },
    [selectedKey]
  );

  const upsertTrailPolyline = useCallback(
    (mapKey: string, latlngs: [number, number][], isSelected: boolean) => {
      if (latlngs.length < 2) return;
      const layer = trailsLayerRef.current;
      if (!layer || !mapAliveRef.current) return;
      const k = mapKey.toLowerCase();
      const style = {
        color: isSelected ? "#ef4444" : "#3b82f6",
        weight: isSelected ? 3 : 2,
        opacity: isSelected ? 0.82 : 0.55,
      };
      let line = trailPolylinesRef.current.get(k);
      if (!line) {
        line = L.polyline([], {
          color: style.color,
          opacity: style.opacity,
          weight: style.weight,
          lineCap: "round",
          lineJoin: "round",
          interactive: false,
          bubblingMouseEvents: false,
        }).addTo(layer);
        trailPolylinesRef.current.set(k, line);
      }
      trailLatLngsRef.current.set(k, latlngs);
      try {
        line.setLatLngs(latlngs);
        line.setStyle(style);
        line.bringToFront?.();
      } catch {
        // ignore
      }
    },
    []
  );
  const upsertTrailPolylineRef = useRef(upsertTrailPolyline);
  upsertTrailPolylineRef.current = upsertTrailPolyline;

  const mapForceKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const k of [primaryKey, selectedKey, ...playbackForceKeys]) {
      if (k) keys.add(k.toLowerCase());
    }
    return keys;
  }, [playbackForceKeys, primaryKey, selectedKey]);

  const resolveTrackForMap = useCallback((icao24: string, callsign?: string) => {
    const keys = [icao24, callsign].filter(Boolean) as string[];
    const indices = [
      liveTrackIndexRef.current,
      playbackTrackIndexRef.current,
      playbackTrailIndexRef.current,
      trackIndexRef.current,
    ];
    for (const k of keys) {
      for (const index of indices) {
        const arr = getTrackForFlightKey(index, k);
        if (arr?.length) return arr;
      }
    }
    return undefined;
  }, []);

  const isAircraftVisible = useCallback(
    (icao24: string, callsign?: string) => {
      const key = String(icao24).toLowerCase();
      if (key === DETOUR_ICAO24) return true;

      const probe = { icao24, callsign } as ADSBData;
      const forced = [...mapForceKeys].some((fk) => matchesFlightKey(probe, fk));

      let inVisibleSet = false;
      if (normalizedVisibleSet && normalizedVisibleSet.size > 0) {
        for (const visKey of normalizedVisibleSet) {
          if (matchesFlightKey(probe, visKey)) {
            inVisibleSet = true;
            break;
          }
        }
        if (!inVisibleSet) inVisibleSet = normalizedVisibleSet.has(key);
      }

      if (!inVisibleSet && !forced) return false;

      const track = resolveTrackForMap(icao24, callsign);
      if (!track?.length) return forced;

      return passesMapDisplayQuality(track, {
        wallSec: Date.now() / 1000,
        forceKeys: mapForceKeys,
      });
    },
    [mapForceKeys, normalizedVisibleSet, resolveTrackForMap]
  );

  const isAircraftVisibleRef = useRef(isAircraftVisible);
  isAircraftVisibleRef.current = isAircraftVisible;

  /** 地图只渲染勾选/主目标/选中键，禁止扫全表 800+ 架 */
  const visibleFlightKeys = useMemo(() => {
    const keys = new Set<string>();
    if (normalizedVisibleSet) {
      for (const k of normalizedVisibleSet) {
        if (k) keys.add(k.toLowerCase());
      }
    }
    for (const k of [primaryKey, selectedKey]) {
      if (k) keys.add(k);
    }
    return keys;
  }, [normalizedVisibleSet, primaryKey, selectedKey]);

  const visibleFlightKeysRef = useRef(visibleFlightKeys);
  visibleFlightKeysRef.current = visibleFlightKeys;

  const purgeNonVisibleMapLayers = useCallback(() => {
    if (!mapAliveRef.current) return;

    for (const [id, marker] of [...markersRef.current.entries()]) {
      if (id === DETOUR_ICAO24) continue;
      const arr =
        liveTrackIndexRef.current.tracks.get(id) ??
        playbackTrailIndexRef.current.tracks.get(id);
      if (isAircraftVisible(id, arr?.[0]?.callsign)) continue;
      try {
        marker.remove();
      } catch {
        // ignore
      }
      markersRef.current.delete(id);
      lastMarkerStyleRef.current.delete(id);
      markerFadeTimeoutsRef.current.delete(id);
    }

    for (const id of [...trailPolylinesRef.current.keys()]) {
      if (id === DETOUR_ICAO24) continue;
      const arr =
        liveTrackIndexRef.current.tracks.get(id) ??
        playbackTrailIndexRef.current.tracks.get(id);
      if (isAircraftVisible(id, arr?.[0]?.callsign)) continue;
      trailPolylinesRef.current.get(id)?.remove();
      trailPolylinesRef.current.delete(id);
      trailLatLngsRef.current.delete(id);
      trailLatLngsRef.current.delete(id.toLowerCase());
      liveTrailIdsRef.current.delete(id);
    }
  }, [isAircraftVisible]);

  useEffect(() => {
    if (!mapAliveRef.current) return;
    for (const m of markersRef.current.values()) {
      try {
        m.remove();
      } catch {
        // ignore
      }
    }
    markersRef.current.clear();
    lastMarkerStyleRef.current.clear();
    markerFadeTimeoutsRef.current.clear();
    for (const pl of trailPolylinesRef.current.values()) {
      try {
        pl.remove();
      } catch {
        // ignore
      }
    }
    trailPolylinesRef.current.clear();
    trailLatLngsRef.current.clear();
    liveTrailIdsRef.current.clear();
  }, [focusRecordingId, recordingUtcStartSec]);

  useEffect(() => {
    if (!mapReady) return;
    purgeNonVisibleMapLayers();
  }, [mapReady, purgeNonVisibleMapLayers, visibleFlightKeys]);

  const saneAdsb = useMemo(() => [...liveAdsb, ...timelineAdsb], [liveAdsb, timelineAdsb]);

  const boundsAll = useMemo(() => {
    const llAll = saneAdsb
      .filter((p) => isAircraftVisible(p.icao24))
      .map((p) => [p.latitude, p.longitude] as [number, number])
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));

    return llAll.length ? L.latLngBounds(llAll.map(([a, b]) => L.latLng(a, b))) : null;
  }, [isAircraftVisible, saneAdsb]);

  const trackIndex = useMemo(
    () => buildAdsbTrackIndex(timelineAdsb, undefined, dedupeOpts),
    [dedupeOpts, timelineAdsb]
  );

  const liveTrackIndex = useMemo(
    () => buildAdsbTrackIndex(liveAdsb, undefined, dedupeOpts),
    [dedupeOpts, liveAdsb]
  );

  const playbackIndexPool = useMemo(() => {
    if (recordingPlaybackPool.length > 0) return recordingPlaybackPool;
    if (hasRecordingWallClock) {
      return liveAdsb.filter((p) => p.icao24 !== DETOUR_ICAO24);
    }
    return recordingPlaybackPool;
  }, [hasRecordingWallClock, liveAdsb, recordingPlaybackPool]);

  /** 墙钟回放：机位与尾迹共用密采样索引，避免 120m 去重后只剩 1 点导致播放时图标钉死 */
  const playbackPositionDedupe = useMemo(
    () =>
      hasRecordingWallClock
        ? { minMoveMeters: 8, maxPointsPerFlight: 1200 }
        : dedupeOpts,
    [dedupeOpts, hasRecordingWallClock]
  );

  const playbackTrackIndex = useMemo(
    () => buildAdsbTrackIndex(playbackIndexPool, undefined, playbackPositionDedupe),
    [playbackIndexPool, playbackPositionDedupe]
  );

  const playbackTrailIndex = useMemo(
    () =>
      hasRecordingWallClock
        ? playbackTrackIndex
        : buildAdsbTrackIndex(playbackIndexPool, undefined, {
            minMoveMeters: 8,
            maxPointsPerFlight: 1200,
          }),
    [hasRecordingWallClock, playbackIndexPool, playbackTrackIndex]
  );

  const recordingDurationForSample = Math.max(1, audioDurationSec ?? 62);

  const trailOptsForRecordingArr = useCallback(
    (
      arr: ADSBData[],
      base: {
        maxExtrapolateSec?: number;
        historicalPlayback?: boolean;
        maxPoints?: number;
      }
    ) => {
      const utc = recordingUtcStartSec ?? 0;
      if (utc < 1_000_000_000 || arr.length === 0) {
        return { ...base, maxPoints: base.maxPoints ?? 250 };
      }
      const bounds = recordingPlaybackTrackBounds(arr, utc, recordingDurationForSample);
      return {
        ...base,
        maxPoints: base.maxPoints ?? 250,
        playbackStartSec: bounds.useWallClock ? utc : bounds.startSec,
        playbackEndSec: bounds.endSec,
      };
    },
    [recordingDurationForSample, recordingUtcStartSec]
  );

  const trailOptsForRecordingArrRef = useRef(trailOptsForRecordingArr);
  trailOptsForRecordingArrRef.current = trailOptsForRecordingArr;

  const samplePrimaryAtWall = useCallback(
    (relTimeSec: number) => {
      const key = selectedKey || primaryKey;
      if (!key || recordingUtcStartSec == null) return undefined;
      const arr = getTrackForFlightKey(playbackTrackIndex, key);
      if (!arr?.length) return undefined;
      return (
        sampleRecordingWallPlayback(
          arr,
          relTimeSec,
          recordingUtcStartSec,
          recordingDurationForSample,
          wallClockQueryOpts
        ) ?? undefined
      );
    },
    [
      playbackTrackIndex,
      primaryKey,
      recordingDurationForSample,
      recordingUtcStartSec,
      selectedKey,
      wallClockQueryOpts,
    ]
  );

  const buildRecordingMapPoints = useCallback(
    (relTimeSec: number) => {
      const byKey = new Map<string, ADSBData>();
      const add = (p: ADSBData | null | undefined) => {
        if (!p || p.icao24 === DETOUR_ICAO24) return;
        if (!isAircraftVisible(p.icao24, p.callsign)) return;
        byKey.set(markerKeyFor(p), p);
      };

      if (recordingUtcStartSec == null) return [];

      const keysToSample = new Set(visibleFlightKeys);
      for (const fk of playbackForceKeys) keysToSample.add(fk.toLowerCase());

      for (const key of keysToSample) {
        if (!key || key === DETOUR_ICAO24) continue;
        const arr =
          getTrackForFlightKey(playbackTrackIndex, key) ??
          getTrackForFlightKey(liveTrackIndex, key);
        if (!arr?.length) continue;
        add(
          sampleRecordingWallPlayback(
            arr,
            relTimeSec,
            recordingUtcStartSec,
            recordingDurationForSample,
            wallClockQueryWithForce
          )
        );
      }

      return [...byKey.values()];
    },
    [
      isAircraftVisible,
      liveTrackIndex,
      playbackForceKeys,
      playbackTrackIndex,
      recordingDurationForSample,
      recordingUtcStartSec,
      visibleFlightKeys,
      wallClockQueryWithForce,
    ]
  );

  const sampleRecordingPlayback = useCallback(
    (relTimeSec: number) => {
      if (recordingPlayback) {
        const wallPoints = buildRecordingMapPoints(relTimeSec);
        if (useTimelinePlayhead) {
          const byIcao = new Map<string, ADSBData>();
          for (const p of wallPoints) byIcao.set(p.icao24.toLowerCase(), p);
          for (const p of queryCurrentAdsbPoints(trackIndex, currentTime, playbackQueryOpts)) {
            if (!isAircraftVisible(p.icao24, p.callsign)) continue;
            const k = p.icao24.toLowerCase();
            if (byIcao.has(k)) continue;
            byIcao.set(k, p);
          }
          return [...byIcao.values()];
        }
        return wallPoints;
      }
      return [];
    },
    [
      buildRecordingMapPoints,
      currentTime,
      isAircraftVisible,
      playbackQueryOpts,
      recordingPlayback,
      trackIndex,
      useTimelinePlayhead,
    ]
  );

  const trailPointsForRecording = useCallback(
    (relTimeSec: number, trailRelTime: number) => {
      if (useLiveHistoricalPlayback && recordingUtcStartSec != null) {
        const out: ADSBData[] = [];
        const startSec = recordingUtcStartSec;
        for (const key of visibleFlightKeys) {
          const arr = getTrackForFlightKey(playbackTrackIndex, key);
          if (!arr?.length) continue;
          const sampleSec = resolveRecordingSampleSec(
            arr,
            relTimeSec,
            startSec,
            recordingDurationForSample
          );
          const histEnd = upperBoundByTime(arr, sampleSec);
          for (let i = 0; i < histEnd; i++) {
            const p = arr[i];
            if (isAircraftVisible(p.icao24, p.callsign)) out.push(p);
          }
          const tip = sampleRecordingWallPlayback(
            arr,
            relTimeSec,
            startSec,
            recordingDurationForSample,
            wallClockQueryOpts
          );
          if (tip && isAircraftVisible(tip.icao24, tip.callsign)) out.push(tip);
        }
        return out;
      }
      const byKey = new Map<string, ADSBData>();
      const add = (p: ADSBData) => byKey.set(`${p.icao24}-${p.timestamp}`, p);
      if (useTimelinePlayhead) {
        for (const p of queryAdsbTrailPoints(trackIndex, trailRelTime, playbackQueryOpts)) add(p);
      }
      for (const p of queryAdsbTrailPoints(liveTrackIndex, relTimeSec, playbackQueryOpts)) {
        if (p.icao24 === DETOUR_ICAO24) continue;
        add(p);
      }
      return [...byKey.values()]
        .filter((p) => isAircraftVisible(p.icao24, p.callsign))
        .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    },
    [
      isAircraftVisible,
      liveTrackIndex,
      playbackQueryOpts,
      playbackTrackIndex,
      recordingDurationForSample,
      recordingUtcStartSec,
      trackIndex,
      useLiveHistoricalPlayback,
      useTimelinePlayhead,
      visibleFlightKeys,
      wallClockQueryOpts,
    ]
  );

  const currentPoints = useMemo(() => {
    const vis = (p: ADSBData) => isAircraftVisible(p.icao24, p.callsign);
    const keys = visibleFlightKeys;

    if (useLiveRealtimeNow) {
      const wallSec = Date.now() / 1000;
      return sampleVisibleFromIndex(liveTrackIndex, keys, wallSec, {
        maxExtrapolateSec: 120,
      }).filter((p) => p.icao24 !== DETOUR_ICAO24 && vis(p));
    }
    if (useRecordingPlayheadNow) {
      return sampleRecordingPlayback(getRecordingRelTime(false));
    }

    const byIcao = new Map<string, ADSBData>();
    const add = (p: ADSBData) => {
      if (!vis(p) || p.icao24 === DETOUR_ICAO24) return;
      byIcao.set(markerKeyFor(p), p);
    };

    for (const key of keys) {
      const tArr = getTrackForFlightKey(trackIndex, key);
      if (tArr?.length) {
        const tp = sampleAircraftAtWallTime(tArr, currentTime, { maxExtrapolateSec: 120 });
        if (tp) add(tp);
      }
      const wallSec = Date.now() / 1000;
      const lArr = getTrackForFlightKey(liveTrackIndex, key);
      if (lArr?.length) {
        const p = sampleAircraftAtWallTime(lArr, wallSec, { maxExtrapolateSec: 120 });
        if (p) add(p);
      }
    }
    if (
      isAircraftVisible(DETOUR_ICAO24) &&
      liveAdsb.some((p) => p.icao24 === DETOUR_ICAO24)
    ) {
      byIcao.set(DETOUR_ICAO24, getDetourSnapshotAt(Date.now() / 1000));
    }
    return [...byIcao.values()];
  }, [
    currentTime,
    isAircraftVisible,
    liveAdsb,
    liveTrackIndex,
    mapRefreshRevision,
    playbackQueryOpts,
    currentTime,
    getRecordingRelTime,
    sampleRecordingPlayback,
    useLiveRealtimeNow,
    useRecordingPlayheadNow,
    useRecordingWallPlayhead,
    visibleFlightKeys,
    wallClockQueryOpts,
  ]);

  const trailRenderTime = Math.floor((currentTime || 0) * 2) / 2;
  const filteredPoints = useMemo(() => {
    const visTrail = (p: ADSBData) => isAircraftVisible(p.icao24, p.callsign);
    if (useLiveRealtimeNow) {
      const wallSec = Date.now() / 1000;
      const out: ADSBData[] = [];
      for (const key of visibleFlightKeys) {
        if (!key || key === DETOUR_ICAO24) continue;
        const arr = getTrackForFlightKey(liveTrackIndex, key);
        if (!arr?.length || !visTrail(arr[0])) continue;
        const end = upperBoundByTime(arr, wallSec);
        const start = Math.max(0, end - 400);
        for (let i = start; i < end; i++) out.push(arr[i]);
        const tip = sampleAircraftAtWallTime(arr, wallSec, { maxExtrapolateSec: 120 });
        if (tip) out.push(tip);
      }
      return out;
    }
    if (useRecordingPlayheadNow) {
      return trailPointsForRecording(getRecordingRelTime(false), trailRenderTime);
    }
    return queryAdsbTrailPoints(trackIndex, trailRenderTime, playbackQueryOpts).filter(visTrail);
  }, [
    mapRefreshRevision,
    getRecordingRelTime,
    trailPointsForRecording,
    trailRenderTime,
    trackIndex,
    playbackQueryOpts,
    useLiveRealtimeNow,
    isAircraftVisible,
    useRecordingPlayheadNow,
    useRecordingWallPlayhead,
    visibleFlightKeys,
  ]);

  const lastAutoFitRecordingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusRecordingId) return;
    followSelectedRef.current = false;
    lastAutoFitRecordingRef.current = null;
  }, [focusRecordingId, primaryKey]);

  /** 选中录音 / 航迹入库后：仅一次缩放到主目标或可见机群（不跟播、不抢用户总览） */
  useEffect(() => {
    if (!mapReady || !mapRef.current || !focusRecordingId) return;
    if (liveRealtimeMode) return;
    if (mapPlaybackActive) return;

    const focusKey = selectedKey || primaryKey;
    const wallSec = (recordingUtcStartSec ?? 0);
    const fitToken = `${focusRecordingId}:${focusKey}:${mapRefreshRevision}`;
    if (lastAutoFitRecordingRef.current === fitToken) return;

    const focusPt = samplePrimaryAtWall(0);
    const primaryArr = focusKey ? getTrackForFlightKey(playbackTrackIndex, focusKey) : undefined;
    const trailLl =
      primaryArr
        ?.filter(
          (p) =>
            Number.isFinite(p.latitude) &&
            Number.isFinite(p.longitude) &&
            p.timestamp <= wallSec + 120
        )
        .map((p) => [p.latitude, p.longitude] as [number, number]) ?? [];

    try {
      if (focusPt && focusKey) {
        lastAutoFitRecordingRef.current = fitToken;
        if (trailLl.length >= 2) {
          const bounds = L.latLngBounds([
            ...trailLl.map(([a, b]) => L.latLng(a, b)),
            L.latLng(focusPt.latitude, focusPt.longitude),
          ]);
          safeMapOp(mapRef.current, (map) => {
            map.fitBounds(bounds, { padding: [72, 72], maxZoom: 14, animate: false });
          });
        } else {
          safeMapOp(mapRef.current, (map) => {
            map.setView(
              [focusPt.latitude, focusPt.longitude],
              Math.max(map.getZoom(), 13),
              { animate: false }
            );
          });
        }
        return;
      }

      const fitPts = useLiveHistoricalPlayback
        ? sampleRecordingPlayback(0)
        : timelineAdsb;
      const ll = fitPts
        .filter(
          (p) =>
            Number.isFinite(p.latitude) &&
            Number.isFinite(p.longitude) &&
            isAircraftVisible(p.icao24, p.callsign)
        )
        .map((p) => [p.latitude, p.longitude] as [number, number]);
      if (ll.length < 1) return;
      lastAutoFitRecordingRef.current = fitToken;
      if (ll.length === 1) {
        safeMapOp(mapRef.current, (map) => {
          map.setView(ll[0], Math.max(map.getZoom(), 11), { animate: false });
        });
      } else {
        safeMapOp(mapRef.current, (map) => {
          map.fitBounds(L.latLngBounds(ll.map((x) => L.latLng(x[0], x[1]))), {
            padding: [36, 36],
            maxZoom: 13,
            animate: false,
          });
        });
      }
    } catch {
      // ignore map teardown races
    }
  }, [
    focusRecordingId,
    isAircraftVisible,
    liveRealtimeMode,
    mapPlaybackActive,
    mapReady,
    mapRefreshRevision,
    playbackTrackIndex,
    primaryKey,
    recordingUtcStartSec,
    samplePrimaryAtWall,
    sampleRecordingPlayback,
    selectedKey,
    timelineAdsb,
    useLiveHistoricalPlayback,
  ]);

  useEffect(() => {
    liveTrackIndexRef.current = liveTrackIndex;
    playbackTrackIndexRef.current = playbackTrackIndex;
    playbackTrailIndexRef.current = playbackTrailIndex;
    useLiveHistoricalPlaybackRef.current =
      useLiveHistoricalPlayback || playbackTrackIndex.tracks.size > 0;
    trackIndexRef.current = trackIndex;
  }, [liveTrackIndex, playbackTrackIndex, playbackTrailIndex, trackIndex, useLiveHistoricalPlayback]);

  useEffect(() => {
    currentPointsRef.current = currentPoints;
  }, [currentPoints]);

  const selectedCurrentPoint = useMemo(() => {
    if (smoothSelectedPoint && isSelectedFlight(smoothSelectedPoint.icao24, smoothSelectedPoint.callsign)) {
      return smoothSelectedPoint;
    }
    return currentPoints.find((p) => isSelectedFlight(p.icao24, p.callsign)) ?? null;
  }, [currentPoints, isSelectedFlight, smoothSelectedPoint]);

  useEffect(() => {
    if (!mapReady || !mapAliveRef.current) return;

    let frame = 0;
    const loop = () => {
      if (!mapAliveRef.current) return;

      const relTime = getRecordingRelTime(true);
      const recordingWall =
        recordingUtcStartSecRef.current != null &&
        wallClockSyncRef.current &&
        !liveRealtimeModeRef.current;
      const wallSec = recordingWall
        ? recordingUtcStartSecRef.current! + relTime
        : Date.now() / 1000;
      const dur = audioDurationSecRef.current;
      const pastRecording = dur > 0 && relTime > dur + 0.05;
      const histOpts = {
        maxExtrapolateSec: pastRecording ? 3600 : 900,
        historicalPlayback: true as const,
      };
      const trailHistBase = { ...histOpts, maxPoints: 250 };
      const selKeyRaf = selectedAircraftRef.current?.toLowerCase() ?? "";
      const animated = new Map<string, ADSBData>();

      if (useTimelinePlayheadRef.current) {
        for (const p of queryCurrentAdsbPoints(trackIndexRef.current, currentTimeRef.current, {
          clampBeforeFirst: true,
        })) {
          if (!isAircraftVisibleRef.current(p.icao24, p.callsign)) continue;
          animated.set(p.icao24.toLowerCase(), p);
        }
      }
      if (wallClockSyncRef.current) {
        const forceKeys = new Set(
          [primaryRecordingAircraftRef.current?.toLowerCase() ?? "", selKeyRaf].filter(Boolean)
        );
        const keysToAnimate = new Set(visibleFlightKeysRef.current);
        for (const fk of forceKeys) keysToAnimate.add(fk);

        for (const fk of keysToAnimate) {
          if (!fk || fk === DETOUR_ICAO24) continue;
          const arr =
            getTrackForFlightKey(playbackTrackIndexRef.current, fk) ??
            getTrackForFlightKey(liveTrackIndexRef.current, fk);
          if (!arr?.length) continue;
          const first = arr[0];
          if (!isAircraftVisibleRef.current(first.icao24, first.callsign)) continue;
          const startSec = recordingUtcStartSecRef.current ?? 0;
          const p = sampleRecordingWallPlayback(
            arr,
            relTime,
            startSec,
            Math.max(1, dur || audioDurationSecRef.current || 62),
            histOpts
          );
          if (!p) continue;
          const mapKey = markerKeyFor(p);
          animated.set(mapKey, p);
          const force =
            forceKeys.has(fk) || [...forceKeys].some((k) => matchesFlightKey(first, k));
          if (show.trails) {
            const trailArr = resolvePlaybackTrailArr(fk, mapKey, arr, {
              trail: playbackTrailIndexRef.current,
              track: playbackTrackIndexRef.current,
              live: liveTrackIndexRef.current,
            });
            const latlngs = buildRecordingTrailAtAircraft(
              trailArr,
              p,
              trailOptsForRecordingArrRef.current(arr, trailHistBase)
            );
            const isSel =
              force ||
              matchesFlightKey(p, selKeyRaf) ||
              (primaryRecordingAircraftRef.current
                ? matchesFlightKey(p, primaryRecordingAircraftRef.current)
                : false);
            upsertTrailPolylineRef.current(mapKey, latlngs, isSel);
          }
        }

        if (show.trails) {
          for (const id of [...trailPolylinesRef.current.keys()]) {
            const k = id.toLowerCase();
            const arr =
              playbackTrailIndexRef.current.tracks.get(id) ??
              playbackTrailIndexRef.current.tracks.get(k) ??
              liveTrackIndexRef.current.tracks.get(id) ??
              liveTrackIndexRef.current.tracks.get(k);
            const probe = arr?.[0];
            if (!probe) continue;
            const keep =
              isAircraftVisibleRef.current(probe.icao24, probe.callsign) &&
              ([...keysToAnimate].some((key) => matchesFlightKey(probe, key)) ||
                keysToAnimate.has(k));
            if (keep) continue;
            trailPolylinesRef.current.get(id)?.remove();
            trailPolylinesRef.current.delete(id);
            trailLatLngsRef.current.delete(id);
            trailLatLngsRef.current.delete(k);
          }
        }
      } else if (liveRealtimeModeRef.current) {
        for (const key of visibleFlightKeysRef.current) {
          if (!key || key === DETOUR_ICAO24) continue;
          const arr = getTrackForFlightKey(liveTrackIndexRef.current, key);
          if (!arr?.length) continue;
          if (!isAircraftVisibleRef.current(arr[0].icao24, arr[0].callsign)) continue;
          const p = sampleAircraftAtWallTime(arr, wallSec, { maxExtrapolateSec: 120 });
          if (!p) continue;
          const mapKey = markerKeyFor(p);
          animated.set(mapKey, p);
          if (show.trails) {
            const latlngs = buildRecordingTrailAtAircraft(
              arr,
              p,
              { maxExtrapolateSec: 120, maxPoints: 200 }
            );
            upsertTrailPolylineRef.current(
              mapKey,
              latlngs,
              matchesFlightKey(p, selKeyRaf)
            );
          }
        }
        if (isAircraftVisibleRef.current(DETOUR_ICAO24)) {
          animated.set(DETOUR_ICAO24, getDetourSnapshotAt(wallSec));
        }
      } else if (!useTimelinePlayheadRef.current) {
        for (const key of visibleFlightKeysRef.current) {
          if (!key || key === DETOUR_ICAO24) continue;
          const arr = getTrackForFlightKey(liveTrackIndexRef.current, key);
          if (!arr?.length) continue;
          if (!isAircraftVisibleRef.current(arr[0].icao24, arr[0].callsign)) continue;
          const p = sampleAircraftAtWallTime(arr, wallSec, { maxExtrapolateSec: 120 });
          if (!p) continue;
          const mapKey = markerKeyFor(p);
          animated.set(mapKey, p);
          if (show.trails) {
            const latlngs = buildRecordingTrailAtAircraft(
              arr,
              p,
              { maxExtrapolateSec: 120, maxPoints: 200 }
            );
            upsertTrailPolylineRef.current(
              mapKey,
              latlngs,
              matchesFlightKey(p, selKeyRaf)
            );
          }
        }
        if (isAircraftVisibleRef.current(DETOUR_ICAO24)) {
          animated.set(DETOUR_ICAO24, getDetourSnapshotAt(wallSec));
        }
      }

      const selKey = selectedAircraftRef.current?.toLowerCase() ?? "";
      if (selKey) {
        let sel: ADSBData | undefined;
        for (const p of animated.values()) {
          if (matchesFlightKey(p, selKey)) {
            sel = p;
            break;
          }
        }
        if (!sel) {
          sel = currentPointsRef.current.find((p) => matchesFlightKey(p, selKey));
        }
        if (sel && frame % 2 === 0) setSmoothSelectedPoint(sel);
      } else if (frame % 15 === 0) {
        setSmoothSelectedPoint((prev) => (prev ? null : prev));
      }

      const animatedKeys = new Set<string>();
      for (const [, p] of animated) {
        if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
        const mk = markerKeyFor(p);
        animatedKeys.add(mk);
        const isSelected = matchesFlightKey(p, selKey);
        const marker =
          markersRef.current.get(mk) ??
          markersRef.current.get(p.icao24) ??
          [...markersRef.current.entries()].find(([k]) => k.toLowerCase() === mk)?.[1];
        if (!marker) continue;
        try {
          marker.setLatLng([p.latitude, p.longitude]);
        } catch {
          continue;
        }
        const styleKey = `${Math.round(p.heading)}-${isSelected}`;
        if (lastMarkerStyleRef.current.get(mk) !== styleKey) {
          marker.setIcon(buildAircraftDivIcon(p, isSelected));
          marker.setZIndexOffset(isSelected ? 1000 : 0);
          lastMarkerStyleRef.current.set(mk, styleKey);
        }
      }

      for (const [mk, marker] of [...markersRef.current.entries()]) {
        if (animatedKeys.has(mk.toLowerCase())) continue;
        try {
          marker.remove();
        } catch {
          // ignore
        }
        markersRef.current.delete(mk);
        lastMarkerStyleRef.current.delete(mk);
        markerFadeTimeoutsRef.current.delete(mk);
      }

      if (show.trails && (liveRealtimeModeRef.current || (!useTimelinePlayheadRef.current && !wallClockSyncRef.current))) {
        for (const id of liveTrailIdsRef.current) {
          const arr0 = liveTrackIndexRef.current.tracks.get(id)?.[0];
          if (
            id !== DETOUR_ICAO24 &&
            !isAircraftVisibleRef.current(id, arr0?.callsign)
          ) {
            continue;
          }
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
          if (!tip || !line) continue;

          if (useTimelinePlayheadRef.current || wallClockSyncRef.current) {
            const arr = wallClockSyncRef.current
              ? playbackTrailIndexRef.current.tracks.get(id) ??
                playbackTrackIndexRef.current.tracks.get(id) ??
                liveTrackIndexRef.current.tracks.get(id)
              : trackIndexRef.current.tracks.get(id);
            if (!arr || arr.length < 1) continue;
            const ct = wallClockSyncRef.current ? wallSec : currentTimeRef.current;
            const latlngs = buildLiveTrailLatLngs(arr, ct, {
              maxExtrapolateSec: wallClockSyncRef.current ? 900 : 120,
              historicalPlayback: wallClockSyncRef.current,
              maxPoints: 250,
            });
            if (latlngs.length >= 2) {
              try {
                line.setLatLngs(latlngs);
                trailLatLngsRef.current.set(id, latlngs);
              } catch {
                // ignore
              }
            }
            continue;
          }

          if (base.length < 2) continue;
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

      frame++;
      smoothRafRef.current = requestAnimationFrame(loop);
    };

    smoothRafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(smoothRafRef.current);
      smoothRafRef.current = 0;
    };
  }, [mapReady, primaryRecordingAircraft, show.trails, timelinePlaybackMode, getRecordingRelTime]);

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

    const onDragStart = () => {
      followSelectedRef.current = false;
      suspendFollowFor(1200);
    };
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
    safeMapOp(map, (m) => {
      m.setView([22.308, 113.918], 12, { animate: false });
    });
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

    safeMapOp(map, (m) => {
      m.fitBounds(boundsAll, { padding: [24, 24], animate: false });
    });
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

    const nextIds = new Set(currentPoints.map((p) => markerKeyFor(p)));
    for (const [icao24, marker] of markersRef.current) {
      if (nextIds.has(icao24.toLowerCase())) continue;
      try {
        marker.remove();
      } catch {
        // ignore
      }
      markersRef.current.delete(icao24);
      markerFadeTimeoutsRef.current.delete(icao24);
      lastMarkerStyleRef.current.delete(icao24);
    }

    const rafOwnsMarkers =
      useRecordingPlayheadNow && useLiveHistoricalPlayback && mapPlaybackActive;

    for (const p of currentPoints) {
      const lat = p.latitude;
      const lon = p.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const icaoKey = p.icao24.toLowerCase();
      const isSelected = isSelectedFlight(p.icao24, p.callsign);
      const icon = buildAircraftDivIcon(p, isSelected);

      const existing = markersRef.current.get(icaoKey) ?? markersRef.current.get(p.icao24);
      if (existing) {
        cancelFadeOutIfAny(icaoKey, existing);
        if (!rafOwnsMarkers) {
          try {
            existing.setLatLng([lat, lon]);
          } catch {
            // ignore
          }
          existing.setZIndexOffset(isSelected ? 1000 : 0);
          const styleKey = `${Math.round(p.heading)}-${isSelected}`;
          if (lastMarkerStyleRef.current.get(icaoKey) !== styleKey) {
            existing.setIcon(icon);
            lastMarkerStyleRef.current.set(icaoKey, styleKey);
          }
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
      cancelFadeOutIfAny(icaoKey, marker);
      marker.setZIndexOffset(isSelected ? 1000 : 0);
      markersRef.current.set(icaoKey, marker);
      lastMarkerStyleRef.current.set(
        icaoKey,
        `${Math.round(p.heading)}-${isSelectedFlight(p.icao24, p.callsign)}`
      );
    }

    setHoveredAircraft((prev) => (prev ? currentPoints.find((x) => x.icao24 === prev.icao24) ?? prev : prev));
  }, [
    currentPoints,
    isAircraftVisible,
    isSelectedFlight,
    mapPlaybackActive,
    mapRefreshRevision,
    useLiveHistoricalPlayback,
    useRecordingPlayheadNow,
  ]);

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

    // 墙钟回放尾迹由 RAF 每帧更新；此处只做可见性变更后的清理，避免与 RAF 抢绘导致脱节/消失
    if (useRecordingPlayheadNow && useLiveHistoricalPlayback) {
      const nextIds = new Set<string>();
      const forcedTrailKeys = [primaryKey, selectedKey].filter(Boolean);
      const trailKeys = new Set(visibleFlightKeys);
      for (const fk of forcedTrailKeys) trailKeys.add(fk.toLowerCase());

      for (const key of trailKeys) {
        if (!key || key === DETOUR_ICAO24) continue;
        const arr =
          getTrackForFlightKey(playbackTrailIndex, key) ??
          getTrackForFlightKey(playbackTrackIndex, key) ??
          getTrackForFlightKey(liveTrackIndex, key);
        if (!arr?.length) continue;
        if (!isAircraftVisible(arr[0].icao24, arr[0].callsign)) continue;
        nextIds.add(arr[0].icao24.toLowerCase());
      }
      for (const id of [...trailPolylinesRef.current.keys()]) {
        if (nextIds.has(id.toLowerCase())) continue;
        trailPolylinesRef.current.get(id)?.remove();
        trailPolylinesRef.current.delete(id);
        trailLatLngsRef.current.delete(id);
        trailLatLngsRef.current.delete(id.toLowerCase());
      }
      return;
    }

    // Build per-aircraft track points (sorted)
    const byAircraft = new Map<string, ADSBData[]>();
    for (const p of filteredPoints) {
      if (!isAircraftVisible(p.icao24, p.callsign)) continue;
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

      const isSelected = isSelectedFlight(icao24, pts[0]?.callsign);
      const isLiveTrail = pts.some((p) => p.live);
      const color = isSelected ? "#ef4444" : "#3b82f6";
      const weight = isSelected ? 3 : 2;
      const opacity = isSelected ? 0.82 : 0.55;

      const cap = isLiveTrail ? 200 : MAX_POINTS_PER_TRAIL;
      const step = Math.max(1, Math.ceil(pts.length / cap));
      const sampled: [number, number][] = [];
      for (let i = 0; i < pts.length; i += step) {
        sampled.push([pts[i].latitude, pts[i].longitude]);
      }
      const last = pts[pts.length - 1];
      let tuples: [number, number][];
      if (useTimelinePlayhead || useRecordingPlayheadNow) {
        tuples = sampled;
      } else {
        const tipLl: [number, number] = [last.latitude, last.longitude];
        tuples = trimTrailBehindTip(sampled, tipLl);
      }
      if (tuples.length < 2) continue;

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

      const tuplesFinal = tuples;
      trailLatLngsRef.current.set(icao24, tuplesFinal);

      try {
        line.setLatLngs(tuplesFinal);
        line.setStyle({ color, opacity, weight });
      } catch {
        // 地图卸载/HMR 竞态时忽略
      }
    }
  }, [
    filteredPoints,
    isAircraftVisible,
    isSelectedFlight,
    playbackTrailIndex,
    getRecordingRelTime,
    primaryKey,
    recordingDurationForSample,
    recordingUtcStartSec,
    selectedAircraft,
    selectedKey,
    show.trails,
    upsertTrailPolyline,
    useLiveHistoricalPlayback,
    useLiveRealtimeNow,
    useRecordingPlayheadNow,
    useRecordingWallPlayhead,
    useTimelinePlayhead,
    visibleFlightKeys,
    mapRefreshRevision,
  ]);

  useEffect(() => {
    if (!mapAliveRef.current || !mapRef.current) return;
    const layer = trailsLayerRef.current;
    if (!layer) return;

    const nextLiveIds = new Set<string>();
    if (show.trails && liveAdsb.length > 0 && !useRecordingPlayheadNow && !useTimelinePlayhead) {
      for (const [icao24, arr] of liveTrackIndex.tracks) {
        if (arr.length < 2) continue;
        if (!isAircraftVisible(icao24, arr[0]?.callsign)) continue;
        nextLiveIds.add(icao24);
      }
    }

    for (const id of [...trailPolylinesRef.current.keys()]) {
      if (liveTrailIdsRef.current.has(id)) continue;
      const arr = liveTrackIndex.tracks.get(id);
      if (arr && isAircraftVisible(id, arr[0]?.callsign)) continue;
      trailPolylinesRef.current.get(id)?.remove();
      trailPolylinesRef.current.delete(id);
      trailLatLngsRef.current.delete(id);
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

    if (!show.trails || liveAdsb.length === 0 || useRecordingPlayheadNow || useTimelinePlayhead) {
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
      if (!isAircraftVisible(icao24, liveTrackIndex.tracks.get(icao24)?.[0]?.callsign)) {
        liveTrailIdsRef.current.delete(icao24);
        const line = trailPolylinesRef.current.get(icao24);
        if (line) {
          line.remove();
          trailPolylinesRef.current.delete(icao24);
          trailLatLngsRef.current.delete(icao24);
        }
        continue;
      }
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
  }, [
    filteredPoints,
    isAircraftVisible,
    liveAdsb.length,
    liveTrackIndex,
    selectedAircraft,
    show.trails,
    useTimelinePlayhead,
    useLiveRealtimeNow,
    useRecordingPlayheadNow,
    visibleFlightKeys,
    mapRefreshRevision,
  ]);

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
    safeMapOp(map, (m) => {
      m.fitBounds(L.latLngBounds(ll.map(([a, b]) => L.latLng(a, b))), { padding: [24, 24], animate: false });
    });
  };

  const handleFocusSelected = () => {
    const map = mapRef.current;
    if (!map || !selectedCurrentPoint) return;
    followSelectedRef.current = false;
    const key = selectedCurrentPoint.icao24;
    const keyLower = key.toLowerCase();
    let trail =
      trailLatLngsRef.current.get(key) ?? trailLatLngsRef.current.get(keyLower);
    if (!trail || trail.length < 2) {
      const line =
        trailPolylinesRef.current.get(key) ?? trailPolylinesRef.current.get(keyLower);
      const fromLine = line?.getLatLngs?.() as L.LatLng[] | undefined;
      if (fromLine && fromLine.length >= 2) {
        trail = fromLine.map((ll) => [ll.lat, ll.lng] as [number, number]);
      }
    }
    const tipLl = L.latLng(selectedCurrentPoint.latitude, selectedCurrentPoint.longitude);
    if (trail && trail.length >= 2) {
      const bounds = L.latLngBounds([...trail.map(([a, b]) => L.latLng(a, b)), tipLl]);
      safeMapOp(map, (m) => {
        m.fitBounds(bounds, { padding: [72, 72], maxZoom: 15, animate: false });
      });
      return;
    }
    safeMapOp(map, (m) => {
      m.setView(tipLl, Math.max(m.getZoom(), 14), { animate: false });
    });
  };

  const handleResetView = () => {
    const map = mapRef.current;
    if (!map || !boundsAll) return;
    safeMapOp(map, (m) => {
      m.fitBounds(boundsAll, { padding: [24, 24], animate: false });
    });
  };

  return (
    <div className="w-full h-full rounded-lg border bg-muted/20 flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-foreground">🗺️ ADSB Leaflet 地图</span>
          <span className="text-muted-foreground">
            {useLiveRealtimeNow
              ? `${currentPoints.length} 架 · 实时 OpenSky`
              : useRecordingPlayheadNow
              ? useLiveHistoricalPlayback
                ? (audioDurationSec && getRecordingRelTime(false) > audioDurationSec + 0.5
                    ? `实时延续 · ${Math.round(getRecordingRelTime(false))}s · ${currentPoints.length} 架`
                    : `${Math.round(currentTime || 0)}s · ${currentPoints.length} 架`)
                : useTimelinePlayhead
                  ? `录音回放 · ${Math.round(currentTime || 0)}s · ${currentPoints.length} 架`
                  : `对齐回放 · ${Math.round(currentTime || 0)}s · ${currentPoints.length} 架`
              : timelinePlaybackMode
                  ? "等待航迹对齐 · 请确认采集器已运行"
                  : liveAdsb.length > 0
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
        <div className="absolute top-4 right-4 flex flex-col gap-1 z-[1200] pointer-events-auto bg-black/40 backdrop-blur-sm rounded-lg p-1">
          {recordingPlayback && liveAdsb.length > 0 ? (
            <>
              <Button
                variant={liveRealtimeMode ? "secondary" : "ghost"}
                size="icon"
                onClick={() => {
                  if (mapPlaybackActive) return;
                  setLiveRealtimeMode((v) => !v);
                  followSelectedRef.current = false;
                }}
                className={cn(
                  "h-8 w-8",
                  liveRealtimeMode
                    ? "bg-emerald-600/80 text-white hover:bg-emerald-600"
                    : "hover:bg-primary/30"
                )}
                title={
                  mapPlaybackActive
                    ? "播放中自动使用录音墙钟回放"
                    : liveRealtimeMode
                      ? "当前：实时 OpenSky（点击切回录音对齐）"
                      : "切换为实时 OpenSky 航迹"
                }
                disabled={mapPlaybackActive}
              >
                <Radio className="h-4 w-4" />
              </Button>
              <div className="h-0.5 bg-border/30 mx-2" />
            </>
          ) : null}
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
            title="聚焦并跟踪选中目标"
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

      </div>
    </div>
  );
}
