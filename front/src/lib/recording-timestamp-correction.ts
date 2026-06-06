/**
 * 录音 UTC 时间戳多源融合修正：文件名先验、库内元数据、历史/实时 ADS-B、转写呼号对齐。
 */
import {
  buildAdsbAlignedToRecording,
  buildAdsbFromLiveWallClockBuffer,
  extractCallsignsFromTimestamps,
  matchesFlightKey,
  resolveBestRecordingUtcWindow,
  resolveRecordingUtcWindow,
  scorePlaybackUtcWindow,
  toUnixSeconds,
  type MapTrackRow,
} from "@/lib/recording-adsb-alignment";
import { parseRecordingUtcRangeFromFileName } from "@/lib/recording-display";
import type { ADSBData, AudioData, VoiceTimestamp } from "@/types";

const HKT_UTC_SHIFT_SEC = 8 * 3600;

export type TimestampCorrectionSource = {
  name: string;
  startSec: number;
  endSec: number;
  score: number;
};

export type TimestampCorrectionResult = {
  startTimeUtc: string;
  endTimeUtc: string;
  startSec: number;
  endSec: number;
  /** 相对库内原 start 的修正量（秒）；正=录音起点应推后 */
  shiftSec: number;
  confidence: number;
  method: "filename" | "adsb_fusion" | "callsign_refine" | "unchanged";
  sources: TimestampCorrectionSource[];
  /** 建议对 relative_start/end 施加的偏移（秒） */
  annotationShiftSec: number;
  details: string;
};

function isoFromSec(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

function windowFromStart(startSec: number, durationSec: number) {
  const d = Math.max(1, durationSec);
  return { startSec, endSec: startSec + d };
}

function pushCandidate(
  list: TimestampCorrectionSource[],
  seen: Set<string>,
  name: string,
  startSec: number,
  durationSec: number,
  score: number
) {
  if (!Number.isFinite(startSec) || startSec < 1_000_000_000) return;
  const endSec = startSec + Math.max(1, durationSec);
  const key = `${startSec}:${endSec}`;
  if (seen.has(key)) return;
  seen.add(key);
  list.push({ name, startSec, endSec, score });
}

function scoreTracksInWindow(
  audio: AudioData,
  trackRows: MapTrackRow[],
  win: { startSec: number; endSec: number },
  livePoints: ADSBData[]
): number {
  const duration = Math.max(1, audio.duration);
  let score = 0;

  const aligned = buildAdsbAlignedToRecording(
    { ...audio, metadata: { ...audio.metadata, startTimeUtc: isoFromSec(win.startSec), endTimeUtc: isoFromSec(win.endSec) } },
    trackRows,
    { bufferSec: 120, preferVhhh: true }
  );
  score += Math.min(aligned.length, 400) * 2;

  const liveOnly = livePoints.filter((p) => p.live === true || p.timestamp > 1_000_000_000);
  if (liveOnly.length > 0) {
    const pk = extractCallsignsFromTimestamps(audio.timestamps ?? [])[0];
    score += scorePlaybackUtcWindow(liveOnly, win, 120, pk);
  }

  const callsigns = extractCallsignsFromTimestamps(audio.timestamps ?? []);
  for (const cs of callsigns) {
    for (const ts of audio.timestamps ?? []) {
      const rel = Number(ts.startTime) || 0;
      const wall = win.startSec + rel;
      const hit = aligned.some(
        (p) => matchesFlightKey(p, cs) && Math.abs(win.startSec + p.timestamp - wall) < 60
      );
      if (hit) score += 25;
    }
  }

  const inWinTracks = trackRows.filter((t) => {
    const ts = toUnixSeconds(t.timestamp);
    return ts >= win.startSec - 120 && ts <= win.endSec + 120;
  });
  score += Math.min(inWinTracks.length, 800) * 0.15;

  return score;
}

/** 用转写中出现的呼号与航迹首现/近邻时刻，估计相对元数据的偏移 */
export function estimateCallsignAnnotationShift(
  audio: AudioData,
  trackRows: MapTrackRow[],
  candidateStartSec: number
): number {
  const deltas: number[] = [];
  const timestamps = audio.timestamps ?? [];
  if (!timestamps.length || !trackRows.length) return 0;

  const byFlight = new Map<string, number[]>();
  for (const t of trackRows) {
    const fid = String(t.flight_id || "").trim().toUpperCase();
    if (!fid || fid === "LIVE") continue;
    const ts = toUnixSeconds(t.timestamp);
    if (ts < 1_000_000_000) continue;
    const arr = byFlight.get(fid) ?? [];
    arr.push(ts);
    byFlight.set(fid, arr);
  }
  for (const arr of byFlight.values()) arr.sort((a, b) => a - b);

  for (const seg of timestamps) {
    const callsigns = extractCallsignsFromTimestamps([seg]);
    if (!callsigns.length) continue;
    const expectedWall = candidateStartSec + (Number(seg.startTime) || 0);
    for (const cs of callsigns) {
      let best: number | null = null;
      let bestDist = Infinity;
      for (const [fid, times] of byFlight) {
        if (!fid.includes(cs) && !cs.includes(fid)) continue;
        for (const abs of times) {
          const d = Math.abs(abs - expectedWall);
          if (d < bestDist && d <= 180) {
            bestDist = d;
            best = abs;
          }
        }
      }
      if (best != null) deltas.push(best - expectedWall);
    }
  }

  if (deltas.length < 2) return 0;
  const sorted = [...deltas].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)]!;
  return Math.abs(mid) > 300 ? 0 : -mid;
}

