import { ADSBData } from "@/types";

export type InterpolatedTrackPoint = ADSBData;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function normalizeAngle360(deg: number): number {
  const n = ((deg % 360) + 360) % 360;
  // avoid -0
  return Object.is(n, -0) ? 0 : n;
}

/**
 * Interpolate angles in degrees following the shortest arc.
 * Inputs can be any real number; output is normalized to [0, 360).
 */
export function lerpHeadingDegrees(aDeg: number, bDeg: number, t: number): number {
  const a = normalizeAngle360(aDeg);
  const b = normalizeAngle360(bDeg);
  let delta = b - a;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return normalizeAngle360(a + delta * t);
}

/**
 * Interpolate longitude in degrees taking dateline wrap-around into account.
 * Output normalized to [-180, 180].
 */
export function lerpLongitudeDegrees(aLon: number, bLon: number, t: number): number {
  let a = aLon;
  let b = bLon;
  let delta = b - a;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const lon = a + delta * t;
  // normalize to [-180, 180]
  let n = ((lon + 180) % 360 + 360) % 360 - 180;
  return Object.is(n, -0) ? 0 : n;
}

function lerpIfFinite(a: unknown, b: unknown, t: number, fallback: number): number {
  if (isFiniteNumber(a) && isFiniteNumber(b)) return lerp(a, b, t);
  if (isFiniteNumber(a)) return a;
  if (isFiniteNumber(b)) return b;
  return fallback;
}

function lerpOptionalIfFinite(a: unknown, b: unknown, t: number): number | undefined {
  if (isFiniteNumber(a) && isFiniteNumber(b)) return lerp(a, b, t);
  if (isFiniteNumber(a)) return a;
  if (isFiniteNumber(b)) return b;
  return undefined;
}

function makeInterpolatedId(icao24: string, timestamp: number): string {
  // keep deterministic and stable enough for UI keys
  const ts = Number.isFinite(timestamp) ? timestamp : 0;
  return `${icao24}-interp-${ts.toFixed(3)}`;
}

export type BracketResult =
  | { kind: "empty" }
  | { kind: "clamp"; point: ADSBData }
  | { kind: "exact"; point: ADSBData }
  | { kind: "between"; a: ADSBData; b: ADSBData; t: number };

/**
 * Assumes `points` is sorted ascending by timestamp.
 */
export function bracketByTime(points: ADSBData[], timestamp: number): BracketResult {
  if (points.length === 0) return { kind: "empty" };

  const t = timestamp;
  const first = points[0];
  const last = points[points.length - 1];

  if (!Number.isFinite(t)) return { kind: "clamp", point: last };
  if (t <= first.timestamp) return { kind: "clamp", point: first };
  if (t >= last.timestamp) return { kind: "clamp", point: last };

  // lower_bound for first idx with ts >= t
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].timestamp >= t) hi = mid;
    else lo = mid + 1;
  }

  const b = points[lo];
  if (b.timestamp === t) return { kind: "exact", point: b };
  const a = points[lo - 1];
  const dt = b.timestamp - a.timestamp;
  const tt = dt === 0 ? 0 : (t - a.timestamp) / dt;
  const alpha = Math.max(0, Math.min(1, tt));

  return { kind: "between", a, b, t: alpha };
}

/**
 * Produce an interpolated ADSB point at `timestamp` from sorted `points`.
 * - If timestamp outside range: clamps to nearest endpoint.
 * - If timestamp equals an existing point: returns that point.
 * - Else: returns a synthetic point with interpolated fields.
 */
export function interpolateAdsbAtTime(
  pointsSorted: ADSBData[],
  timestamp: number,
  options?: { outside?: "clamp" | "null" }
): ADSBData | null {
  if (pointsSorted.length === 0) return null;
  if (!Number.isFinite(timestamp)) return null;

  const outside = options?.outside ?? "clamp";
  const first = pointsSorted[0];
  const last = pointsSorted[pointsSorted.length - 1];

  if (timestamp < first.timestamp || timestamp > last.timestamp) {
    return outside === "clamp" ? (timestamp < first.timestamp ? first : last) : null;
  }

  const br = bracketByTime(pointsSorted, timestamp);
  if (br.kind === "empty") return null;
  if (br.kind === "clamp") return br.point;
  if (br.kind === "exact") return br.point;

  const { a, b, t } = br;

  const lat = lerpIfFinite(a.latitude, b.latitude, t, a.latitude);
  const lon = isFiniteNumber(a.longitude) && isFiniteNumber(b.longitude)
    ? lerpLongitudeDegrees(a.longitude, b.longitude, t)
    : lerpIfFinite(a.longitude, b.longitude, t, a.longitude);

  const heading = isFiniteNumber(a.heading) && isFiniteNumber(b.heading)
    ? lerpHeadingDegrees(a.heading, b.heading, t)
    : lerpIfFinite(a.heading, b.heading, t, 0);

  const altitude = lerpIfFinite(a.altitude, b.altitude, t, 0);
  const speed = lerpIfFinite(a.speed, b.speed, t, 0);
  const verticalRate = lerpOptionalIfFinite(a.verticalRate, b.verticalRate, t);

  return {
    id: makeInterpolatedId(a.icao24, timestamp),
    timestamp,
    icao24: a.icao24,
    callsign: a.callsign ?? b.callsign,
    latitude: lat,
    longitude: lon,
    altitude,
    speed,
    heading,
    verticalRate,
  };
}

