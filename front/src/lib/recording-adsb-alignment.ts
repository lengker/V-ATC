import { DETOUR_ICAO24, stripSyntheticDetour } from "@/lib/detour-aircraft";
import {
  enrichVerticalRates,
  type DedupeAdsbOptions,
} from "@/lib/adsb-interpolation";
import { parseRecordingUtcRangeFromFileName } from "@/lib/recording-display";
import type { ADSBData, AudioData } from "@/types";

/** 与 backend-api 中 BackendTrack 字段一致，避免循环依赖 */
export type MapTrackRow = {
  track_id: number;
  timestamp?: string | number;
  flight_id?: string;
  tracks_latitude?: number;
  tracks_longitude?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  vertical_rate?: number;
  departure_airport_code?: string;
  arrival_airport_code?: string;
  next_id?: number | string | null;
  prev_id?: number | string | null;
};

/**
 * 解析为 Unix 秒。A5/SQLite 常返回 `2026-05-31 09:24:10` 无 Z — 必须按 UTC，否则东八区会偏 8h 导致「时段内无航迹」。
 */
export function toUnixSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e11 ? value / 1000 : value;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  if (/^\d{10,}$/.test(raw)) {
    const n = Number(raw);
    return n > 1e11 ? n / 1000 : n;
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const iso = raw.includes("T") ? `${raw}Z` : `${raw.replace(" ", "T")}Z`;
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms / 1000;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms / 1000 : 0;
}

const VHHH_CENTER = { lat: 22.308, lon: 113.918 };

function isNearVhhh(lat: unknown, lon: unknown, delta = 2.5): boolean {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  return Math.abs(la - VHHH_CENTER.lat) <= delta && Math.abs(lo - VHHH_CENTER.lon) <= delta;
}

function expandLinkedTracks(allRows: MapTrackRow[], seedIds: Set<number>): MapTrackRow[] {
  const byId = new Map<number, MapTrackRow>();
  for (const t of allRows) {
    const id = Number(t.track_id);
    if (Number.isFinite(id)) byId.set(id, t);
  }
  const out = new Map<number, MapTrackRow>();
  const stack = [...seedIds].filter((x) => Number.isFinite(x));
  while (stack.length) {
    const id = stack.pop()!;
    if (!Number.isFinite(id) || out.has(id)) continue;
    const row = byId.get(id);
    if (!row) continue;
    out.set(id, row);
    const nxt = row.next_id != null && row.next_id !== "" ? Number(row.next_id) : NaN;
    const prv = row.prev_id != null && row.prev_id !== "" ? Number(row.prev_id) : NaN;
    if (Number.isFinite(nxt)) stack.push(nxt);
    if (Number.isFinite(prv)) stack.push(prv);
  }
  return [...out.values()];
}

function expandTracksForMap(
  allRows: MapTrackRow[],
  seedIds: Set<number>,
  options?: { preferVhhh?: boolean }
): MapTrackRow[] {
  const linked = expandLinkedTracks(allRows, seedIds);
  const out = new Map<number, MapTrackRow>();
  for (const t of linked) {
    const id = Number(t.track_id);
    if (Number.isFinite(id)) out.set(id, t);
  }
  const flightIds = new Set(linked.map((t) => String(t.flight_id || "").trim()).filter(Boolean));
  for (const row of allRows) {
    const fid = String(row.flight_id || "").trim();
    if (!fid || !flightIds.has(fid)) continue;
    const id = Number(row.track_id);
    if (Number.isFinite(id)) out.set(id, row);
  }
  let rows = [...out.values()];
  if (options?.preferVhhh) {
    const hk = rows.filter((t) => isNearVhhh(t.tracks_latitude, t.tracks_longitude));
    if (hk.length >= 2) rows = hk;
  }
  return rows;
}

function rowToAdsb(t: MapTrackRow, relTs: number): ADSBData {
  const flight = t.flight_id || `track-${t.track_id}`;
  return {
    id: String(t.track_id),
    timestamp: relTs,
    icao24: String(flight).toLowerCase(),
    callsign: flight,
    latitude: Number(t.tracks_latitude),
    longitude: Number(t.tracks_longitude),
    altitude: Number(t.altitude) || 0,
    speed: Number(t.speed) || 0,
    heading: Number(t.heading) || 0,
    verticalRate:
      t.vertical_rate != null && Number.isFinite(Number(t.vertical_rate))
        ? Number(t.vertical_rate)
        : undefined,
    live: false,
  };
}