/**
 * 融合估计最优录音 UTC 起点（及可选转写相对时间微调）。
 */
export function estimateRecordingTimestampCorrection(
  audio: AudioData,
  options?: {
    trackRows?: MapTrackRow[];
    liveAdsb?: ADSBData[];
  }
): TimestampCorrectionResult {
  const duration = Math.max(1, audio.duration);
  const fileName = audio.metadata?.fileName ?? "";
  const trackRows = options?.trackRows ?? [];
  const livePoints = options?.liveAdsb ?? [];

  const prevStart = audio.metadata?.startTimeUtc
    ? toUnixSeconds(audio.metadata.startTimeUtc)
    : 0;
  const prevEnd = audio.metadata?.endTimeUtc
    ? toUnixSeconds(audio.metadata.endTimeUtc)
    : prevStart + duration;

  const fromFile = fileName ? parseRecordingUtcRangeFromFileName(fileName, duration) : null;
  const fileStart = fromFile ? toUnixSeconds(fromFile.startTimeUtc) : 0;

  const candidates: TimestampCorrectionSource[] = [];
  const seen = new Set<string>();

  if (fileStart > 1_000_000_000) {
    pushCandidate(candidates, seen, "filename", fileStart, duration, 1000);
  }

  if (prevStart > 1_000_000_000) {
    pushCandidate(candidates, seen, "database", prevStart, duration, 200);
  }

  const bestLive = resolveBestRecordingUtcWindow(audio, livePoints, 120);
  if (bestLive && bestLive.startSec > 1_000_000_000) {
    pushCandidate(candidates, seen, "adsb_live", bestLive.startSec, duration, 500);
  }

  const resolved = resolveRecordingUtcWindow(audio);
  if (resolved && resolved.startSec > 1_000_000_000) {
    pushCandidate(candidates, seen, "resolve_window", resolved.startSec, duration, 300);
  }

  for (const base of [fileStart, prevStart, bestLive?.startSec, resolved?.startSec]) {
    if (!base || base < 1_000_000_000) continue;
    pushCandidate(candidates, seen, "hkt+8h", base + HKT_UTC_SHIFT_SEC, duration, 150);
    pushCandidate(candidates, seen, "hkt-8h", base - HKT_UTC_SHIFT_SEC, duration, 150);
  }

  if (trackRows.length > 0) {
    for (const c of [...candidates]) {
      const extra = scoreTracksInWindow(audio, trackRows, windowFromStart(c.startSec, duration), livePoints);
      c.score += extra;
    }
  }

  if (candidates.length === 0) {
    const now = Date.now() / 1000;
    return {
      startTimeUtc: isoFromSec(now - duration),
      endTimeUtc: isoFromSec(now),
      startSec: now - duration,
      endSec: now,
      shiftSec: 0,
      confidence: 0,
      method: "unchanged",
      sources: [],
      annotationShiftSec: 0,
      details: "无可用时间先验",
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;
  const second = candidates[1];
  const margin = second ? best.score - second.score : best.score;
  const confidence = Math.min(1, Math.max(0.15, margin / Math.max(best.score, 1)));

  let method: TimestampCorrectionResult["method"] = "adsb_fusion";
  if (best.name === "filename" && best.score >= (second?.score ?? 0) * 0.85) method = "filename";
  if (Math.abs(best.startSec - prevStart) < 2 && prevStart > 0) method = "unchanged";

  const annotationShiftSec = estimateCallsignAnnotationShift(audio, trackRows, best.startSec);

  let refinedStart = best.startSec;
  if (Math.abs(annotationShiftSec) >= 1 && Math.abs(annotationShiftSec) <= 120) {
    refinedStart += annotationShiftSec;
    method = "callsign_refine";
  }

  const shiftSec = prevStart > 0 ? refinedStart - prevStart : 0;

  return {
    startTimeUtc: isoFromSec(refinedStart),
    endTimeUtc: isoFromSec(refinedStart + duration),
    startSec: refinedStart,
    endSec: refinedStart + duration,
    shiftSec,
    confidence,
    method,
    sources: candidates.slice(0, 8),
    annotationShiftSec,
    details: [
      `最优来源 ${best.name}`,
      second ? `次优 ${second.name}（分差 ${margin.toFixed(0)}）` : null,
      Math.abs(annotationShiftSec) >= 0.5
        ? `呼号对齐微调 ${annotationShiftSec.toFixed(1)}s`
        : null,
      Math.abs(shiftSec) >= 1 ? `相对库内修正 ${shiftSec > 0 ? "+" : ""}${shiftSec.toFixed(0)}s` : "与库内一致",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/** 按航迹呼号对齐，微调转写相对时间（不改变文本） */
export function refineAnnotationsWithAdsb(
  timestamps: VoiceTimestamp[],
  audio: AudioData,
  trackRows: MapTrackRow[],
  correctedStartSec: number,
  shiftSec: number
): VoiceTimestamp[] {
  if (!timestamps.length || Math.abs(shiftSec) < 0.5) return timestamps;
  const extra = estimateCallsignAnnotationShift(
    { ...audio, timestamps },
    trackRows,
    correctedStartSec - shiftSec
  );
  const totalShift = shiftSec !== 0 ? shiftSec : extra;
  if (Math.abs(totalShift) < 0.5) return timestamps;

  const duration = Math.max(1, audio.duration);
  return timestamps.map((t) => {
    const start = Math.max(0, Math.min(duration, (Number(t.startTime) || 0) + totalShift));
    const end = Math.max(start + 0.2, Math.min(duration, (Number(t.endTime) || 0) + totalShift));
    return { ...t, startTime: start, endTime: end };
  });
}

export function correctionSummaryZh(result: TimestampCorrectionResult): string {
  const methodLabel: Record<TimestampCorrectionResult["method"], string> = {
    filename: "文件名档位",
    adsb_fusion: "航迹融合",
    callsign_refine: "呼号精细对齐",
    unchanged: "无需修正",
  };
  return `${methodLabel[result.method]} · 置信 ${(result.confidence * 100).toFixed(0)}% · ${result.details}`;
}
