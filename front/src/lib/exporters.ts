import type { ADSBData, AudioData, VoiceTimestamp } from "@/types";
import type { VhhhStaticLayers } from "@/mock/vhhh-static";

export type ExportPayload = {
  audio: AudioData;
  timestamps: VoiceTimestamp[];
  adsb: ADSBData[];
  staticLayers?: VhhhStaticLayers;
  exportedAt: string;
};

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportAsJson(payload: ExportPayload) {
  const json = JSON.stringify(payload, null, 2);
  downloadBlob(`alpha-export-${Date.now()}.json`, new Blob([json], { type: "application/json;charset=utf-8" }));
}

export function exportTimestampsAsCsv(timestamps: VoiceTimestamp[]) {
  const header = ["id", "startTime", "endTime", "speaker", "confidence", "text"];
  const rows = timestamps.map((t) => [
    t.id,
    t.startTime,
    t.endTime,
    t.speaker ?? "",
    t.confidence ?? "",
    (t.text ?? "").replaceAll('"', '""'),
  ]);
  const csv = [header.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
  downloadBlob(`alpha-timestamps-${Date.now()}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