function utcWindowFromIso(
  startTimeUtc: string,
  endTimeUtc: string | undefined,
  durationSec: number
): { startSec: number; endSec: number } | null {
  const startSec = toUnixSeconds(startTimeUtc);
  if (startSec < 1_000_000_000) return null;
  let endSec = endTimeUtc ? toUnixSeconds(endTimeUtc) : startSec + Math.max(1, durationSec);
  if (!Number.isFinite(endSec) || endSec <= startSec) {
    endSec = startSec + Math.max(1, durationSec);
  }
  return { startSec, endSec };
}

/** 录音是否有可用于对齐的 UTC 时间窗（含从文件名纠正误写的「当前时刻」） */
export function resolveRecordingUtcWindow(
  audio: AudioData
): { startSec: number; endSec: number } | null {
  const duration = Math.max(1, audio.duration);
  const fileName = audio.metadata?.fileName ?? "";
  const fromFile = fileName
    ? parseRecordingUtcRangeFromFileName(fileName, duration)
    : null;
  const fileWindow = fromFile ? utcWindowFromIso(fromFile.startTimeUtc, fromFile.endTimeUtc, duration) : null;

  const startUtc = audio.metadata?.startTimeUtc;
  if (!startUtc) return fileWindow;

  const metaWindow = utcWindowFromIso(startUtc, audio.metadata?.endTimeUtc, duration);
  if (!metaWindow) return fileWindow;
  if (!fileWindow) return metaWindow;

  const metaFileDiffSec = Math.abs(metaWindow.startSec - fileWindow.startSec);
  // 文件名已按 HKT→UTC 解析；差 ~8h 说明库内 start_time_utc 把 HKT 误标成 UTC
  if (metaFileDiffSec >= 4 * 3600 && metaFileDiffSec <= 10 * 3600) return fileWindow;

  const now = Date.now() / 1000;
  const metaLooksLikeAccidentalNow =
    now - metaWindow.startSec < 72 * 3600 && fileWindow.startSec < now - 7 * 24 * 3600;
  if (metaLooksLikeAccidentalNow) return fileWindow;
  return metaWindow;
}

/** @deprecated 使用 resolveRecordingUtcWindow */
export function parseRecordingUtcWindow(audio: AudioData): { startSec: number; endSec: number } | null {
  return resolveRecordingUtcWindow(audio);
}

export function isRecordingTimelineAligned(audio: AudioData): boolean {
  return resolveRecordingUtcWindow(audio) != null;
}

/** 录音时段内的历史航迹（不含 OpenSky 实时层） */
export function timelineAdsbPoints(adsb: ADSBData[]): ADSBData[] {
  return adsb.filter((p) => !p.live);
}

/** 当前 workspace 是否含可对齐回放的历史航迹点 */
export function recordingHasTimelineAdsb(adsb: ADSBData[]): boolean {
  return timelineAdsbPoints(adsb).length > 0;
}

/** 录音是否在最近几小时内采集（可用 OpenSky 缓存按墙钟对齐） */
export function isRecentRecording(audio: AudioData, maxAgeSec = 6 * 3600): boolean {
  const window = resolveRecordingUtcWindow(audio);
  if (!window) return false;
  const now = Date.now() / 1000;
  return now - window.startSec <= maxAgeSec + 120;
}

const HKT_UTC_SHIFT_SEC = 8 * 3600;

const CALLSIGN_IN_TEXT =
  /\b([A-Z]{3}\d{1,4}[A-Z]?|CCA\d+|CPA\d+|CSN\d+|CRK\d+|HKE\d+|HXA\d+|AHK\d+|CDC\d+|CHC[A-Z0-9]+)\b/gi;

function extractCallsignsFromTimestamps(timestamps: { text?: string }[]): string[] {
  const out = new Set<string>();
  for (const ts of timestamps) {
    const text = String(ts.text ?? "").toUpperCase();
    if (!text) continue;
    for (const m of text.matchAll(CALLSIGN_IN_TEXT)) {
      const cs = m[1]?.trim();
      if (cs && cs.length >= 3) out.add(cs);
    }
  }
  return [...out];
}

