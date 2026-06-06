"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Download, Loader2, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  downloadUtcRangeExportPackage,
  fetchUtcRangeTranscript,
  mapAudioRowToAudioData,
  queryRecordingsByUtcRange,
} from "@/lib/backend-api";
import { downloadBlob } from "@/lib/exporters";
import { getRecordingDisplayName } from "@/lib/recording-display";
import { formatUtcInstantChinese, toUtcIsoFromFields } from "@/lib/recording-utc-time";
import { useToast } from "@/hooks/use-toast";
import type { AudioData } from "@/types";

function defaultRangeFields(): {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
} {
  const end = new Date();
  const start = new Date(end.getTime() - 2 * 3600 * 1000);
  const fmt = (d: Date) => ({
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 16),
  });
  const s = fmt(start);
  const e = fmt(end);
  return {
    startDate: s.date,
    startTime: s.time,
    endDate: e.date,
    endTime: e.time,
  };
}

export function RecordingUtcRangePanel({
  busy,
  activeId,
  onSelectRecording,
  onMergeAndLoad,
}: {
  busy?: boolean;
  activeId?: string;
  onSelectRecording?: (id: string) => void;
  onMergeAndLoad?: (options: {
    startUtc: string;
    endUtc: string;
    strategy: "concat" | "single_longest";
    runAsrOnMissing: boolean;
  }) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(defaultRangeFields);
  const [strategy, setStrategy] = useState<"concat" | "single_longest">("concat");
  const [runAsrOnMissing, setRunAsrOnMissing] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [hits, setHits] = useState<AudioData[]>([]);
  const [transcriptPreview, setTranscriptPreview] = useState<string | null>(null);

  const startUtc = useMemo(
    () => toUtcIsoFromFields(fields.startDate, fields.startTime),
    [fields.startDate, fields.startTime]
  );
  const endUtc = useMemo(
    () => toUtcIsoFromFields(fields.endDate, fields.endTime),
    [fields.endDate, fields.endTime]
  );

  const rangeLabel = useMemo(
    () =>
      `${formatUtcInstantChinese(startUtc, 0)} — ${formatUtcInstantChinese(endUtc, 0)}`,
    [startUtc, endUtc]
  );

  const runQuery = async () => {
    setQuerying(true);
    setTranscriptPreview(null);
    try {
      const res = await queryRecordingsByUtcRange(startUtc, endUtc);
      const mapped = res.rows.map(mapAudioRowToAudioData);
      setHits(mapped);
      const tr = await fetchUtcRangeTranscript(startUtc, endUtc);
      setTranscriptPreview(tr.transcript);
      toast({
        title: res.count > 0 ? `命中 ${res.count} 条录音` : "本时段无录音",
        description: rangeLabel,
      });
    } catch (e) {
      setHits([]);
      setTranscriptPreview(null);
      toast({
        title: "查询失败",
        description: e instanceof Error ? e.message : "unknown",
        variant: "destructive",
      });
    } finally {
      setQuerying(false);
    }
  };

  const runMergeLoad = async () => {
    if (!onMergeAndLoad) return;
    setMerging(true);
    try {
      let count = hits.length;
      if (count === 0) {
        const res = await queryRecordingsByUtcRange(startUtc, endUtc);
        const mapped = res.rows.map(mapAudioRowToAudioData);
        setHits(mapped);
        count = res.count;
        const tr = await fetchUtcRangeTranscript(startUtc, endUtc);
        setTranscriptPreview(tr.transcript);
      }
      if (count === 0) {
        toast({ title: "本时段无录音", description: rangeLabel, variant: "destructive" });
        return;
      }
      await onMergeAndLoad({ startUtc, endUtc, strategy, runAsrOnMissing });
    } catch (e) {
      toast({
        title: "合并加载失败",
        description: e instanceof Error ? e.message : "unknown",
        variant: "destructive",
      });
    } finally {
      setMerging(false);
    }
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const { blob, count, hasAudio } = await downloadUtcRangeExportPackage(
        startUtc,
        endUtc,
        strategy
      );
      const safe = startUtc.slice(0, 13).replace(/[:.]/g, "");
      downloadBlob(`utc-range_${safe}.zip`, blob);
      toast({
        title: count > 0 ? "导出完成" : "本时段无录音",
        description: [
          `${count} 条`,
          hasAudio ? "含合并音频" : "音频为空（见 ZIP 内 README）",
          "含 transcript-visual.txt",
        ].join(" · "),
      });
    } catch (e) {
      toast({
        title: "导出失败",
        description: e instanceof Error ? e.message : "unknown",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const disabled = busy || querying || exporting || merging;

  return (
    <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-background/40"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1.5">
          <CalendarRange className="h-3.5 w-3.5" />
          UTC 时段查询 / 合并导出
        </span>
        <span className="text-[10px]">{open ? "收起" : "展开"}</span>
      </button>

      {open ? (
        <div className="mt-2 space-y-2 px-1 pb-1">
          <p className="text-[10px] text-muted-foreground leading-snug">{rangeLabel}</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground mb-0.5 block">起点 UTC 日期</label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={fields.startDate}
                onChange={(e) => setFields((f) => ({ ...f, startDate: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-0.5 block">起点 UTC 时刻</label>
              <Input
                type="time"
                className="h-8 text-xs"
                value={fields.startTime}
                onChange={(e) => setFields((f) => ({ ...f, startTime: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-0.5 block">终点 UTC 日期</label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={fields.endDate}
                onChange={(e) => setFields((f) => ({ ...f, endDate: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-0.5 block">终点 UTC 时刻</label>
              <Input
                type="time"
                className="h-8 text-xs"
                value={fields.endTime}
                onChange={(e) => setFields((f) => ({ ...f, endTime: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">合并策略</label>
            <select
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as "concat" | "single_longest")}
              disabled={disabled}
            >
              <option value="concat">顺序拼接（需 ffmpeg）</option>
              <option value="single_longest">单条最长重叠</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border"
              checked={runAsrOnMissing}
              onChange={(e) => setRunAsrOnMissing(e.target.checked)}
              disabled={disabled}
            />
            合并前对无转写段执行 ASR（较慢）
          </label>

          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
              disabled={disabled}
              onClick={() => void runQuery()}
            >
              {querying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              查询
            </Button>
            {onMergeAndLoad ? (
              <Button
                type="button"
                size="sm"
                variant="default"
                className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
                disabled={disabled}
                onClick={() => void runMergeLoad()}
              >
                {merging ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                合并并加载
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
              disabled={disabled}
              onClick={() => void runExport()}
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              导出 ZIP
            </Button>
          </div>

          {hits.length > 0 ? (
            <ul className="max-h-28 overflow-y-auto rounded-xl border border-border/50 bg-background/30 p-1 space-y-1">
              {hits.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-[10px] hover:bg-accent/40 ${
                      r.id === activeId ? "bg-primary/10 ring-1 ring-primary/30" : ""
                    }`}
                    onClick={() => onSelectRecording?.(r.id)}
                  >
                    <span className="font-medium">{getRecordingDisplayName(r)}</span>
                    <span className="text-muted-foreground"> · #{r.id}</span>
                    {(r.timestamps?.length ?? 0) === 0 ? (
                      <span className="text-amber-600 dark:text-amber-300"> · 无转写</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : transcriptPreview ? (
            <p className="text-[10px] text-muted-foreground">查询完成：本时段无录音</p>
          ) : null}

          {transcriptPreview && hits.length > 0 ? (
            <pre className="max-h-24 overflow-y-auto rounded-xl border border-border/40 bg-background/20 p-2 text-[9px] text-muted-foreground whitespace-pre-wrap">
              {transcriptPreview.slice(0, 1200)}
              {transcriptPreview.length > 1200 ? "\n…" : ""}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