export type InterpolatedTracksResult = {
  currentPoints: ADSBData[];
  trailPoints: ADSBData[];
};

export type AdsbTrackIndex = {
  tracks: Map<string, ADSBData[]>;
};

/** 近似地面距离（米） */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type DedupeAdsbOptions = {
  /** 与上一点距离小于该值（米）且非末点则丢弃，去掉悬停重复点 */
  minMoveMeters?: number;
  /** 每条航迹最多保留点数（保留首、尾与均匀抽样） */
  maxPointsPerFlight?: number;
};

/**
 * 按航班号去重：去掉相同位置重复点，并限制单条尾迹长度。
 */
export function dedupeAdsbPointsByFlight(
  points: ADSBData[],
  options?: DedupeAdsbOptions
): ADSBData[] {
  const minMove = options?.minMoveMeters ?? 120;
  const maxPts = options?.maxPointsPerFlight ?? 160;

  const byFlight = new Map<string, ADSBData[]>();
  for (const p of points) {
    const key = String(p.icao24 || "").toLowerCase();
    if (!key) continue;
    const arr = byFlight.get(key) ?? [];
    arr.push(p);
    byFlight.set(key, arr);
  }

  const out: ADSBData[] = [];
  for (const arr of byFlight.values()) {
    const sorted = [...arr].sort((a, b) => a.timestamp - b.timestamp || String(a.id).localeCompare(String(b.id)));
    if (sorted.length <= 1) {
      out.push(...sorted);
      continue;
    }

    const kept: ADSBData[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const p = sorted[i];
      const last = kept[kept.length - 1];
      const isLast = i === sorted.length - 1;
      const dist = haversineMeters(last.latitude, last.longitude, p.latitude, p.longitude);
      const sameCoord =
        Math.abs(p.latitude - last.latitude) < 1e-6 && Math.abs(p.longitude - last.longitude) < 1e-6;
      if (!isLast && (sameCoord || dist < minMove)) continue;
      kept.push(p);
    }

    const tail = sorted[sorted.length - 1];
    if (kept[kept.length - 1].id !== tail.id) kept.push(tail);

    if (kept.length <= maxPts) {
      out.push(...kept);
      continue;
    }
    // 均匀抽样，始终保留首尾
    const sampled: ADSBData[] = [kept[0]];
    const inner = kept.slice(1, -1);
    const slots = maxPts - 2;
    for (let k = 0; k < slots; k++) {
      const idx = Math.min(inner.length - 1, Math.round(((k + 1) * inner.length) / (slots + 1)) - 1);
      sampled.push(inner[idx]);
    }
    sampled.push(kept[kept.length - 1]);
    out.push(...sampled);
  }

  return out;
}

/** OpenSky vertical_rate 为 m/s，入库为 ft/min */
export const METERS_PER_SEC_TO_FPM = 196.8503937;

/**
 * 为航迹点补全爬升率 (ft/min)：优先保留已有值，否则用相邻点高度差推算。
 */
export function enrichVerticalRates(points: ADSBData[]): ADSBData[] {
  if (points.length === 0) return points;

  const byIcao = new Map<string, ADSBData[]>();
  for (const p of points) {
    const arr = byIcao.get(p.icao24) ?? [];
    arr.push({ ...p });
    byIcao.set(p.icao24, arr);
  }

  const out: ADSBData[] = [];
  for (const arr of byIcao.values()) {
    const sorted = arr.sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      let vr = p.verticalRate;

      if (vr === undefined || !Number.isFinite(vr)) {
        if (i > 0) {
          const prev = sorted[i - 1];
          const dt = p.timestamp - prev.timestamp;
          if (dt > 0 && dt <= 20 * 60) {
            vr = ((p.altitude - prev.altitude) / dt) * 60;
          }
        }
        if ((vr === undefined || !Number.isFinite(vr)) && i < sorted.length - 1) {
          const next = sorted[i + 1];
          const dt = next.timestamp - p.timestamp;
          if (dt > 0 && dt <= 20 * 60) {
            vr = ((next.altitude - p.altitude) / dt) * 60;
          }
        }
      }

      out.push(
        vr !== undefined && Number.isFinite(vr)
          ? { ...p, verticalRate: Math.round(vr * 10) / 10 }
          : p
      );
    }
  }
  return out;
}

