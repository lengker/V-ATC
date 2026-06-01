import type { ADSBData } from "@/types";
import { enrichVerticalRates } from "@/lib/adsb-interpolation";
import { trimTrailBehindTip } from "@/lib/adsb-playback";

/** 与真实 ADS-B 一致的 hex 地址，无演示标记 */
export const DETOUR_ICAO24 = "780c4e";
const DETOUR_CALLSIGN = "CPA875";
const SESSION_STORAGE_KEY = "alpha.detour.sessionStart.v1";

/** 沿 vhhhStatic 绕飞航路（经对流区东侧改航） */
const DETOUR_PATH: Array<{ lat: number; lon: number }> = [
  { lat: 22.322, lon: 113.938 },
  { lat: 22.352, lon: 113.965 },
  { lat: 22.372, lon: 114.02 },
  { lat: 22.395, lon: 114.048 },
  { lat: 22.418, lon: 114.045 },
  { lat: 22.448, lon: 114.085 },
];

const FLIGHT_DURATION_SEC = 42 * 60;
const TRAIL_INTERVAL_SEC = 15;
const MAX_TRAIL_SEC = 45 * 60;
const CRUISE_SPEED_KTS = 232;

/** 增量航迹缓冲：只追加、不整段重建，避免轮询时位置回跳 */
let trackBuffer: ADSBData[] = [];
let bufferSessionStart: number | null = null;
let lastAppendedT = 0;

function readSessionStart(now: number): number {
  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 1_000_000_000) return parsed;
      }
      sessionStorage.setItem(SESSION_STORAGE_KEY, String(now));
      return now;
    } catch {
      // private mode / quota
    }
  }
  if (bufferSessionStart == null) bufferSessionStart = now;
  return bufferSessionStart;
}

function resetBufferIfNeeded(sessionStart: number) {
  if (bufferSessionStart === sessionStart && trackBuffer.length > 0) return;
  bufferSessionStart = sessionStart;
  trackBuffer = [];
  lastAppendedT = sessionStart - TRAIL_INTERVAL_SEC;
}

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function totalPathM(): number {
  let total = 0;
  for (let i = 0; i < DETOUR_PATH.length - 1; i++) {
    total += haversineM(DETOUR_PATH[i], DETOUR_PATH[i + 1]);
  }
  return total;
}

function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function deadReckonFrom(
  lat: number,
  lon: number,
  headingDeg: number,
  distM: number
): { lat: number; lon: number } {
  const R = 6_371_000;
  const hdgRad = (headingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const dLat = (distM / R) * Math.cos(hdgRad) * (180 / Math.PI);
  const dLon = cosLat > 1e-6 ? ((distM / R) * Math.sin(hdgRad) / cosLat) * (180 / Math.PI) : 0;
  return { lat: lat + dLat, lon: lon + dLon };
}

function detourEndPose(): { lat: number; lon: number; heading: number } {
  const last = DETOUR_PATH[DETOUR_PATH.length - 1];
  const prev = DETOUR_PATH[DETOUR_PATH.length - 2];
  return { lat: last.lat, lon: last.lon, heading: bearingDeg(prev, last) };
}

function sampleDetourPath(phase: number): { lat: number; lon: number; heading: number } {
  const p = Math.min(1, Math.max(0, phase));
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < DETOUR_PATH.length - 1; i++) {
    const len = haversineM(DETOUR_PATH[i], DETOUR_PATH[i + 1]);
    segLens.push(len);
    total += len;
  }
  if (total <= 0) {
    const first = DETOUR_PATH[0];
    return { lat: first.lat, lon: first.lon, heading: 90 };
  }
  if (p >= 1) return detourEndPose();

  let dist = p * total;
  for (let i = 0; i < segLens.length; i++) {
    const segLen = segLens[i];
    if (dist > segLen) {
      dist -= segLen;
      continue;
    }
    const a = DETOUR_PATH[i];
    const b = DETOUR_PATH[i + 1];
    const f = segLen > 0 ? dist / segLen : 0;
    return {
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + (b.lon - a.lon) * f,
      heading: bearingDeg(a, b),
    };
  }
  return detourEndPose();
}

function sampleAtElapsed(elapsedSec: number): { lat: number; lon: number; heading: number; phase: number } {
  const elapsed = Math.max(0, elapsedSec);
  if (elapsed <= FLIGHT_DURATION_SEC) {
    const phase = elapsed / FLIGHT_DURATION_SEC;
    return { ...sampleDetourPath(phase), phase };
  }
  const end = detourEndPose();
  const extraSec = elapsed - FLIGHT_DURATION_SEC;
  const distM = CRUISE_SPEED_KTS * 0.514444 * extraSec;
  const pos = deadReckonFrom(end.lat, end.lon, end.heading, distM);
  return { lat: pos.lat, lon: pos.lon, heading: end.heading, phase: 1 };
}

