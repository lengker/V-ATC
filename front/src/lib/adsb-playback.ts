import type { ADSBData } from "@/types";
import {
  buildAdsbTrackIndex,
  type AdsbTrackIndex,
  interpolateAdsbAtTime,
  upperBoundByTime,
} from "@/lib/adsb-interpolation";
import { matchesFlightKey } from "@/lib/recording-adsb-alignment";

export type LivePlaybackOptions = {
  /** 超过最新点后最多外推秒数，避免 OpenSky 停更时飞机一直漂移 */
  maxExtrapolateSec?: number;
  /** 低于该地速（节）视为静止，不外推 */
  minSpeedKtsForDeadReckon?: number;
  /** 录音墙钟回放：不外推截断、尾迹与机位强制对齐 */
  historicalPlayback?: boolean;
};

/** 录音起点早于该航班首点时：沿航向反向外推，避免 0～45s 图标钉死不动 */
function deadReckonExtrapolateBackward(
  first: ADSBData,
  wallSec: number,
  options?: LivePlaybackOptions
): ADSBData {
  const dt = first.timestamp - wallSec;
  if (dt <= 0) return { ...first, timestamp: wallSec };

  const speedKts = Number(first.speed) || 0;
  const minSpeed = options?.minSpeedKtsForDeadReckon ?? 8;
  if (speedKts < minSpeed) {
    return { ...first, timestamp: wallSec };
  }

  const distM = speedKts * 0.514444 * dt;
  const hdgDeg = ((Number(first.heading) || 0) + 180) % 360;
  const hdgRad = (hdgDeg * Math.PI) / 180;
  const R = 6_371_000;
  const latRad = (first.latitude * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const dLat = (distM / R) * Math.cos(hdgRad) * (180 / Math.PI);
  const dLon = cosLat > 1e-6 ? ((distM / R) * Math.sin(hdgRad) / cosLat) * (180 / Math.PI) : 0;

  return {
    ...first,
    id: `${first.icao24}-back-${wallSec.toFixed(1)}`,
    timestamp: wallSec,
    latitude: first.latitude + dLat,
    longitude: first.longitude + dLon,
    heading: Number(first.heading) || 0,
    live: first.live,
  };
}

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

  if (wallSec < first.timestamp) {
    const gap = first.timestamp - wallSec;
    const maxBack = options?.historicalPlayback
      ? (options?.maxExtrapolateSec ?? 900)
      : Math.min(options?.maxExtrapolateSec ?? 120, 180);
    if (options?.historicalPlayback && gap <= maxBack) {
      return deadReckonExtrapolateBackward(first, wallSec, options);
    }
    return { ...first, timestamp: wallSec };
  }

  if (wallSec <= last.timestamp) {
    return interpolateAdsbAtTime(pointsSorted, wallSec, { outside: "clamp" });
  }

  const extrapDt = wallSec - last.timestamp;
  const maxExtrap = options?.historicalPlayback
    ? (options?.maxExtrapolateSec ?? 86400)
    : (options?.maxExtrapolateSec ?? 120);
  if (extrapDt > maxExtrap) {
    return { ...last, timestamp: wallSec };
  }

  return deadReckonExtrapolate(last, wallSec, options);
}

/** 录音与航迹时间关系：墙钟对齐 vs 航迹首点起 1s=1s（仅覆盖录音时长） */
export function recordingPlaybackTrackBounds(
  pointsSorted: ADSBData[],
  recordingUtcStartSec: number,
  recordingDurationSec: number,
  bufferSec = 30
): { startSec: number; endSec: number; useWallClock: boolean } {
  const duration = Math.max(1, recordingDurationSec);
  if (pointsSorted.length === 0) {
    return {
      startSec: recordingUtcStartSec,
      endSec: recordingUtcStartSec + duration,
      useWallClock: true,
    };
  }
  const first = pointsSorted[0];
  const last = pointsSorted[pointsSorted.length - 1];
  if (first.timestamp < 1_000_000_000) {
    return { startSec: 0, endSec: duration, useWallClock: false };
  }

  const recEnd = recordingUtcStartSec + duration;
  const overlapStart = Math.max(first.timestamp, recordingUtcStartSec);
  const overlapEnd = Math.min(last.timestamp, recEnd);
  if (overlapEnd - overlapStart >= 2) {
    return {
      startSec: recordingUtcStartSec - bufferSec,
      endSec: recEnd + bufferSec,
      useWallClock: true,
    };
  }

  const span = Math.max(0, last.timestamp - first.timestamp);
  const playSpan = Math.min(duration, span);
  return {
    startSec: first.timestamp,
    endSec: first.timestamp + playSpan,
    useWallClock: false,
  };
}

