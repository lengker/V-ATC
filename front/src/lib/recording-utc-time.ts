/** UTC 墙钟解析与中文格式化（波形/查询/导出共用） */

export function parseUtcToMs(isoUtc: string | undefined): number | null {
  if (!isoUtc?.trim()) return null;
  let s = isoUtc.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    s = s.includes("T") ? `${s}Z` : `${s.replace(" ", "T")}Z`;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/** 2026年06月03日00时30分15秒（UTC） */
export function formatUtcInstantChinese(isoUtc: string | undefined, offsetSec = 0): string {
  const base = parseUtcToMs(isoUtc);
  if (base == null) return "--";
  const d = new Date(base + offsetSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}年${pad(d.getUTCMonth() + 1)}月${pad(d.getUTCDate())}日${pad(d.getUTCHours())}时${pad(d.getUTCMinutes())}分${pad(d.getUTCSeconds())}秒`;
}

export function formatUtcRangeChinese(
  startIso: string | undefined,
  endIso: string | undefined
): string {
  const a = formatUtcInstantChinese(startIso, 0);
  const b = formatUtcInstantChinese(endIso, 0);
  if (a === "--" && b === "--") return "--";
  if (a === "--") return b;
  if (b === "--") return a;
  return `${a} — ${b}`;
}

/** 播放头相对秒 → UTC ISO */
export function wallClockIsoFromCaptureStart(
  captureStartUtc: string | undefined,
  offsetSec: number
): string | undefined {
  const base = parseUtcToMs(captureStartUtc);
  if (base == null) return undefined;
  return new Date(base + offsetSec * 1000).toISOString();
}

export function toUtcIsoFromFields(date: string, time: string): string {
  const t = time.length === 5 ? `${time}:00` : time;
  return `${date}T${t}.000Z`;
}
