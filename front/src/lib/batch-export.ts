import type { ExportPayload } from "@/lib/exporters";
import {
  downloadBlob,
  exportAdsbAsCsv,
  exportAsJson,
  exportAudioFile,
  exportTimestampsAsCsv,
} from "@/lib/exporters";
import type { VoiceTimestamp } from "@/types";

export type BatchExportProgress = {
  index: number;
  total: number;
  audioId: string;
  phase: "json" | "csv" | "adsb" | "audio" | "done";
};

export type BatchExportResult = {
  batchId: string;
  total: number;
  exported: number;
  skipped: string[];
  errors: string[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function batchFilePrefix(batchId: string, audioId: string) {
  return `alpha-batch-${batchId}_${audioId}`;
}

/** 合并多录音转写为单 CSV（含 audioId 列） */
export function buildCombinedAnnotationsCsv(
  items: Array<{ audioId: string; timestamps: VoiceTimestamp[] }>
): string {
  const header = [
    "audioId",
    "id",
    "startTime",
    "endTime",
    "speaker",
    "confidence",
    "text",
  ];
  const rows: string[][] = [];
  for (const { audioId, timestamps } of items) {
    for (const t of timestamps) {
      rows.push([
        audioId,
        t.id,
        String(t.startTime),
        String(t.endTime),
        t.speaker ?? "",
        t.confidence != null ? String(t.confidence) : "",
        (t.text ?? "").replaceAll('"', '""'),
      ]);
    }
  }
  return [
    header.join(","),
    ...rows.map((r) => r.map((c) => `"${c}"`).join(",")),
  ].join("\n");
}

export type BatchExportOptions = {
  includeAudio?: boolean;
  includeAdsb?: boolean;
  /** 每条录音各文件之间的间隔，避免浏览器拦截连续下载 */
  delayMs?: number;
  onProgress?: (p: BatchExportProgress) => void;
};

/** 批量导出：汇总 manifest + 合并 CSV + 每条录音独立 JSON/CSV/ADSB/音频 */
export async function exportBatchAnnotationPackages(
  items: ExportPayload[],
  options?: BatchExportOptions
): Promise<BatchExportResult> {
  const batchId = String(Date.now());
  const delayMs = options?.delayMs ?? 350;
  const includeAudio = options?.includeAudio !== false;
  const includeAdsb = options?.includeAdsb !== false;
  const result: BatchExportResult = {
    batchId,
    total: items.length,
    exported: 0,
    skipped: [],
    errors: [],
  };

  if (items.length === 0) {
    result.errors.push("没有可导出的录音");
    return result;
  }

  const manifest = {
    batchId,
    exportedAt: new Date().toISOString(),
    count: items.length,
    recordings: items.map((p) => ({
      id: p.audio.id,
      title: p.audio.metadata?.title ?? p.audio.metadata?.fileName ?? p.audio.id,
      durationSec: p.audio.duration,
      url: p.audio.url,
      segmentCount: p.timestamps.length,
      adsbPointCount: p.adsb.length,
    })),
  };

  try {
    downloadBlob(
      `alpha-batch-${batchId}-manifest.json`,
      new Blob([JSON.stringify(manifest, null, 2)], {
        type: "application/json;charset=utf-8",
      })
    );
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "manifest 导出失败");
  }

  try {
    const combined = buildCombinedAnnotationsCsv(
      items.map((p) => ({ audioId: p.audio.id, timestamps: p.timestamps }))
    );
    downloadBlob(
      `alpha-batch-${batchId}-all-annotations.csv`,
      new Blob([combined], { type: "text/csv;charset=utf-8" })
    );
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "合并 CSV 导出失败");
  }

  await sleep(delayMs);

  for (let i = 0; i < items.length; i++) {
    const payload = items[i];
    const audioId = payload.audio.id;
    const prefix = batchFilePrefix(batchId, audioId);

    options?.onProgress?.({
      index: i + 1,
      total: items.length,
      audioId,
      phase: "json",
    });

    try {
      exportAsJson(payload, `${prefix}.json`);
    } catch (e) {
      result.errors.push(`${audioId}: JSON — ${e instanceof Error ? e.message : "失败"}`);
    }

    await sleep(delayMs);

    options?.onProgress?.({
      index: i + 1,
      total: items.length,
      audioId,
      phase: "csv",
    });

    try {
      exportTimestampsAsCsv(payload.timestamps, `${prefix}-annotations.csv`, audioId);
    } catch (e) {
      result.errors.push(`${audioId}: CSV — ${e instanceof Error ? e.message : "失败"}`);
    }

    if (includeAdsb && payload.adsb.length > 0) {
      await sleep(delayMs);
      options?.onProgress?.({
        index: i + 1,
        total: items.length,
        audioId,
        phase: "adsb",
      });
      try {
        exportAdsbAsCsv(payload.adsb, `${prefix}-adsb.csv`, audioId);
      } catch (e) {
        result.errors.push(`${audioId}: ADSB — ${e instanceof Error ? e.message : "失败"}`);
      }
    }

    if (includeAudio) {
      await sleep(delayMs);
      options?.onProgress?.({
        index: i + 1,
        total: items.length,
        audioId,
        phase: "audio",
      });
      if (payload.audio.url) {
        try {
          const ext =
            payload.audio.url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1]?.toLowerCase() ||
            "audio";
          await exportAudioFile(payload.audio.url, `${prefix}-audio.${ext}`);
        } catch (e) {
          result.errors.push(`${audioId}: 音频 — ${e instanceof Error ? e.message : "失败"}`);
        }
      } else {
        result.skipped.push(`${audioId}（无音频 URL）`);
      }
    }

    result.exported += 1;
    options?.onProgress?.({
      index: i + 1,
      total: items.length,
      audioId,
      phase: "done",
    });

    if (i < items.length - 1) await sleep(delayMs);
  }

  return result;
}