/**
 * 录音回放采样时刻：有墙钟重叠用 UTC；否则播放条 1s 对应航迹 1s（只走录音时长，不压缩整段实时航迹）。
 */
export function resolveRecordingSampleSec(
  pointsSorted: ADSBData[],
  relTimeSec: number,
  recordingUtcStartSec: number,
  recordingDurationSec: number
): number {
  if (pointsSorted.length === 0 || !Number.isFinite(relTimeSec)) return relTimeSec;
  const bounds = recordingPlaybackTrackBounds(
    pointsSorted,
    recordingUtcStartSec,
    recordingDurationSec
  );
  if (bounds.useWallClock) {
    return recordingUtcStartSec + relTimeSec;
  }
  const rel = Math.min(
    Math.max(0, relTimeSec),
    Math.max(1, recordingDurationSec),
    bounds.endSec - bounds.startSec
  );
  return bounds.startSec + rel;
}

/** 裁剪航迹池：每机只保留录音回放窗口内的点（避免 1min 录音画出数小时实时航迹） */
export function filterAdsbPoolToRecordingPlayback(
  pool: ADSBData[],
  recordingUtcStartSec: number,
  recordingDurationSec: number
): ADSBData[] {
  if (recordingUtcStartSec < 1_000_000_000 || pool.length === 0) return pool;

  const byFlight = new Map<string, ADSBData[]>();
  for (const p of pool) {
    const k = p.icao24.toLowerCase();
    const arr = byFlight.get(k) ?? [];
    arr.push(p);
    byFlight.set(k, arr);
  }

  const out: ADSBData[] = [];
  for (const arr of byFlight.values()) {
    const sorted = [...arr].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    const { startSec, endSec } = recordingPlaybackTrackBounds(
      sorted,
      recordingUtcStartSec,
      recordingDurationSec
    );
    for (const p of sorted) {
      if (p.timestamp < 1_000_000_000) {
        out.push(p);
        continue;
      }
      if (p.timestamp >= startSec && p.timestamp <= endSec) out.push(p);
    }
  }
  return out;
}

