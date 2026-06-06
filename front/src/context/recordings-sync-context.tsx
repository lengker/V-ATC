"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { RecordingMeta } from "@/mock/demo-data";
import type { AudioData } from "@/types";

export type TranscriptLoadingState = {
  audioId: string;
  /** 展示在语音剪辑区的说明文字 */
  message: string;
};

export type RecordingsSyncState = {
  recordings: AudioData[];
  recordingMeta: Record<string, RecordingMeta>;
  updatedAt: number | null;
  syncing: boolean;
  /** 拉取 A2 新录音并同步；优先转写当前选中且尚无文本的录音，否则转写下一条待处理 */
  onUpdateOneRecording: () => void;
  /** 按 UTC 时刻下载 LiveATC 历史 30 分钟档 */
  onDownloadHistorical?: (utcIso: string, options: { a3Asr: boolean }) => void | Promise<void>;
  /** 将当前 UTC 时段查询结果合并加载到波形 */
  onMergeUtcRangeLoad?: (options: {
    startUtc: string;
    endUtc: string;
    strategy: "concat" | "single_longest";
    runAsrOnMissing: boolean;
  }) => void | Promise<void>;
  /** 仅对当前选中的录音做 ASR（不拉 A2） */
  onTranscribeSelected: () => void;
  /** 多源融合修正当前录音 UTC 时间戳（文件名/航迹/呼号） */
  onCorrectTimestamp?: () => void | Promise<void>;
  /** 尚无转写的录音条数 */
  pendingTranscriptCount: number;
  /** 当前正在等待/生成语音片段的录音 id */
  transcriptLoading: TranscriptLoadingState | null;
  /** 地图实时 ADS-B 状态 */
  liveAdsbStatus: {
    aircraft: number;
    error?: string;
    updatedAt?: number;
    stale?: boolean;
    lastDataAt?: number;
    /** 地图统计「N 架」的时间窗口（分钟） */
    activeWithinMinutes?: number;
  } | null;
  /** 删除一条录音（A5） */
  onDeleteRecording?: (id: string) => void | Promise<void>;
  deletingRecordingId?: string | null;
  /** 批量导出（JSON + CSV + 音频等） */
  onBatchExport?: (ids: string[]) => void | Promise<void>;
  batchExporting?: boolean;
  batchExportProgress?: { current: number; total: number; audioId?: string } | null;
};

const RecordingsSyncContext = createContext<RecordingsSyncState | null>(null);

export function RecordingsSyncProvider({
  value,
  children,
}: {
  value: RecordingsSyncState;
  children: ReactNode;
}) {
  return (
    <RecordingsSyncContext.Provider value={value}>{children}</RecordingsSyncContext.Provider>
  );
}

export function useRecordingsSync(): RecordingsSyncState {
  const ctx = useContext(RecordingsSyncContext);
  if (!ctx) {
    throw new Error("useRecordingsSync must be used within RecordingsSyncProvider");
  }
  return ctx;
}
