import type { ADSBData } from "@/types";
import {
  type AdsbTrackIndex,
  interpolateAdsbAtTime,
  upperBoundByTime,
} from "@/lib/adsb-interpolation";

export type LivePlaybackOptions = {
  /** 超过最新点后最多外推秒数，避免 OpenSky 停更时飞机一直漂移 */
  maxExtrapolateSec?: number;
  /** 低于该地速（节）视为静止，不外推 */
  minSpeedKtsForDeadReckon?: number;
};

function deadReckonExtrapolate(
  last: ADSBData,
  wallSec: number,
  options?: LivePlaybackOptions
): ADSBData {
  const dt = wallSec - last.timestamp;
  const speedKts = Number(last.speed) || 0;
  const minSpeed = options?.minSpeedKtsForDeadReckon ?? 8;

  if (speedKts < minSpeed || dt <= 0) {
    return { ...last, timestamp: wallSec };
  }

  const distM = speedKts * 0.514444 * dt;
  const hdgDeg = Number(last.heading) || 0;
  const hdgRad = (hdgDeg * Math.PI) / 180;
  const R = 6_371_000;
  const latRad = (last.latitude * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const dLat = (distM / R) * Math.cos(hdgRad) * (180 / Math.PI);
  const dLon = cosLat > 1e-6 ? ((distM / R) * Math.sin(hdgRad) / cosLat) * (180 / Math.PI) : 0;

  return {
    ...last,
    id: `${last.icao24}-extrap-${wallSec.toFixed(1)}`,
    timestamp: wallSec,
    latitude: last.latitude + dLat,
    longitude: last.longitude + dLon,
    heading: hdgDeg,
    live: last.live,
  };
}

/**
 * 按墙钟时间在已缓存航迹上采样：段内线性插值，段末短暂外推，不等待下一次抓取。
 */
export function sampleAircraftAtWallTime(
  pointsSorted: ADSBData[],
  wallSec: number,
  options?: LivePlaybackOptions
): ADSBData | null {
  if (pointsSorted.length === 0 || !Number.isFinite(wallSec)) return null;

  const first = pointsSorted[0];
  const last = pointsSorted[pointsSorted.length - 1];

  if (wallSec < first.timestamp) return null;

  if (wallSec <= last.timestamp) {
    return interpolateAdsbAtTime(pointsSorted, wallSec, { outside: "null" });
  }

  const extrapDt = wallSec - last.timestamp;
  const maxExtrap = options?.maxExtrapolateSec ?? 120;
  if (extrapDt > maxExtrap) {
    return { ...last, timestamp: wallSec };
  }

  return deadReckonExtrapolate(last, wallSec, options);
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

/** 截断尾迹：只保留飞机当前位置之后（已飞过）的折线，去掉前方/回溯段 */
export function trimTrailBehindTip(
  latlngs: [number, number][],
  tip: [number, number],
  toleranceM = 120
): [number, number][] {
  if (latlngs.length === 0) return [tip];

  const distToTip = (p: [number, number]) =>
    haversineM({ lat: p[0], lon: p[1] }, { lat: tip[0], lon: tip[1] });

  const out: [number, number][] = [];
  let prevDist = Infinity;

  for (const p of latlngs) {
    if (Math.abs(p[0] - tip[0]) < 1e-9 && Math.abs(p[1] - tip[1]) < 1e-9) continue;
    const d = distToTip(p);
    if (out.length > 0 && d > prevDist + toleranceM) break;
    out.push(p);
    prevDist = d;
  }

  const last = out[out.length - 1];
  if (!last || last[0] !== tip[0] || last[1] !== tip[1]) {
    out.push(tip);
  }
  return out.length >= 1 ? out : [tip];
}

export function buildLiveTrailLatLngs(
  pointsSorted: ADSBData[],
  wallSec: number,
  options?: LivePlaybackOptions & { maxPoints?: number }
): [number, number][] {
  const tip = sampleAircraftAtWallTime(pointsSorted, wallSec, options);
  if (!tip) return [];

  const end = upperBoundByTime(pointsSorted, wallSec);
  const latlngs: [number, number][] = [];
  for (let i = 0; i < end; i++) {
    latlngs.push([pointsSorted[i].latitude, pointsSorted[i].longitude]);
  }

  const lastHist = end > 0 ? pointsSorted[end - 1] : undefined;
  if (!lastHist || tip.timestamp > lastHist.timestamp + 0.01) {
    latlngs.push([tip.latitude, tip.longitude]);
  } else if (latlngs.length > 0) {
    latlngs[latlngs.length - 1] = [tip.latitude, tip.longitude];
  }

  const maxPts = options?.maxPoints ?? 200;
  let result = latlngs;
  if (result.length <= maxPts) {
    return trimTrailBehindTip(result, [tip.latitude, tip.longitude]);
  }

  const step = Math.ceil(result.length / maxPts);
  const sampled: [number, number][] = [];
  for (let i = 0; i < result.length; i += step) sampled.push(result[i]);
  const tail = result[result.length - 1];
  const lastS = sampled[sampled.length - 1];
  if (!lastS || lastS[0] !== tail[0] || lastS[1] !== tail[1]) sampled.push(tail);

  return trimTrailBehindTip(sampled, [tip.latitude, tip.longitude]);
}

/** 实时层：在缓存航迹上按当前墙钟采样，用于标记存在性（位置由 RAF 每帧更新） */
export function queryLivePlaybackPoints(
  index: AdsbTrackIndex,
  wallSec: number,
  options?: LivePlaybackOptions & { maxAgeSec?: number }
): ADSBData[] {
  const maxAge = options?.maxAgeSec ?? 25 * 60;
  const out: ADSBData[] = [];

  for (const [, arr] of index.tracks) {
    if (!arr.length) continue;
    const last = arr[arr.length - 1];
    if (wallSec - last.timestamp > maxAge) continue;
    const p = sampleAircraftAtWallTime(arr, wallSec, options);
    if (p) out.push(p);
  }

  return out;
}
