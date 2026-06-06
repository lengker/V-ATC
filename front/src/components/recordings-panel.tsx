"use client";

import { useEffect, useMemo, useState } from "react";
import { AudioData } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatTime } from "@/lib/utils";
import { Star, Radio, RefreshCw, Trash2, Download, CheckSquare, Square, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RecordingMeta } from "@/mock/demo-data";
import { VirtualList } from "@/components/ui/virtual-list";
import { getRecordingDisplayName } from "@/lib/recording-display";
import { isRecordingTimelineAligned } from "@/lib/recording-adsb-alignment";
import { HistoricalDownloadPanel } from "@/components/historical-download-panel";
import { RecordingUtcRangePanel } from "@/components/recording-utc-range-panel";

export function RecordingsPanel({
  recordings,
  activeId,
  onSelect,
  recordingMeta = {},
  updatedAt = null,
  syncing = false,
  onUpdateOneRecording,
  onDownloadHistorical,
  onMergeUtcRangeLoad,
  onCorrectTimestamp,
  onTranscribeSelected,
  pendingTranscriptCount = 0,
  onDeleteRecording,
  deletingRecordingId = null,
  onBatchExport,
  batchExporting = false,
  batchExportProgress = null,
}: {
  recordings: AudioData[];
  activeId: string;
  onSelect: (id: string) => void;
  recordingMeta?: Record<string, RecordingMeta>;
  updatedAt?: number | null;
  syncing?: boolean;
  onUpdateOneRecording?: () => void;
  onDownloadHistorical?: (utcIso: string, options: { a3Asr: boolean }) => void | Promise<void>;
  onMergeUtcRangeLoad?: (options: {
    startUtc: string;
    endUtc: string;
    strategy: "concat" | "single_longest";
    runAsrOnMissing: boolean;
  }) => void | Promise<void>;
  onTranscribeSelected?: () => void;
  onCorrectTimestamp?: () => void;
  pendingTranscriptCount?: number;
  onDeleteRecording?: (id: string) => void | Promise<void>;
  deletingRecordingId?: string | null;
  /** 批量导出选中录音 */
  onBatchExport?: (ids: string[]) => void | Promise<void>;
  batchExporting?: boolean;
  batchExportProgress?: { current: number; total: number; audioId?: string } | null;
}) {
  /** Cabin / Mine 暂隐藏：需 A2 频道字段或按用户归属标注后再启用 */
  const [tab, setTab] = useState<"Radio" | "Starred">("Radio");
  const [exportSelectedIds, setExportSelectedIds] = useState<Set<string>>(() => new Set());
  const [starredSet, setStarredSet] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("alpha.recordings.starred");
      if (!raw) return new Set();
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set();
    }
  });

  const persistStarred = (next: Set<string>) => {
    try {
      localStorage.setItem("alpha.recordings.starred", JSON.stringify(Array.from(next)));
    } catch {
      // ignore
    }
  };

  const rememberRecent = (id: string) => {
    try {
      const raw = localStorage.getItem("alpha.recordings.recent");
      const recent = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      recent[id] = Date.now();
      localStorage.setItem("alpha.recordings.recent", JSON.stringify(recent));
    } catch {
      // ignore
    }
  };

  const recentMap = useMemo(() => {
    try {
      const raw = localStorage.getItem("alpha.recordings.recent");
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {} as Record<string, number>;
    }
  }, [activeId, recordings.length]);

  const filtered = useMemo(() => {
    let list = recordings;
    if (tab === "Starred") {
      list = list.filter((r) => starredSet.has(r.id));
    } else {
      list = list.filter((r) => recordingMeta[r.id]?.channel !== "Cabin");
    }
    return [...list].sort((a, b) => {
      if (a.id === activeId) return -1;
      if (b.id === activeId) return 1;
      return (recentMap[b.id] ?? 0) - (recentMap[a.id] ?? 0);
    });
  }, [recordings, tab, recordingMeta, starredSet, recentMap, activeId]);

  useEffect(() => {
    if (activeId) rememberRecent(activeId);
  }, [activeId]);

  const toggleStar = (id: string) => {
    const next = new Set(starredSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setStarredSet(next);
    persistStarred(next);
  };

  const toggleExportSelect = (id: string, checked?: boolean) => {
    setExportSelectedIds((prev) => {
      const next = new Set(prev);
      const on = checked ?? !next.has(id);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAllFilteredForExport = () => {
    setExportSelectedIds(new Set(filtered.map((r) => r.id)));
  };

  const clearExportSelection = () => setExportSelectedIds(new Set());

  const runBatchExport = (ids: string[]) => {
    if (!onBatchExport || ids.length === 0) return;
    void onBatchExport(ids);
  };

  const tabs: { id: "Radio" | "Starred"; label: string; icon: typeof Radio }[] = [
    { id: "Radio", label: "Radio", icon: Radio },
    { id: "Starred", label: "Starred", icon: Star },
  ];

  return (
    <Card className="rounded-3xl border-border/70 efb-panel efb-glow overflow-hidden">
      <CardHeader className="border-b border-border/40 bg-gradient-to-br from-background/35 to-transparent pb-2.5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-[7rem] shrink-0">
              <CardTitle className="text-base font-semibold tracking-tight">录音列表</CardTitle>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                共 {recordings.length} 条
                {pendingTranscriptCount > 0 ? ` · ${pendingTranscriptCount} 条无转写` : " · 均已转写"}
                {syncing ? " · 识别中…" : ""}
                {updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString()}` : ""}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-background/50 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/50">
              {filtered.length} 条
              {batchExporting && batchExportProgress
                ? ` · 导出 ${batchExportProgress.current}/${batchExportProgress.total}`
                : exportSelectedIds.size > 0
                  ? ` · 已选 ${exportSelectedIds.size}`
                  : ""}
            </span>
          </div>

          <div
            className="flex gap-1.5 rounded-2xl border border-border/50 bg-muted/15 p-1"
            role="tablist"
            aria-label="录音筛选"
          >
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px] font-medium transition-all sm:text-xs",
                  tab === id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
              disabled={batchExporting || filtered.length === 0 || !onBatchExport}
              onClick={() => runBatchExport(filtered.map((r) => r.id))}
              title="导出当前列表全部录音"
            >
              <Download className={cn("h-3.5 w-3.5", batchExporting && "animate-pulse")} />
              {batchExporting ? "导出中…" : "导出全部"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
              disabled={batchExporting || exportSelectedIds.size === 0 || !onBatchExport}
              onClick={() => runBatchExport([...exportSelectedIds])}
              title="导出勾选的录音"
            >
              <Download className="h-3.5 w-3.5" />
              导出({exportSelectedIds.size})
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
              disabled={batchExporting || filtered.length === 0}
              onClick={selectAllFilteredForExport}
              title="勾选当前列表全部"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              全选
            </Button>
            {exportSelectedIds.size > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 rounded-full px-2 text-[11px]"
                disabled={batchExporting}
                onClick={clearExportSelection}
              >
                <Square className="mr-1 h-3 w-3" />
                清空
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
              disabled={syncing}
              onClick={() => onCorrectTimestamp?.()}
              title="按文件名、航迹、转写呼号融合修正 UTC 时间戳"
            >
              <Clock className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              修正时间
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
              disabled={syncing}
              onClick={() => onTranscribeSelected?.()}
              title="对当前选中的录音做 ASR 转写"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              {syncing ? "转写中…" : "转写"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
              disabled={syncing}
              onClick={() => onUpdateOneRecording?.()}
              title="从 A2 拉取新录音并同步"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              {syncing ? "更新中…" : "更新"}
            </Button>
          </div>
          {onDownloadHistorical ? (
            <HistoricalDownloadPanel busy={syncing} onDownload={onDownloadHistorical} />
          ) : null}
          <RecordingUtcRangePanel
            busy={syncing}
            activeId={activeId}
            onSelectRecording={onSelect}
            onMergeAndLoad={onMergeUtcRangeLoad}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        <VirtualList
          items={filtered}
          className="h-[200px] pr-2"
          gapPx={8}
          overscan={10}
          estimateSizePx={84}
          scrollToIndex={0}
          scrollTrigger={activeId}
          getKey={(r) => r.id}
          empty={
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-background/20 px-4 py-10 text-center text-sm text-muted-foreground">
              <p>暂无录音</p>
              <p className="mt-1 text-xs">切换上方分类或导入更多音频</p>
            </div>
          }
          renderItem={(r) => (
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                rememberRecent(r.id);
                onSelect(r.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  rememberRecent(r.id);
                  onSelect(r.id);
                }
              }}
              className={cn(
                "w-full text-left rounded-xl border p-3 transition-all duration-200",
                r.id === activeId
                  ? "border-primary/80 bg-primary/12 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                  : "border-border/60 bg-background/15 hover:border-border hover:bg-accent/30",
                exportSelectedIds.has(r.id) && "ring-1 ring-primary/35"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={exportSelectedIds.has(r.id)}
                    disabled={batchExporting}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => toggleExportSelect(r.id, e.target.checked)}
                    className="h-4 w-4 shrink-0 rounded border-border"
                    title="加入批量导出"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" title={getRecordingDisplayName(r)}>
                      {getRecordingDisplayName(r)}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">#{r.id}</div>
                  </div>
                  {(r.timestamps?.length ?? 0) > 0 ? (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                      {r.timestamps!.length} 段
                    </span>
                  ) : /^\d+$/.test(r.id) ? (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
                      无转写
                    </span>
                  ) : null}
                  {r.id === activeId ? (
                    <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      当前
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStar(r.id);
                    }}
                    className="text-muted-foreground hover:text-foreground p-0.5"
                    title="收藏"
                  >
                    <Star className={cn("h-4 w-4", starredSet.has(r.id) ? "fill-yellow-400 text-yellow-400" : "")} />
                  </button>
                  {/^\d+$/.test(r.id) && onDeleteRecording ? (
                    <button
                      type="button"
                      disabled={syncing || deletingRecordingId === r.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteRecording(r.id);
                      }}
                      className="text-muted-foreground hover:text-destructive p-0.5 disabled:opacity-40"
                      title="从 A5 删除此录音（含转写）"
                    >
                      <Trash2
                        className={cn(
                          "h-4 w-4",
                          deletingRecordingId === r.id && "animate-pulse text-destructive"
                        )}
                      />
                    </button>
                  ) : null}
                  <div className="text-xs text-muted-foreground tabular-nums">{formatTime(r.duration)}</div>
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground truncate">
                {recordingMeta[r.id]?.channel ?? "Radio"} ·{" "}
                {r.metadata?.icao
                  ? r.metadata.icao
                  : isRecordingTimelineAligned(r)
                    ? "按 UTC 时段回放"
                    : "ICAO -"}{" "}
                · {r.metadata?.frequency ?? "FREQ -"} · {r.metadata?.date ?? "DATE -"}
              </div>
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}

