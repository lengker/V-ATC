import type { VoiceTimestamp } from "@/types";

const keyFor = (audioId: string) => `alpha.timestamps.override.${audioId}`;
const fullKeyFor = (audioId: string) => `alpha.timestamps.full.${audioId}`;

export function loadTimestampOverrides(audioId: string): Record<string, VoiceTimestamp> {
  try {
    const raw = localStorage.getItem(keyFor(audioId));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, VoiceTimestamp>;
  } catch {
    return {};
  }
}

export function saveTimestampOverride(audioId: string, ts: VoiceTimestamp) {
  const current = loadTimestampOverrides(audioId);
  const next = { ...current, [ts.id]: ts };
  try {
    localStorage.setItem(keyFor(audioId), JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function loadFullTimestamps(audioId: string): VoiceTimestamp[] | null {
  try {
    const raw = localStorage.getItem(fullKeyFor(audioId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VoiceTimestamp[];
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveFullTimestamps(audioId: string, timestamps: VoiceTimestamp[]) {
  try {
    localStorage.setItem(fullKeyFor(audioId), JSON.stringify(timestamps));
  } catch {
    // ignore
  }
}

export function clearTimestampOverrides(audioId: string) {
  try {
    localStorage.removeItem(keyFor(audioId));
  } catch {
    // ignore
  }
}

export function clearFullTimestamps(audioId: string) {
  try {
    localStorage.removeItem(fullKeyFor(audioId));
  } catch {
    // ignore
  }
}

export function exportTimestampOverrides(audioId: string) {
  const overrides = loadTimestampOverrides(audioId);
  return {
    audioId,
    exportedAt: new Date().toISOString(),
    overrides,
  };
}

export function applyTimestampOverrides(
  base: VoiceTimestamp[],
  overrides: Record<string, VoiceTimestamp>
) {
  if (!overrides || Object.keys(overrides).length === 0) return base;
  return base.map((t) => overrides[t.id] ?? t);
}

export function loadTimestampsWithLocalEdits(audioId: string, base: VoiceTimestamp[]) {
  const full = loadFullTimestamps(audioId);
  if (full && full.length > 0) return full;
  const overrides = loadTimestampOverrides(audioId);
  return applyTimestampOverrides(base, overrides);
}
