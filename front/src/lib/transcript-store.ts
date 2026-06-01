import type { VoiceTimestamp } from "@/types";
import {
  loadFullTimestamps,
  saveFullTimestamps,
} from "@/lib/local-annotation-store";

export type TranscriptTimeQuery = {
  /** 区间起点（秒，含） */
  startSec?: number;
  /** 区间终点（秒，含） */
  endSec?: number;
  /** 查询某一时刻所在的片段 */
  atTimeSec?: number;
  /** 文本关键词（大小写不敏感） */
  text?: string;
};

/** 片段时间与 [start, end] 有交集 */
export function segmentOverlapsRange(
  seg: VoiceTimestamp,
  startSec: number,
  endSec: number
): boolean {
  const lo = Math.min(startSec, endSec);
  const hi = Math.max(startSec, endSec);
  return seg.endTime >= lo && seg.startTime <= hi;
}

/** 播放头时刻落在片段内 */
export function segmentContainsTime(seg: VoiceTimestamp, timeSec: number): boolean {
  return timeSec >= seg.startTime && timeSec <= seg.endTime;
}

/** 按时间与文本查询语音片段（内存 / 已加载列表） */
export function queryTranscriptSegments(
  segments: VoiceTimestamp[],
  query: TranscriptTimeQuery
): VoiceTimestamp[] {
  let out = [...segments];

  if (query.atTimeSec != null && Number.isFinite(query.atTimeSec)) {
    out = out.filter((s) => segmentContainsTime(s, query.atTimeSec!));
  } else if (
    query.startSec != null &&
    query.endSec != null &&
    Number.isFinite(query.startSec) &&
    Number.isFinite(query.endSec)
  ) {
    out = out.filter((s) =>
      segmentOverlapsRange(s, query.startSec!, query.endSec!)
    );
  } else if (query.startSec != null && Number.isFinite(query.startSec)) {
    out = out.filter((s) => s.endTime >= query.startSec!);
  } else if (query.endSec != null && Number.isFinite(query.endSec)) {
    out = out.filter((s) => s.startTime <= query.endSec!);
  }

  const kw = query.text?.trim().toLowerCase();
  if (kw) {
    out = out.filter(
      (s) =>
        (s.text ?? "").toLowerCase().includes(kw) ||
        (s.speaker ?? "").toLowerCase().includes(kw) ||
        s.id.toLowerCase().includes(kw)
    );
  }

  return out.sort((a, b) => a.startTime - b.startTime);
}

/** 持久化整段转写（localStorage） */
export function storeTranscriptSegments(
  audioId: string,
  segments: VoiceTimestamp[]
): void {
  saveFullTimestamps(audioId, segments);
}

/** 读取已存储转写 */
export function loadStoredTranscriptSegments(
  audioId: string
): VoiceTimestamp[] | null {
  return loadFullTimestamps(audioId);
}

/** 解析查询框时间：支持 mm:ss 或纯秒数 */
export function parseQueryTimeInput(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (t.includes(":")) {
    const [m, s] = t.split(":").map((x) => Number(x.trim()));
    if (!Number.isFinite(m) && !Number.isFinite(s)) return undefined;
    return (m || 0) * 60 + (s || 0);
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
