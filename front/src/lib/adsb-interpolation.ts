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
  const byAircraft = new Map<string, ADSBData[]>();

  for (const p of points) {
    if (isVisibleAircraft && !isVisibleAircraft(p.icao24)) continue;
    const arr = byAircraft.get(p.icao24) ?? [];
    arr.push(p);
    byAircraft.set(p.icao24, arr);
  }

  const currentPoints: ADSBData[] = [];
  const trailPoints: ADSBData[] = [];

  for (const [, arr] of byAircraft.entries()) {
    arr.sort((a, b) => a.timestamp - b.timestamp);

    // Before the aircraft track starts: hide completely.
    if (arr.length === 0 || currentTime < arr[0].timestamp) continue;

    const current = interpolateAdsbAtTime(arr, currentTime, { outside: "null" });
    if (current) currentPoints.push(current);

    // Discrete history (always valid), up to currentTime (or the end of track)
    const history = arr.filter((p) => p.timestamp <= currentTime);

    // if current is interpolated between two points, append it to trail
    const lastHist = history[history.length - 1];
    if (current && (!lastHist || current.timestamp > lastHist.timestamp)) {
      history.push(current);
    }

    for (const p of history) trailPoints.push(p);
  }

  return { currentPoints, trailPoints };
}
