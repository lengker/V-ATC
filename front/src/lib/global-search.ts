import type { AudioData } from "@/types";
import { getRecordingDisplayName, recordingSearchHaystack } from "@/lib/recording-display";

/** 顶栏搜索：优先录音 ID / 标题精确匹配 */
export function pickRecordingBySearchQuery(
  query: string,
  recordings: AudioData[]
): AudioData | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;

  const exactId = recordings.find((r) => r.id.toLowerCase() === q);
  if (exactId) return exactId;

  const exactTitle = recordings.find(
    (r) =>
      getRecordingDisplayName(r).toLowerCase() === q ||
      (r.metadata?.fileName ?? "").toLowerCase() === q
  );
  if (exactTitle) return exactTitle;

  if (/^\d+$/.test(q)) {
    return recordings.find((r) => r.id.toLowerCase() === q);
  }

  const byHaystack = recordings.filter((r) => recordingSearchHaystack(r).includes(q));
  if (byHaystack.length === 1) return byHaystack[0];
  if (byHaystack.length > 1) {
    const exact = byHaystack.find(
      (r) =>
        getRecordingDisplayName(r).toLowerCase() === q ||
        (r.metadata?.fileName ?? "").toLowerCase() === q
    );
    if (exact) return exact;
    return [...byHaystack].sort((a, b) => a.id.length - b.id.length)[0];
  }

  const byIdPartial = recordings.filter((r) => r.id.toLowerCase().includes(q));
  if (byIdPartial.length === 1) return byIdPartial[0];

  return recordings.find((r) => (r.metadata?.icao ?? "").toLowerCase() === q);
}
