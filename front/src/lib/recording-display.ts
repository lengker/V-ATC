import type { AudioData } from "@/types";

/** 将 A5 start_time_utc（ISO）格式化为本地墙钟时间，与「当前时间」一致 */
export function formatRecordingCaptureTimeLocal(isoUtc: string | undefined): string {
  if (!isoUtc?.trim()) return "";
  const d = new Date(isoUtc);
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

export function getRecordingDisplayName(recording: AudioData): string {
  const fromUtc = formatRecordingCaptureTimeLocal(recording.metadata?.startTimeUtc);
  if (fromUtc) return fromUtc;
  const fromMeta = recording.metadata?.title?.trim();
  if (fromMeta) return fromMeta;
  const fromFile = formatRecordingFileName(recording.metadata?.fileName ?? "");
  if (fromFile) return fromFile;
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
