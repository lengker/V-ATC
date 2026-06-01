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

function exportBaseName(audioId: string) {
  return `alpha-${audioId}-${Date.now()}`;
}

export function exportAsJson(payload: ExportPayload, filename?: string) {
  const json = JSON.stringify(payload, null, 2);
  downloadBlob(
    filename ?? `${exportBaseName(payload.audio.id)}.json`,
    new Blob([json], { type: "application/json;charset=utf-8" })
  );
}

export function exportTimestampsAsCsv(
  timestamps: VoiceTimestamp[],
  filename?: string,
  audioId?: string
) {
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
  downloadBlob(
    filename ?? `${exportBaseName(audioId ?? "timestamps")}-annotations.csv`,
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );
}

export function exportAdsbAsCsv(adsb: ADSBData[], filename?: string, audioId?: string) {
  const header = [
    "id",
    "timestamp",
    "icao24",
    "callsign",
    "latitude",
    "longitude",
    "altitude",
    "speed",
    "heading",
    "verticalRate",
  ];
  const rows = adsb.map((p) => [
    p.id,
    p.timestamp,
    p.icao24,
    p.callsign ?? "",
    p.latitude,
    p.longitude,
    p.altitude,
    p.speed,
    p.heading,
    p.verticalRate ?? "",
  ]);
  const csv = [header.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
  downloadBlob(
    filename ?? `${exportBaseName(audioId ?? "adsb")}-adsb.csv`,
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );
}

function audioExtensionFromUrl(url: string): string {
  const m = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
  return m?.[1]?.toLowerCase() || "audio";
}

/** 下载原始音频文件 */
export async function exportAudioFile(
  url: string,
  filename?: string
): Promise<void> {
  if (!url?.trim()) throw new Error("无音频 URL");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`音频下载失败 (${res.status})`);
  const blob = await res.blob();
  const ext = audioExtensionFromUrl(url);
  downloadBlob(filename ?? `recording.${ext}`, blob);
}

export type ExportPackageResult = {
  json: boolean;
  csv: boolean;
  adsbCsv: boolean;
  audio: boolean;
  errors: string[];
};

/** 导出标注 JSON + 转写 CSV + ADSB CSV + 原始音频 */
export async function exportAnnotationPackage(
  payload: ExportPayload
): Promise<ExportPackageResult> {
  const base = exportBaseName(payload.audio.id);
  const result: ExportPackageResult = {
    json: false,
    csv: false,
    adsbCsv: false,
    audio: false,
    errors: [],
  };

  try {
    exportAsJson(payload, `${base}.json`);
    result.json = true;
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "JSON 导出失败");
  }

  try {
    exportTimestampsAsCsv(payload.timestamps, `${base}-annotations.csv`, payload.audio.id);
    result.csv = true;
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "CSV 导出失败");
  }

  if (payload.adsb.length > 0) {
    try {
      exportAdsbAsCsv(payload.adsb, `${base}-adsb.csv`, payload.audio.id);
      result.adsbCsv = true;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : "ADSB CSV 导出失败");
    }
  }

  if (payload.audio.url) {
    try {
      const ext = audioExtensionFromUrl(payload.audio.url);
      await exportAudioFile(payload.audio.url, `${base}-audio.${ext}`);
      result.audio = true;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : "音频导出失败");
    }
  } else {
    result.errors.push("当前录音无音频 URL，已跳过音频文件");
  }

  return result;
}