/** 呼号 / flight_id 是否匹配航迹点（icao24 与 callsign 均参与） */
export function matchesFlightKey(p: ADSBData, key: string): boolean {
  if (!key) return false;
  const k = key.toLowerCase();
  return p.icao24.toLowerCase() === k || (p.callsign?.toLowerCase() ?? "") === k;
}

function trackHaversineM(a: ADSBData, b: ADSBData): number {
  const R = 6_371_000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isForcedMapAircraft(
  track: ADSBData[],
  forceKeys: Iterable<string>
): boolean {
  if (!track.length) return false;
  const probe = track[0];
  for (const k of forceKeys) {
    if (k && matchesFlightKey(probe, k)) return true;
  }
  return false;
}

export type MapDisplayQualityOptions = {
  wallSec?: number;
  forceKeys?: Iterable<string>;
  /** 末点超过该秒数未更新则视为已飞离/失效 */
  maxStaleSec?: number;
  minTrackSpanSec?: number;
  minMoveMeters?: number;
  minSpeedKts?: number;
  nearVhhhDelta?: number;
};

/**
 * 地图是否应渲染该航迹：剔除静止假目标、重复钉点、已飞出香港终端区、长时间无更新的目标。
 * 录音主目标 / 当前选中机通过 forceKeys 豁免（可为 0 节或单点）。
 */
export function passesMapDisplayQuality(
  track: ADSBData[],
  options?: MapDisplayQualityOptions
): boolean {
  if (!track.length) return false;
  const forceKeys = options?.forceKeys ?? [];
  if (isForcedMapAircraft(track, forceKeys)) return true;

  const sorted = [...track].sort((a, b) => a.timestamp - b.timestamp);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const wallSec = options?.wallSec ?? Date.now() / 1000;

  if (
    last.timestamp > 1_000_000_000 &&
    wallSec - last.timestamp > (options?.maxStaleSec ?? 180)
  ) {
    return false;
  }

  if (
    !isNearVhhh(last.latitude, last.longitude, options?.nearVhhhDelta ?? 2.5)
  ) {
    return false;
  }

  let maxMove = 0;
  for (let i = 1; i < sorted.length; i++) {
    const d = trackHaversineM(sorted[i - 1], sorted[i]);
    if (d > maxMove) maxMove = d;
  }

  const minMove = options?.minMoveMeters ?? 90;
  const minSpan = options?.minTrackSpanSec ?? 2;
  const minSpeed = options?.minSpeedKts ?? 10;
  const span = last.timestamp - first.timestamp;
  const lastSpeed = Number(last.speed) || 0;

  if (sorted.length < 2) {
    return lastSpeed >= minSpeed;
  }

  if (span < minSpan && maxMove < minMove) return false;
  if (lastSpeed < minSpeed && maxMove < minMove * 1.2) return false;
  if (maxMove < 35 && lastSpeed < 6) return false;

  return true;
}

/** 将呼号解析为航迹里实际使用的 icao24（小写） */
export function resolveIcao24ForFlightKey(pool: ADSBData[], key: string): string | undefined {
  const match = pool.find((p) => matchesFlightKey(p, key));
  return match ? match.icao24.toLowerCase() : undefined;
}

/** OpenSky 墙钟点（优先 live 层，避免稀疏对齐「假飞机」） */
function liveWallClockPool(adsb: ADSBData[]): ADSBData[] {
  return stripSyntheticDetour(adsb).filter((p) => p.live === true || p.timestamp > 1_000_000_000);
}

/** 地图上优先高亮的 icao24（小写；由呼号 / flight_id 解析到真实航迹键） */
export function primaryCallsignForRecording(audio: AudioData, adsb: ADSBData[]): string | undefined {
  const cleaned = stripSyntheticDetour(adsb);
  const livePool = liveWallClockPool(cleaned);
  const pool = livePool.length > 0 ? livePool : cleaned;
  if (pool.length === 0) return undefined;

  const hinted = audio.metadata?.primaryCallsign?.trim();
  const trackId = audio.metadata?.trackId;
  if (hinted && trackId != null && trackId > 1) {
    const resolved = resolveIcao24ForFlightKey(pool, hinted);
    if (resolved) {
      const pts = pool.filter((p) => p.icao24.toLowerCase() === resolved);
      if (pts.length >= 2) return resolved;
    }
  }

  for (const cs of extractCallsignsFromTimestamps(audio.timestamps ?? [])) {
    const resolved = resolveIcao24ForFlightKey(pool, cs);
    if (resolved) {
      const pts = pool.filter((p) => matchesFlightKey(p, resolved));
      if (pts.length >= 2) return resolved;
    }
  }

  const counts = new Map<string, number>();
  for (const p of livePool.length > 0 ? livePool : pool) {
    counts.set(p.icao24.toLowerCase(), (counts.get(p.icao24.toLowerCase()) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (k === DETOUR_ICAO24) continue;
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  if (best && bestN >= 2) return best;
  return pickFallbackPrimaryFromLive(audio, livePool.length > 0 ? livePool : cleaned);
}

/** 解析为航迹池里实际使用的键（icao24 小写），供地图选中/聚焦 */
export function resolvePrimaryAircraftKey(audio: AudioData, adsb: ADSBData[]): string | undefined {
  const raw = primaryCallsignForRecording(audio, adsb);
  if (!raw) return undefined;
  const pool = liveWallClockPool(stripSyntheticDetour(adsb));
  const search = pool.length > 0 ? pool : stripSyntheticDetour(adsb);
  return resolveIcao24ForFlightKey(search, raw) ?? raw.toLowerCase();
}

/** 录音列表副标题：时段内航迹架数（避免展示错误的 track_id=1 呼号） */
export function recordingTrackSummary(audio: AudioData, adsb: ADSBData[]): string {
  const timeline = timelineAdsbPoints(stripSyntheticDetour(adsb));
  const n = new Set(timeline.map((p) => p.icao24)).size;
  if (n > 0) {
    const primaryKey = resolvePrimaryAircraftKey(audio, adsb);
    if (primaryKey) {
      const p = adsb.find((x) => matchesFlightKey(x, primaryKey));
      const label = (p?.callsign?.trim() || primaryKey).toUpperCase();
      return `时段 ${n} 架 · 主目标 ${label}`;
    }
    return `时段 ${n} 架`;
  }
  return "时段内无 ADS-B";
}

export type BuildAlignedAdsbOptions = {
  trackId?: number;
  /** 时间窗外扩秒数，便于看到进离场 */
  bufferSec?: number;
  preferVhhh?: boolean;
  dedupe?: DedupeAdsbOptions;
};

function buildAdsbForUtcWindow(
  audio: AudioData,
  trackRows: MapTrackRow[],
  window: { startSec: number; endSec: number },
  options?: BuildAlignedAdsbOptions
): ADSBData[] {
  const buffer = options?.bufferSec ?? 90;
  const duration = Math.max(1, audio.duration);
  const { startSec, endSec } = window;
  const winStart = startSec - buffer;
  const winEnd = endSec + buffer;

  let inWindow = trackRows.filter((t) => {
    const ts = toUnixSeconds(t.timestamp);
    if (ts < 1_000_000_000) return false;
    return ts >= winStart && ts <= winEnd;
  });

  if (options?.preferVhhh ?? true) {
    const hk = inWindow.filter((t) => isNearVhhh(t.tracks_latitude, t.tracks_longitude));
    if (hk.length >= 2) inWindow = hk;
  }

  return inWindow
    .map((t) => {
      const rawTs = toUnixSeconds(t.timestamp);
      const relTs = rawTs - startSec;
      if (relTs < 0 || relTs > duration) return null;
      return rowToAdsb(t, relTs);
    })
    .filter((p): p is ADSBData => p != null)
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

/**
 * 录音墙钟回放：只保留时段内、且时间跨度足够可插值的航班（去掉「单点钉死」杂机）。
 */
export function filterWallClockPoolForRecordingPlayback(
  livePoints: ADSBData[],
  recordingStartSec: number,
  durationSec: number,
  options?: { bufferSec?: number; minSpanSec?: number; minPoints?: number; alwaysIncludeKeys?: string[] }
): ADSBData[] {
  const buffer = options?.bufferSec ?? 120;
  const minSpan = options?.minSpanSec ?? 2;
  const minPts = options?.minPoints ?? 2;
  const always = new Set(
    (options?.alwaysIncludeKeys ?? []).map((k) => k.toLowerCase()).filter(Boolean)
  );
  const winStart = recordingStartSec - buffer;
  const winEnd = recordingStartSec + Math.max(1, durationSec) + buffer;
  const forceBuffer = Math.max(buffer, 300);

  const inWin = livePoints.filter((p) => {
    const ts = p.timestamp;
    return Number.isFinite(ts) && ts > 1_000_000_000 && ts >= winStart && ts <= winEnd;
  });

  const byFlight = new Map<string, ADSBData[]>();
  for (const p of inWin) {
    const k = p.icao24.toLowerCase();
    const arr = byFlight.get(k) ?? [];
    arr.push(p);
    byFlight.set(k, arr);
  }

  // 主目标 / 选中机：拉取录音时段附近完整 OpenSky 航迹，避免被「单点过滤」删掉
  for (const key of always) {
    const forceStart = recordingStartSec - forceBuffer;
    const forceEnd = recordingStartSec + Math.max(1, durationSec) + forceBuffer;
    for (const p of livePoints) {
      if (!matchesFlightKey(p, key)) continue;
      const ts = p.timestamp;
      if (!Number.isFinite(ts) || ts < forceStart || ts > forceEnd) continue;
      const k = p.icao24.toLowerCase();
      const arr = byFlight.get(k) ?? [];
      if (!arr.some((x) => x.id === p.id && x.timestamp === p.timestamp)) {
        arr.push(p);
        byFlight.set(k, arr);
      }
    }
  }

  const out: ADSBData[] = [];
  for (const [k, arr] of byFlight) {
    const sorted = [...arr].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    const span = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
    const force =
      always.has(k) ||
      [...always].some((key) => sorted.some((p) => matchesFlightKey(p, key)));
    if (!force && (sorted.length < minPts || span < minSpan)) continue;
    out.push(...sorted);
  }
  return out;
}

function scorePlaybackUtcWindow(
  livePoints: ADSBData[],
  window: { startSec: number; endSec: number },
  bufferSec: number,
  primaryKey?: string
): number {
  const duration = Math.max(1, window.endSec - window.startSec);
  const relSamples = [0, 0.15, 0.35, 0.55, 0.75, 1];
  let score = 0;

  for (const frac of relSamples) {
    const wallSec = window.startSec + frac * duration;
    const byFlight = new Map<string, ADSBData[]>();
    for (const p of livePoints) {
      if (p.timestamp < 1_000_000_000) continue;
      const arr = byFlight.get(p.icao24.toLowerCase()) ?? [];
      arr.push(p);
      byFlight.set(p.icao24.toLowerCase(), arr);
    }
    let movable = 0;
    for (const arr of byFlight.values()) {
      if (arr.length < 2) continue;
      const sorted = [...arr].sort((a, b) => a.timestamp - b.timestamp);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (wallSec >= first.timestamp - 120 && wallSec <= last.timestamp + 120) {
        if (wallSec >= first.timestamp && wallSec <= last.timestamp) movable += 2;
        else movable += 1;
      }
    }
    score += movable;
  }

  if (primaryKey) {
    const primaryPts = livePoints
      .filter((p) => matchesFlightKey(p, primaryKey))
      .sort((a, b) => a.timestamp - b.timestamp);
    if (primaryPts.length >= 2) {
      const first = primaryPts[0].timestamp;
      const lag = first - window.startSec;
      if (lag >= 0 && lag <= 90) score += 80;
      else if (lag > 90 && lag <= 180) score += 20;
      else if (lag < 0 && lag >= -30) score += 100;
    }
  }

  return score + countLivePointsInWindow(livePoints, window, bufferSec) * 0.05;
}

function countLivePointsInWindow(
  livePoints: ADSBData[],
  window: { startSec: number; endSec: number },
  bufferSec: number
): number {
  const winStart = window.startSec - bufferSec;
  const winEnd = window.endSec + bufferSec;
  let count = 0;
  for (const p of livePoints) {
    const abs = p.timestamp;
    if (!Number.isFinite(abs) || abs < 1_000_000_000) continue;
    if (abs >= winStart && abs <= winEnd) count++;
  }
  return count;
}

/** 在文件名 / 库内 UTC / ±8h 候选里，选与 OpenSky 墙钟缓存重叠最多的录音起点 */
export function resolveBestRecordingUtcWindow(
  audio: AudioData,
  livePoints: ADSBData[] = [],
  bufferSec = 90,
  primaryKey?: string
): { startSec: number; endSec: number } | null {
  const duration = Math.max(1, audio.duration);
  const fileName = audio.metadata?.fileName ?? "";
  const fromFile = fileName ? parseRecordingUtcRangeFromFileName(fileName, duration) : null;
  const fileWindow = fromFile ? utcWindowFromIso(fromFile.startTimeUtc, fromFile.endTimeUtc, duration) : null;
  const startUtc = audio.metadata?.startTimeUtc;
  const metaWindow = startUtc ? utcWindowFromIso(startUtc, audio.metadata?.endTimeUtc, duration) : null;

  const candidates: { startSec: number; endSec: number }[] = [];
  const seen = new Set<string>();
  const push = (w: { startSec: number; endSec: number } | null) => {
    if (!w) return;
    const key = `${w.startSec}:${w.endSec}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(w);
  };
  push(fileWindow);
  push(metaWindow);
  for (const base of [fileWindow, metaWindow]) {
    if (!base) continue;
    push({ startSec: base.startSec + HKT_UTC_SHIFT_SEC, endSec: base.endSec + HKT_UTC_SHIFT_SEC });
    push({ startSec: base.startSec - HKT_UTC_SHIFT_SEC, endSec: base.endSec - HKT_UTC_SHIFT_SEC });
  }

  if (candidates.length === 0) return null;
  const liveOnly = livePoints.filter((p) => p.live === true || p.timestamp > 1_000_000_000);
  const scorePool = liveOnly.length > 0 ? liveOnly : livePoints;
  if (scorePool.length === 0) return resolveRecordingUtcWindow(audio);

  const pk = primaryKey?.trim().toLowerCase();
  let best = candidates[0];
  let bestScore = scorePlaybackUtcWindow(scorePool, best, bufferSec, pk);
  for (const c of candidates.slice(1)) {
    const score = scorePlaybackUtcWindow(scorePool, c, bufferSec, pk);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (bestScore === 0) return resolveRecordingUtcWindow(audio);
  return best;
}

export function resolveBestRecordingUtcStartSec(
  audio: AudioData,
  livePoints: ADSBData[] = [],
  primaryKey?: string
): number | undefined {
  return resolveBestRecordingUtcWindow(audio, livePoints, 90, primaryKey)?.startSec;
}

function alignLiveWallClockToRecordingWindow(
  audio: AudioData,
  livePoints: ADSBData[],
  window: { startSec: number; endSec: number },
  bufferSec: number
): ADSBData[] {
  const duration = Math.max(1, audio.duration);
  const winStart = window.startSec - bufferSec;
  const winEnd = window.endSec + bufferSec;
  const out: ADSBData[] = [];

  for (const p of livePoints) {
    const abs = p.timestamp;
    if (!Number.isFinite(abs) || abs < 1_000_000_000) continue;
    if (abs < winStart || abs > winEnd) continue;
    const relTs = abs - window.startSec;
    if (relTs < 0 || relTs > duration) continue;
    out.push({
      ...p,
      id: `${p.id}-aligned-${relTs.toFixed(2)}`,
      timestamp: relTs,
      live: false,
    });
  }

  return out.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

/**
 * 将 OpenSky 墙钟航迹（timestamp=Unix 秒）对齐到录音播放条 0…duration。
 * 用于「刚录完 / 实时采集」但 tracks 表 UTC 窗口尚未入库的场景。
 */
export function buildAdsbFromLiveWallClockBuffer(
  audio: AudioData,
  livePoints: ADSBData[],
  options?: { bufferSec?: number }
): ADSBData[] {
  const buffer = options?.bufferSec ?? 90;
  const window = resolveBestRecordingUtcWindow(audio, livePoints, buffer);
  if (!window || livePoints.length === 0) return [];
  return alignLiveWallClockToRecordingWindow(audio, livePoints, window, buffer);
}

/**
 * 按录音 UTC 窗口筛航迹，timestamp 转为相对录音起点 0…duration（与播放条对齐）。
 */
export function buildAdsbAlignedToRecording(
  audio: AudioData,
  trackRows: MapTrackRow[],
  options?: BuildAlignedAdsbOptions
): ADSBData[] {
  const window = resolveRecordingUtcWindow(audio);

  if (!window) {
    const rows = trackRows.filter((t) => isNearVhhh(t.tracks_latitude, t.tracks_longitude));
    const parsedTimes = rows.map((t) => toUnixSeconds(t.timestamp)).filter((x) => Number.isFinite(x) && x > 0);
    const baseTime = parsedTimes.length ? Math.min(...parsedTimes) : 0;
    return rows
      .filter(
        (t) =>
          Number.isFinite(Number(t.tracks_latitude)) &&
          Number.isFinite(Number(t.tracks_longitude))
      )
      .map((t) => {
        const rawTs = toUnixSeconds(t.timestamp);
        const relTs = rawTs > 1_000_000_000 ? Math.max(0, rawTs - baseTime) : rawTs;
        return rowToAdsb(t, relTs);
      });
  }

  let points = buildAdsbForUtcWindow(audio, trackRows, window, options);
  if (points.length === 0) {
    for (const shiftSec of [HKT_UTC_SHIFT_SEC, -HKT_UTC_SHIFT_SEC]) {
      points = buildAdsbForUtcWindow(
        audio,
        trackRows,
        { startSec: window.startSec + shiftSec, endSec: window.endSec + shiftSec },
        options
      );
      if (points.length > 0) break;
    }
  }
  return points;
}

export function finalizeRecordingAdsb(points: ADSBData[]): ADSBData[] {
  return stripSyntheticDetour(enrichVerticalRates(points));
}

/** 用最新 OpenSky 墙钟缓存重算单条录音的对齐航迹（避免初次加载时只有演示机） */
export function rebuildRecordingTimelineFromLive(
  audio: AudioData,
  livePool: ADSBData[]
): ADSBData[] {
  const liveClean = stripSyntheticDetour(livePool).filter((p) => p.live);
  const fromBuffer = buildAdsbFromLiveWallClockBuffer(audio, liveClean, { bufferSec: 120 });
  if (fromBuffer.length > 0) return finalizeRecordingAdsb(fromBuffer);
  return [];
}

/** 无转写呼号匹配时，选时段内点最多的真实航班作为录音主目标 */
export function pickFallbackPrimaryFromLive(
  audio: AudioData,
  livePool: ADSBData[]
): string | undefined {
  const aligned = rebuildRecordingTimelineFromLive(audio, livePool);
  const pool = aligned.length > 0 ? aligned : stripSyntheticDetour(livePool);
  const counts = new Map<string, number>();
  for (const p of pool) {
    if (p.icao24 === DETOUR_ICAO24) continue;
    const k = p.icao24.toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

export function adsbForRecording(
  audio: AudioData,
  adsbByRecordingId: Record<string, ADSBData[]>,
  liveFallback: ADSBData[]
): ADSBData[] {
  const liveClean = stripSyntheticDetour(liveFallback).filter((p) => p.live);
  const aligned = adsbByRecordingId[audio.id];
  if (aligned != null && isRecordingTimelineAligned(audio)) {
    const fromBuffer = rebuildRecordingTimelineFromLive(audio, liveFallback);
    let timeline =
      fromBuffer.length > 0
        ? fromBuffer
        : stripSyntheticDetour(aligned).filter((p) => !p.live);
    const timelineIcaos = new Set(timeline.map((p) => p.icao24.toLowerCase()));
    const liveBg = liveClean.filter((p) => !timelineIcaos.has(p.icao24.toLowerCase()));
    return finalizeRecordingAdsb([...timeline, ...liveBg]);
  }
  if (aligned != null) return finalizeRecordingAdsb(aligned);
  if (isRecordingTimelineAligned(audio)) return finalizeRecordingAdsb(liveClean);
  return finalizeRecordingAdsb(liveFallback);
}