export function formatVerticalRateFpm(vr: number | undefined): string {
  if (vr === undefined || !Number.isFinite(vr)) return "—";
  const n = Math.round(vr);
  if (n > 0) return `+${n}`;
  return String(n);
}

export function buildAdsbTrackIndex(
  points: ADSBData[],
  isVisibleAircraft?: (icao24: string) => boolean,
  dedupeOptions?: DedupeAdsbOptions
): AdsbTrackIndex {
  const filtered = isVisibleAircraft ? points.filter((p) => isVisibleAircraft(p.icao24)) : points;
  const deduped = dedupeAdsbPointsByFlight(filtered, dedupeOptions);

  const tracks = new Map<string, ADSBData[]>();
  for (const p of deduped) {
    const arr = tracks.get(p.icao24) ?? [];
    arr.push(p);
    tracks.set(p.icao24, arr);
  }

  for (const arr of tracks.values()) {
    arr.sort((a, b) => a.timestamp - b.timestamp);
  }

  return { tracks };
}

export function upperBoundByTime(points: ADSBData[], timestamp: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].timestamp <= timestamp) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function queryInterpolatedTracks(
  index: AdsbTrackIndex,
  currentTime: number
): InterpolatedTracksResult {
  const currentPoints: ADSBData[] = [];
  const trailPoints: ADSBData[] = [];

  for (const [, arr] of index.tracks.entries()) {
    if (arr.length === 0 || currentTime < arr[0].timestamp) continue;

    const current = interpolateAdsbAtTime(arr, currentTime, { outside: "null" });
    if (current) currentPoints.push(current);

    const historyEnd = upperBoundByTime(arr, currentTime);
    for (let i = 0; i < historyEnd; i++) trailPoints.push(arr[i]);

    const lastHist = historyEnd > 0 ? arr[historyEnd - 1] : undefined;
    if (current && (!lastHist || current.timestamp > lastHist.timestamp)) {
      trailPoints.push(current);
    }
  }

  return { currentPoints, trailPoints };
}

export type AdsbPlaybackQueryOptions = {
  /** 播放条早于首点时仍显示首点（避免 0s 时地图 0 targets） */
  clampBeforeFirst?: boolean;
};

export function queryCurrentAdsbPoints(
  index: AdsbTrackIndex,
  currentTime: number,
  options?: AdsbPlaybackQueryOptions
): ADSBData[] {
  const currentPoints: ADSBData[] = [];

  for (const [, arr] of index.tracks.entries()) {
    if (arr.length === 0) continue;
    if (currentTime < arr[0].timestamp) {
      if (options?.clampBeforeFirst) currentPoints.push(arr[0]);
      continue;
    }
    const current = interpolateAdsbAtTime(arr, currentTime, { outside: "null" });
    if (current) currentPoints.push(current);
  }

  return currentPoints;
}

/** 每架飞机取最新一个点（用于 OpenSky 实时层，时间轴与录音无关） */
export function queryLatestAdsbPoints(index: AdsbTrackIndex): ADSBData[] {
  const currentPoints: ADSBData[] = [];
  for (const [, arr] of index.tracks.entries()) {
    if (arr.length > 0) currentPoints.push(arr[arr.length - 1]);
  }
  return currentPoints;
}

export function queryAdsbTrailPoints(
  index: AdsbTrackIndex,
  currentTime: number,
  options?: AdsbPlaybackQueryOptions
): ADSBData[] {
  const trailPoints: ADSBData[] = [];

  for (const [, arr] of index.tracks.entries()) {
    if (arr.length === 0) continue;
    if (currentTime < arr[0].timestamp) {
      if (options?.clampBeforeFirst) trailPoints.push(arr[0]);
      continue;
    }

    const current = interpolateAdsbAtTime(arr, currentTime, { outside: "null" });
    const historyEnd = upperBoundByTime(arr, currentTime);
    for (let i = 0; i < historyEnd; i++) trailPoints.push(arr[i]);

    const lastHist = historyEnd > 0 ? arr[historyEnd - 1] : undefined;
    if (current && (!lastHist || current.timestamp > lastHist.timestamp)) {
      trailPoints.push(current);
    }
  }

  return trailPoints;
}

/**
 * Build per-aircraft current interpolated point and trail points up to `currentTime`.
 * - `points` should include multiple aircraft.
 * - Assumes `currentTime` is in the same unit as ADSBData.timestamp (seconds in this repo).
 */
export function buildInterpolatedTracks(
  points: ADSBData[],
  currentTime: number,
  isVisibleAircraft?: (icao24: string) => boolean
): InterpolatedTracksResult {
  return queryInterpolatedTracks(buildAdsbTrackIndex(points, isVisibleAircraft), currentTime);
}
