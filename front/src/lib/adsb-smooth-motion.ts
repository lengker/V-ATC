import type { ADSBData } from "@/types";
import { lerpHeadingDegrees, lerpLongitudeDegrees } from "@/lib/adsb-interpolation";

export type AircraftAnimState = {
  lat: number;
  lon: number;
  heading: number;
  targetLat: number;
  targetLon: number;
  targetHeading: number;
  speedKts: number;
  lastFrameMs: number;
};

const POSITION_TAU_SEC = 2.2;
const HEADING_TAU_SEC = 1.0;

function expAlpha(dtSec: number, tauSec: number): number {
  if (tauSec <= 0) return 1;
  return 1 - Math.exp(-dtSec / tauSec);
}

export function syncAnimTargets(
  states: Map<string, AircraftAnimState>,
  points: ADSBData[],
  nowMs: number
): void {
  const seen = new Set<string>();
  for (const p of points) {
    const id = p.icao24;
    seen.add(id);
    const heading = Number(p.heading) || 0;
    const existing = states.get(id);
    if (!existing) {
      states.set(id, {
        lat: p.latitude,
        lon: p.longitude,
        heading,
        targetLat: p.latitude,
        targetLon: p.longitude,
        targetHeading: heading,
        speedKts: Number(p.speed) || 0,
        lastFrameMs: nowMs,
      });
      continue;
    }
    existing.targetLat = p.latitude;
    existing.targetLon = p.longitude;
    existing.targetHeading = heading;
    existing.speedKts = Number(p.speed) || 0;
  }
  for (const id of states.keys()) {
    if (!seen.has(id)) states.delete(id);
  }
}

export function tickAircraftAnim(
  states: Map<string, AircraftAnimState>,
  sourceById: Map<string, ADSBData>,
  nowMs: number
): Map<string, ADSBData> {
  const out = new Map<string, ADSBData>();
  for (const [id, s] of states) {
    const src = sourceById.get(id);
    if (!src) continue;

    const dt = Math.min(0.1, Math.max(0.001, (nowMs - s.lastFrameMs) / 1000));
    s.lastFrameMs = nowMs;

    const aPos = expAlpha(dt, POSITION_TAU_SEC);
    const aHdg = expAlpha(dt, HEADING_TAU_SEC);

    s.lat = s.lat + (s.targetLat - s.lat) * aPos;
    s.lon = lerpLongitudeDegrees(s.lon, s.targetLon, aHdg);
    s.heading = lerpHeadingDegrees(s.heading, s.targetHeading, aHdg);

    out.set(id, {
      ...src,
      latitude: s.lat,
      longitude: s.lon,
      heading: s.heading,
    });
  }
  return out;
}
