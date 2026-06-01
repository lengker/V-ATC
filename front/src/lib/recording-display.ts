import type { AudioData } from "@/types";

/** 将 A5 start_time_utc（ISO）格式化为本地墙钟时间，与「当前时间」一致 */
export function formatRecordingCaptureTimeLocal(isoUtc: string | undefined): string {
  if (!isoUtc?.trim()) return "";
  let s = isoUtc.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    s = s.includes("T") ? `${s}Z` : `${s.replace(" ", "T")}Z`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 由 A2/A5 的 file_name 生成可读标题 */
export function formatRecordingFileName(fileName: string): string {
  const stem = fileName.replace(/\.(mp3|wav|m4a|ogg|aac)$/i, "").trim();
  if (!stem) return "";

  const vhhhLocal = /^vhhh[_-]?(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})$/i.exec(stem);
  if (vhhhLocal) {
    return `VHHH ${vhhhLocal[1]}-${vhhhLocal[2]}-${vhhhLocal[3]} ${vhhhLocal[4]}:${vhhhLocal[5]}:${vhhhLocal[6]}`;
  }

  const vhhh =
    /^vhhh[_-]?(\d{4})(\d{2})(\d{2})[_-]?[tT]?(\d{2})(\d{2})(\d{2})?/i.exec(stem) ||
    /vhhh[_-]?(\d{8})[tT]?(\d{6})/i.exec(stem);
  if (vhhh) {
    if (vhhh[1].length === 8) {
      const d = vhhh[1];
      const t = (vhhh[2] || "000000").padStart(6, "0");
      return `VHHH ${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
    }
    return `VHHH ${vhhh[1]}-${vhhh[2]}-${vhhh[3]} ${vhhh[4]}:${vhhh[5]}:${(vhhh[6] || "00").padStart(2, "0")}`;
  }

  const embedded = /(\d{4})(\d{2})(\d{2})[tT](\d{2})(\d{2})(\d{2})/.exec(stem);
  if (embedded) {
    const prefix = stem.split(/[_-]/)[0]?.toUpperCase() || "ATC";
    return `${prefix} ${embedded[1]}-${embedded[2]}-${embedded[3]} ${embedded[4]}:${embedded[5]}:${embedded[6]}`;
  }

  const cleaned = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length > 52) return `${cleaned.slice(0, 49)}…`;
  return cleaned;
}

/** 从文件名解析 UTC 采集窗口（用于纠正被「实时更新」误写成当前时刻的记录） */
export function parseRecordingUtcRangeFromFileName(
  fileName: string,
  durationSec: number
): { startTimeUtc: string; endTimeUtc: string } | null {
  const stem = fileName.replace(/\.(mp3|wav|m4a|ogg|aac)$/i, "").trim();
  if (!stem) return null;
  const durMs = Math.max(1000, Math.round(Math.max(1, durationSec) * 1000));

  const toIso = (d: Date) => d.toISOString();

  const vhhhLocal = /^vhhh[_-]?(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})$/i.exec(stem);
  if (vhhhLocal) {
    // 文件名墙钟为香港时间 (UTC+8)，不是 UTC
    const startMs =
      Date.UTC(
        Number(vhhhLocal[1]),
        Number(vhhhLocal[2]) - 1,
        Number(vhhhLocal[3]),
        Number(vhhhLocal[4]),
        Number(vhhhLocal[5]),
        Number(vhhhLocal[6])
      ) -
      8 * 3600 * 1000;
    const start = new Date(startMs);
    if (!Number.isNaN(start.getTime())) {
      return {
        startTimeUtc: toIso(start),
        endTimeUtc: toIso(new Date(start.getTime() + durMs)),
      };
    }
  }

  const embedded = /(\d{4})(\d{2})(\d{2})[tT](\d{2})(\d{2})(\d{2})/.exec(stem);
  if (embedded) {
    const start = new Date(
      Date.UTC(
        Number(embedded[1]),
        Number(embedded[2]) - 1,
        Number(embedded[3]),
        Number(embedded[4]),
        Number(embedded[5]),
        Number(embedded[6])
      )
    );
    if (!Number.isNaN(start.getTime())) {
      return {
        startTimeUtc: toIso(start),
        endTimeUtc: toIso(new Date(start.getTime() + durMs)),
      };
    }
  }

  const liveatc = /(\d{4})-(\d{2})-(\d{2})-(\d{4})Z/i.exec(stem);
  if (liveatc) {
    const hm = liveatc[4];
    const start = new Date(
      Date.UTC(Number(liveatc[1]), Number(liveatc[2]) - 1, Number(liveatc[3]), Number(hm.slice(0, 2)), Number(hm.slice(2, 4)), 0)
    );
    if (!Number.isNaN(start.getTime())) {
      return {
        startTimeUtc: toIso(start),
        endTimeUtc: toIso(new Date(start.getTime() + durMs)),
      };
    }
  }

  return null;
}

export function getRecordingDisplayName(recording: AudioData): string {
  const fromFile = formatRecordingFileName(recording.metadata?.fileName ?? "");
  if (fromFile) return fromFile;
  const fromUtc = formatRecordingCaptureTimeLocal(recording.metadata?.startTimeUtc);
  if (fromUtc) return fromUtc;
  const fromMeta = recording.metadata?.title?.trim();
  if (fromMeta) return fromMeta;
  return `录音 #${recording.id}`;
}

export function recordingSearchHaystack(recording: AudioData): string {
  const parts = [
    recording.id,
    recording.metadata?.fileName,
    recording.metadata?.startTimeUtc,
    recording.metadata?.title,
    getRecordingDisplayName(recording),
    recording.metadata?.icao,
    recording.metadata?.date,
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}
