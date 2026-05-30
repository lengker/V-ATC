import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const capped = Math.min(seconds, 86400 * 7);
  const mins = Math.floor(capped / 60);
  const secs = Math.floor(capped % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/** 剪辑时间轴上限：只用录音时长与标注相对时间，勿混入 ADSB Unix 时间戳 */
export function recordingTimelineMax(
  audioDurationSec: number,
  timestamps: { endTime: number }[]
): number {
  const dur = Number.isFinite(audioDurationSec) && audioDurationSec > 0 ? audioDurationSec : 0;
  const ends = timestamps
    .map((t) => t.endTime)
    .filter((t) => Number.isFinite(t) && t >= 0 && t < 86400);
  return Math.max(dur, ...ends, 1);
}

export function parseTime(timeString: string): number {
  const [mins, secs] = timeString.split(":").map(Number);
  return (mins || 0) * 60 + (secs || 0);
}