/** 录音 + OpenSky 墙钟航迹：与 resolveRecordingSampleSec 配套的机位采样 */
export function sampleRecordingWallPlayback(
  pointsSorted: ADSBData[],
  relTimeSec: number,
  recordingUtcStartSec: number,
  recordingDurationSec: number,
  options?: LivePlaybackOptions
): ADSBData | null {
  const sampleSec = resolveRecordingSampleSec(
    pointsSorted,
    relTimeSec,
    recordingUtcStartSec,
    recordingDurationSec
  );
  return sampleAircraftAtWallTime(pointsSorted, sampleSec, {
    ...options,
    historicalPlayback: true,
    maxExtrapolateSec: options?.maxExtrapolateSec ?? 900,
  });
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

function trailPointKey(p: [number, number]): string {
  return `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
}

/** 首点 ADS-B 之前：沿反向外推路径采样，尾迹在机身后方向延伸 */
function buildTrailBeforeFirstObserved(
  pointsSorted: ADSBData[],
  wallSec: number,
  options?: LivePlaybackOptions & { playbackStartSec?: number }
): [number, number][] {
  const first = pointsSorted[0];
  const maxBack = options?.maxExtrapolateSec ?? 900;
  const earliest = first.timestamp - maxBack;
  const fromPlayback =
    options?.playbackStartSec != null && options.playbackStartSec > 1_000_000_000
      ? options.playbackStartSec
      : earliest;
  const tMin = Math.max(earliest, fromPlayback);
  const stepSec = 2;
  const latlngs: [number, number][] = [];

  for (let t = tMin; t < wallSec - 1e-3; t += stepSec) {
    const p = deadReckonExtrapolateBackward(first, t, options);
    const ll: [number, number] = [p.latitude, p.longitude];
    const prev = latlngs[latlngs.length - 1];
    if (prev && trailPointKey(prev) === trailPointKey(ll)) continue;
    latlngs.push(ll);
  }

  const tip = deadReckonExtrapolateBackward(first, wallSec, options);
  const tipLl: [number, number] = [tip.latitude, tip.longitude];
  const last = latlngs[latlngs.length - 1];
  if (!last || trailPointKey(last) !== trailPointKey(tipLl)) {
    latlngs.push(tipLl);
  }

  return latlngs.length >= 2 ? latlngs : [];
}

/** 去重后只剩 1 个观测点、播放已超过该时刻：首点 → 当前外推位置 */
function buildTrailAfterSingleObserved(
  pointsSorted: ADSBData[],
  wallSec: number,
  options?: LivePlaybackOptions
): [number, number][] {
  const first = pointsSorted[0];
  if (wallSec <= first.timestamp + 0.05) return [];
  const tip = deadReckonExtrapolate(first, wallSec, options);
  const a: [number, number] = [first.latitude, first.longitude];
  const b: [number, number] = [tip.latitude, tip.longitude];
  if (trailPointKey(a) === trailPointKey(b)) return [];
  return [a, b];
}

/**
 * 尾迹端点：只用已观测到的墙钟时刻插值，不外推到未来/未来首点。
 * 飞机图标仍可用 sampleAircraftAtWallTime 做前后外推。
 */
function sampleTrailTipAtWallTime(
  pointsSorted: ADSBData[],
  wallSec: number,
  historical: boolean
): ADSBData | null {
  if (pointsSorted.length === 0 || !Number.isFinite(wallSec)) return null;
  const first = pointsSorted[0];
  const last = pointsSorted[pointsSorted.length - 1];

  if (historical) {
    if (wallSec < first.timestamp) return null;
    const clampSec = Math.min(wallSec, last.timestamp);
    return interpolateAdsbAtTime(pointsSorted, clampSec, { outside: "clamp" });
  }

  return sampleAircraftAtWallTime(pointsSorted, wallSec, {
    maxExtrapolateSec: 120,
  });
}

export function buildLiveTrailLatLngs(
  pointsSorted: ADSBData[],
  wallSec: number,
  options?: LivePlaybackOptions & {
    maxPoints?: number;
    historicalPlayback?: boolean;
    /** 录音墙钟起点，用于首点 ADS-B 前的尾迹采样 */
    playbackStartSec?: number;
    /** 录音回放终点（墙钟或航迹 1:1 窗口），尾迹不画出窗口外 */
    playbackEndSec?: number;
  }
): [number, number][] {
  if (pointsSorted.length === 0 || !Number.isFinite(wallSec)) return [];

  const historical = Boolean(options?.historicalPlayback);
  const winStart = options?.playbackStartSec;
  const winEnd = options?.playbackEndSec;

  if (
    historical &&
    pointsSorted.length > 0 &&
    wallSec < pointsSorted[0].timestamp &&
    (winStart == null || winStart < 1_000_000_000)
  ) {
    return buildTrailBeforeFirstObserved(pointsSorted, wallSec, options);
  }

  const tip = historical
    ? sampleTrailTipAtWallTime(pointsSorted, wallSec, true)
    : sampleAircraftAtWallTime(pointsSorted, wallSec, options);
  if (!tip) return [];

  let startIdx = 0;
  if (winStart != null && winStart > 1_000_000_000) {
    startIdx = upperBoundByTime(pointsSorted, winStart);
    if (startIdx >= pointsSorted.length) {
      startIdx = Math.max(0, pointsSorted.length - 1);
    }
    const atStart = pointsSorted[startIdx];
    if (startIdx > 0 && atStart && atStart.timestamp > winStart) {
      startIdx = Math.max(0, startIdx - 1);
    }
  }

  let end = upperBoundByTime(pointsSorted, wallSec);
  if (winEnd != null && winEnd > 1_000_000_000) {
    end = Math.min(end, upperBoundByTime(pointsSorted, winEnd));
  }
  end = Math.min(Math.max(0, end), pointsSorted.length);
  startIdx = Math.min(Math.max(0, startIdx), pointsSorted.length);

  const latlngs: [number, number][] = [];
  for (let i = startIdx; i < end; i++) {
    const p = pointsSorted[i];
    if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    latlngs.push([p.latitude, p.longitude]);
  }

  const tipLl: [number, number] = [tip.latitude, tip.longitude];
  const lastHist = end > 0 ? pointsSorted[end - 1] : undefined;
  if (!lastHist || tip.timestamp > lastHist.timestamp + 0.01) {
    latlngs.push(tipLl);
  } else if (latlngs.length > 0) {
    latlngs[latlngs.length - 1] = tipLl;
  } else {
    latlngs.push(tipLl);
  }

  if (latlngs.length < 2 && historical) {
    if (pointsSorted.length === 1) {
      return buildTrailAfterSingleObserved(pointsSorted, wallSec, options);
    }
    if (pointsSorted.length >= 2 && wallSec >= pointsSorted[0].timestamp) {
      const a: [number, number] = [pointsSorted[0].latitude, pointsSorted[0].longitude];
      if (trailPointKey(a) !== trailPointKey(tipLl)) {
        return [a, tipLl];
      }
    }
  }

  if (latlngs.length < 2) return latlngs;

  const maxPts = options?.maxPoints ?? 200;
  let result = latlngs;
  if (result.length > maxPts) {
    const step = Math.ceil(result.length / maxPts);
    const sampled: [number, number][] = [];
    for (let i = 0; i < result.length; i += step) sampled.push(result[i]);
    const tail = result[result.length - 1];
    const lastS = sampled[sampled.length - 1];
    if (!lastS || lastS[0] !== tail[0] || lastS[1] !== tail[1]) sampled.push(tail);
    result = sampled;
  }

  // 历史回放：尾迹末端必须与飞机图标重合，不做 trim 以免线头与机分离
  if (options?.historicalPlayback) {
    const last = result[result.length - 1];
    if (last[0] !== tipLl[0] || last[1] !== tipLl[1]) result.push(tipLl);
    return result;
  }

  return trimTrailBehindTip(result, tipLl);
}

/** 回放尾迹：只保留飞机当前时刻已飞过的点，末端对齐机位（禁止未来航迹出现在机头前） */
export function buildRecordingTrailAtAircraft(
  pointsSorted: ADSBData[],
  aircraft: ADSBData,
  options?: LivePlaybackOptions & {
    maxPoints?: number;
    historicalPlayback?: boolean;
    playbackStartSec?: number;
    playbackEndSec?: number;
  }
): [number, number][] {
  if (!pointsSorted.length || !Number.isFinite(aircraft.timestamp)) return [];

  const sampleSec = aircraft.timestamp;
  const end = upperBoundByTime(pointsSorted, sampleSec);
  const history =
    end > 0 ? pointsSorted.slice(0, end) : pointsSorted.slice(0, 1);

  const latlngs = buildLiveTrailLatLngs(history, sampleSec, options);
  return syncTrailTipToAircraft(latlngs, aircraft);
}

/** 尾迹末端与飞机图标对齐，并截掉折线上位于机头前方的点 */
export function syncTrailTipToAircraft(
  latlngs: [number, number][],
  aircraft: Pick<ADSBData, "latitude" | "longitude">
): [number, number][] {
  if (
    !Number.isFinite(aircraft.latitude) ||
    !Number.isFinite(aircraft.longitude)
  ) {
    return latlngs;
  }
  const tipLl: [number, number] = [aircraft.latitude, aircraft.longitude];
  if (latlngs.length === 0) return [tipLl];
  return trimTrailBehindTip(latlngs, tipLl, 60);
}

/** 实时层：在缓存航迹上按当前墙钟采样，用于标记存在性（位置由 RAF 每帧更新） */
export function queryLivePlaybackPoints(
  index: AdsbTrackIndex,
  wallSec: number,
  options?: LivePlaybackOptions & {
    maxAgeSec?: number;
    historicalPlayback?: boolean;
    /** 主目标等：放宽跨度/时间窗过滤，避免地图上「消失」 */
    forceKeys?: string[];
  }
): ADSBData[] {
  const maxAge = options?.maxAgeSec ?? 25 * 60;
  const historical = options?.historicalPlayback ?? false;
  const maxExtrap = options?.maxExtrapolateSec ?? 120;
  const forceKeys = new Set(
    (options?.forceKeys ?? []).map((k) => k.toLowerCase()).filter(Boolean)
  );
  const out: ADSBData[] = [];

  for (const [, arr] of index.tracks) {
    if (!arr.length) continue;
    const first = arr[0];
    const last = arr[arr.length - 1];
    const force =
      forceKeys.size > 0 &&
      (forceKeys.has(first.icao24.toLowerCase()) ||
        [...forceKeys].some((k) => matchesFlightKey(first, k)));
    if (historical) {
      if (arr.length < 1) continue;
      const span = last.timestamp - first.timestamp;
      if (!force) {
        if (arr.length < 2 && span < 0.01) continue;
        if (arr.length >= 2 && span < 1.5) continue;
      }
      const maxExtrapHist = options?.maxExtrapolateSec ?? 900;
      if (
        !force &&
        (wallSec < first.timestamp - maxExtrapHist || wallSec > last.timestamp + maxExtrapHist)
      ) {
        continue;
      }
      const p = sampleAircraftAtWallTime(arr, wallSec, options);
      if (p) out.push(p);
      continue;
    } else if (wallSec - last.timestamp > maxAge) {
      continue;
    }
    const p = sampleAircraftAtWallTime(arr, wallSec, options);
    if (p) out.push(p);
  }

  return out;
}

export type AuxInfoQueryOptions = {
  /** 地图「实时 OpenSky」：按当前墙钟采样，与地图 RAF 一致 */
  useLiveWallClockNow?: boolean;
  /** 录音时长（秒），用于墙钟无重叠时沿航迹比例回放 */
  recordingDurationSec?: number;
};

/**
 * 辅助信息面板：与地图一致，区分录音时间轴（相对秒）与 OpenSky 实时层（墙钟秒）。
 */
export function getAircraftStateForAuxInfo(
  adsbData: ADSBData[],
  selectedAircraft: string | undefined,
  currentTime: number,
  recordingUtcStartSec?: number,
  options?: AuxInfoQueryOptions
): ADSBData | null {
  if (!selectedAircraft) return null;
  const key = selectedAircraft.toLowerCase();
  const match = (p: ADSBData) =>
    p.icao24.toLowerCase() === key || (p.callsign?.toLowerCase() ?? "") === key;
  const forFlight = adsbData.filter(match);
  if (!forFlight.length) return null;

  const live = forFlight.filter((p) => p.live);
  const timeline = forFlight.filter((p) => !p.live);

  const useLiveNow = options?.useLiveWallClockNow === true;
  const recordingWall =
    !useLiveNow &&
    recordingUtcStartSec != null &&
    recordingUtcStartSec > 1_000_000_000;

  if (useLiveNow && live.length > 0) {
    const index = buildAdsbTrackIndex(live);
    const wallSec = Date.now() / 1000;
    const hit = queryLivePlaybackPoints(index, wallSec, {
      maxExtrapolateSec: 120,
    }).find(match);
    if (hit) return hit;
    for (const arr of index.tracks.values()) {
      if (!arr.some((p) => match(p))) continue;
      const p = sampleAircraftAtWallTime(arr, wallSec, { maxExtrapolateSec: 120 });
      if (p) return p;
    }
    return [...live].sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
  }

  // 录音墙钟回放：优先 OpenSky 全路径；无墙钟重叠时沿航迹比例采样
  if (recordingWall && live.length > 0) {
    const index = buildAdsbTrackIndex(live);
    const duration =
      options?.recordingDurationSec != null && options.recordingDurationSec > 0
        ? options.recordingDurationSec
        : 62;
    for (const arr of index.tracks.values()) {
      if (!arr.some((p) => match(p))) continue;
      const p = sampleRecordingWallPlayback(
        arr,
        currentTime,
        recordingUtcStartSec,
        duration,
        { maxExtrapolateSec: 900 }
      );
      if (p) return p;
    }
  }

  if (timeline.length > 0 && timeline[0].timestamp < 1_000_000_000) {
    const sorted = [...timeline].sort((a, b) => a.timestamp - b.timestamp);
    return interpolateAdsbAtTime(sorted, currentTime, { outside: "clamp" });
  }

  if (live.length > 0) {
    const index = buildAdsbTrackIndex(live);
    const wallSec = recordingWall
      ? recordingUtcStartSec + currentTime
      : Date.now() / 1000;
    const sampled = queryLivePlaybackPoints(index, wallSec, {
      maxExtrapolateSec: 300,
      historicalPlayback: recordingWall,
    });
    const hit = sampled.find(match);
    if (hit) return hit;
    return [...live].sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
  }

  if (timeline.length > 0) {
    const sorted = [...timeline].sort((a, b) => a.timestamp - b.timestamp);
    return sorted[sorted.length - 1] ?? null;
  }

  return null;
}