function altitudeAtElapsed(elapsedSec: number): number {
  const elapsed = Math.max(0, elapsedSec);
  if (elapsed <= FLIGHT_DURATION_SEC) {
    const p = elapsed / FLIGHT_DURATION_SEC;
    return Math.round(7800 + p * 2200 + Math.sin(p * Math.PI) * 400);
  }
  const endAlt = Math.round(7800 + 2200 + Math.sin(Math.PI) * 400);
  const extraMin = (elapsed - FLIGHT_DURATION_SEC) / 60;
  return Math.round(Math.min(endAlt + extraMin * 35, 12500));
}

function speedAtElapsed(elapsedSec: number): number {
  const elapsed = Math.max(0, elapsedSec);
  if (elapsed <= FLIGHT_DURATION_SEC) {
    const pathM = totalPathM();
    const kts = pathM / FLIGHT_DURATION_SEC / 0.514444;
    return Math.round(
      Math.min(245, Math.max(218, kts + Math.sin((elapsed / FLIGHT_DURATION_SEC) * Math.PI * 2) * 6))
    );
  }
  return CRUISE_SPEED_KTS;
}

function makeDetourPoint(t: number, sessionStart: number): ADSBData {
  const elapsed = t - sessionStart;
  const { lat, lon, heading } = sampleAtElapsed(elapsed);
  return {
    id: `${DETOUR_ICAO24}-${Math.round(t * 1000)}`,
    timestamp: t,
    icao24: DETOUR_ICAO24,
    callsign: DETOUR_CALLSIGN,
    latitude: lat,
    longitude: lon,
    altitude: altitudeAtElapsed(elapsed),
    speed: speedAtElapsed(elapsed),
    heading,
    live: true,
  };
}

/** 地图 RAF 专用：按墙钟直接算位置，不依赖插值/轮询重建 */
export function getDetourSnapshotAt(wallSec?: number): ADSBData {
  const now = wallSec ?? Date.now() / 1000;
  const sessionStart = readSessionStart(now);
  return makeDetourPoint(now, sessionStart);
}

/** 地图尾迹：仅已飞过点 + 当前位置 */
export function getDetourTrailLatLngs(wallSec?: number): [number, number][] {
  const tip = getDetourSnapshotAt(wallSec);
  const tipLl: [number, number] = [tip.latitude, tip.longitude];
  const hist = buildDetourLiveAdsb(wallSec)
    .filter((p) => p.id !== tip.id)
    .map((p) => [p.latitude, p.longitude] as [number, number]);
  const merged = hist.length > 0 ? [...hist, tipLl] : [tipLl];
  const trimmed = trimTrailBehindTip(merged, tipLl);
  return trimmed.length >= 2 ? trimmed : trimmed;
}

/** 增量追加航迹点（供列表/合并），绝不整段重算历史 */
export function buildDetourLiveAdsb(wallSec?: number): ADSBData[] {
  const now = wallSec ?? Date.now() / 1000;
  const sessionStart = readSessionStart(now);
  resetBufferIfNeeded(sessionStart);

  const firstT = Math.max(sessionStart, lastAppendedT + TRAIL_INTERVAL_SEC);
  for (let t = firstT; t <= now; t += TRAIL_INTERVAL_SEC) {
    trackBuffer.push(makeDetourPoint(t, sessionStart));
    lastAppendedT = t;
  }

  const cutoff = now - MAX_TRAIL_SEC;
  if (trackBuffer.length > 0 && trackBuffer[0].timestamp < cutoff) {
    trackBuffer = trackBuffer.filter((p) => p.timestamp >= cutoff);
  }

  const tip = makeDetourPoint(now, sessionStart);
  tip.id = `${DETOUR_ICAO24}-tip`;

  if (trackBuffer.length === 0) return [tip];
  const last = trackBuffer[trackBuffer.length - 1];
  if (Math.abs(last.timestamp - now) < 0.05) {
    trackBuffer[trackBuffer.length - 1] = tip;
    return [...trackBuffer];
  }
  return [...trackBuffer, tip];
}

/** 合并绕飞机到地图航迹（若后端已有同 ICAO 则跳过） */
export function countRealLiveAircraft(adsb: ADSBData[]): number {
  return new Set(
    adsb.filter((p) => p.live && p.icao24 !== DETOUR_ICAO24).map((p) => p.icao24.toLowerCase())
  ).size;
}

/** 仅当显式开启 NEXT_PUBLIC_ENABLE_DETOUR_DEMO=true 时才允许演示绕飞 */
export function isDetourDemoEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_DETOUR_DEMO === "true";
}

/** OpenSky 已有足够真实航班时，不再注入前端绕飞演示机 */
export function shouldInjectDetourAdsb(adsb: ADSBData[]): boolean {
  if (!isDetourDemoEnabled()) return false;
  return countRealLiveAircraft(adsb) < 2;
}

export function stripSyntheticDetour(adsb: ADSBData[]): ADSBData[] {
  return adsb.filter((p) => p.icao24 !== DETOUR_ICAO24);
}

export function mergeDetourLiveAdsb(adsb: ADSBData[]): ADSBData[] {
  if (!shouldInjectDetourAdsb(adsb)) return stripSyntheticDetour(adsb);
  if (adsb.some((p) => p.icao24 === DETOUR_ICAO24)) return adsb;
  return enrichVerticalRates([...adsb, ...buildDetourLiveAdsb()]);
}
