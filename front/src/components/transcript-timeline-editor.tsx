"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VoiceTimestamp } from "@/types";
import { cn, formatTime, recordingTimelineMax } from "@/lib/utils";
import {
  parseQueryTimeInput,
  queryTranscriptSegments,
  type TranscriptTimeQuery,
} from "@/lib/transcript-store";
import { useRecordingsSync } from "@/context/recordings-sync-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  Clapperboard,
  Combine,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Search,
  Download,
  X,
} from "lucide-react";

const MIN_SEGMENT_SECONDS = 0.05;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function safeUuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `ts_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function normalizeSegments(items: VoiceTimestamp[]) {
  return [...items].sort((a, b) => a.startTime - b.startTime);
}

function TranscriptGeneratingPanel({ message }: { message: string }) {
  return (
    <div className="flex min-h-[min(520px,55vh)] flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/25">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
      <div className="max-w-md space-y-2">
        <p className="text-base font-medium text-foreground">{message}</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          首次识别约需 30 秒～2 分钟，完成后将自动显示语音片段与时间轴。
        </p>
      </div>
      <div className="flex w-full max-w-lg gap-2 px-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-1.5 flex-1 animate-pulse rounded-full bg-primary/30"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function TranscriptTimelineEditor({
  value,
  currentTime,
  timelineMax,
  onChange,
  onSeek,
  onSegmentFocus,
  className,
  isGenerating = false,
  generatingMessage = "正在识别语音片段…",
}: {
  value: VoiceTimestamp[];
  currentTime: number;
  timelineMax: number;
  onChange: (next: VoiceTimestamp[]) => void;
  onSeek?: (t: number) => void;
  /** 用户点选某一段转写时通知父组件（供千问智能体「应用建议」等） */
  onSegmentFocus?: (segment: VoiceTimestamp) => void;
  className?: string;
  isGenerating?: boolean;
  generatingMessage?: string;
}) {
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [queryStart, setQueryStart] = useState("");
  const [queryEnd, setQueryEnd] = useState("");
  const [queryText, setQueryText] = useState("");
  const [queryAtPlayhead, setQueryAtPlayhead] = useState(false);
  const [queryActive, setQueryActive] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const segmentListRef = useRef<HTMLDivElement>(null);
  const lastFollowedActiveIdRef = useRef<string | null>(null);
  const dragRef = useRef<{
    id: string;
    kind: "resize" | "move" | "playhead";
    side?: "start" | "end";
    startX: number;
    baseStart: number;
    baseEnd: number;
  } | null>(null);

  const { onTranscribeSelected, syncing, pendingTranscriptCount } = useRecordingsSync();
  const sorted = useMemo(() => normalizeSegments(value), [value]);
  const effectiveMax = recordingTimelineMax(timelineMax || 0, sorted);

  const runTimeQuery = useCallback(() => {
    setQueryActive(true);
  }, []);

  const clearTimeQuery = useCallback(() => {
    setQueryStart("");
    setQueryEnd("");
    setQueryText("");
    setQueryAtPlayhead(false);
    setQueryActive(false);
  }, []);

  const timeQuery = useMemo((): TranscriptTimeQuery => {
    const q: TranscriptTimeQuery = {};
    if (queryText.trim()) q.text = queryText.trim();
    if (queryAtPlayhead) {
      q.atTimeSec = currentTime;
      return q;
    }
    const start = parseQueryTimeInput(queryStart);
    const end = parseQueryTimeInput(queryEnd);
    if (start != null) q.startSec = start;
    if (end != null) q.endSec = end;
    return q;
  }, [currentTime, queryAtPlayhead, queryEnd, queryStart, queryText]);

  const filtered = useMemo(() => {
    if (!queryActive) return sorted;
    return queryTranscriptSegments(sorted, timeQuery);
  }, [queryActive, sorted, timeQuery]);

  const selectedList = useMemo(() => filtered.filter((t) => selectedIds.has(t.id)), [filtered, selectedIds]);
  const active = useMemo(
    () => sorted.find((t) => currentTime >= t.startTime && currentTime <= t.endTime) ?? null,
    [sorted, currentTime]
  );

  /** 播放时自动滚动，使当前语音片段保持在可见区域 */
  useEffect(() => {
    if (!active?.id || editMode || dragRef.current) return;
    if (lastFollowedActiveIdRef.current === active.id) return;
    lastFollowedActiveIdRef.current = active.id;

    requestAnimationFrame(() => {
      const row = segmentListRef.current?.querySelector<HTMLElement>(
        `[data-segment-id="${CSS.escape(active.id)}"]`
      );
      if (!row) return;
      const viewport = row.closest("[data-radix-scroll-area-viewport]") as HTMLElement | null;
      if (!viewport) {
        row.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
      const rowRect = row.getBoundingClientRect();
      const viewRect = viewport.getBoundingClientRect();
      const padding = 16;
      if (rowRect.top < viewRect.top + padding) {
        viewport.scrollTop += rowRect.top - viewRect.top - padding;
      } else if (rowRect.bottom > viewRect.bottom - padding) {
        viewport.scrollTop += rowRect.bottom - viewRect.bottom + padding;
      }
    });
  }, [active?.id, editMode]);

  useEffect(() => {
    if (!active?.id) lastFollowedActiveIdRef.current = null;
  }, [sorted.length, active?.id]);

  const emit = useCallback((next: VoiceTimestamp[]) => onChange(normalizeSegments(next)), [onChange]);

  const selectOnly = useCallback(
    (id: string) => {
      setSelectedIds(new Set([id]));
      const seg = sorted.find((t) => t.id === id);
      if (seg) onSegmentFocus?.(seg);
    },
    [onSegmentFocus, sorted]
  );

  const toggleSelect = useCallback((id: string, checked?: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldSelect = checked ?? !next.has(id);
      if (shouldSelect) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const updateOne = useCallback(
    (id: string, patch: Partial<VoiceTimestamp>) => {
      if (!editMode) return;
      emit(sorted.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    },
    [editMode, emit, sorted]
  );

  const nudge = useCallback(
    (id: string, which: "startTime" | "endTime", delta: number) => {
      const ts = sorted.find((t) => t.id === id);
      if (!ts) return;
      if (which === "startTime") {
        updateOne(id, { startTime: clamp(ts.startTime + delta, 0, ts.endTime - MIN_SEGMENT_SECONDS) });
      } else {
        updateOne(id, { endTime: clamp(ts.endTime + delta, ts.startTime + MIN_SEGMENT_SECONDS, effectiveMax) });
      }
    },
    [effectiveMax, sorted, updateOne]
  );

  const splitSegment = useCallback(
    (target: VoiceTimestamp, atTime: number) => {
      if (!editMode) return;
      const t = clamp(atTime, target.startTime + MIN_SEGMENT_SECONDS, target.endTime - MIN_SEGMENT_SECONDS);
      if (t <= target.startTime || t >= target.endTime) return;

      const first: VoiceTimestamp = { ...target, endTime: t };
      const second: VoiceTimestamp = {
        ...target,
        id: safeUuid(),
        startTime: t,
        text: "",
        confidence: undefined,
      };

      emit(sorted.flatMap((item) => (item.id === target.id ? [first, second] : [item])));
      setSelectedIds(new Set([first.id, second.id]));
    },
    [editMode, emit, sorted]
  );

  const doSplitAtPlayhead = useCallback(() => {
    if (active) splitSegment(active, currentTime);
  }, [active, currentTime, splitSegment]);

  const doMerge = useCallback(() => {
    if (!editMode || selectedList.length < 2) return;
    const list = normalizeSegments(selectedList);

    const merged: VoiceTimestamp = {
      id: safeUuid(),
      startTime: Math.min(...list.map((t) => t.startTime)),
      endTime: Math.max(...list.map((t) => t.endTime)),
      text: list.map((t) => t.text.trim()).filter(Boolean).join("\n"),
      speaker: list.map((t) => t.speaker).find(Boolean),
      confidence: undefined,
    };
    const removeSet = new Set(list.map((t) => t.id));
    const next = sorted.filter((t) => !removeSet.has(t.id));
    const insertAt = Math.max(0, sorted.findIndex((t) => t.id === list[0].id));
    next.splice(insertAt, 0, merged);
    emit(next);
    setSelectedIds(new Set([merged.id]));
  }, [editMode, emit, selectedList, sorted]);

  const doDelete = useCallback(() => {
    if (!editMode || selectedIds.size === 0) return;
    emit(sorted.filter((t) => !selectedIds.has(t.id)));
    setSelectedIds(new Set());
  }, [editMode, emit, selectedIds, sorted]);

  const addFirstSegment = useCallback(() => {
    const len = Math.max(MIN_SEGMENT_SECONDS * 4, Math.min(effectiveMax, 30));
    const seg: VoiceTimestamp = {
      id: safeUuid(),
      startTime: 0,
      endTime: len,
      text: "",
    };
    emit([...sorted, seg]);
    setEditMode(true);
    setSelectedIds(new Set([seg.id]));
    onSeek?.(0);
  }, [effectiveMax, emit, onSeek, sorted]);

  const seekByClientX = useCallback(
    (clientX: number) => {
      const el = timelineRef.current;
      if (!el || !onSeek) return;
      const rect = el.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, rect.width);
      onSeek((x / Math.max(1, rect.width)) * effectiveMax);
    },
    [effectiveMax, onSeek]
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string, side: "start" | "end") => {
      if (!editMode) return;
      const ts = sorted.find((t) => t.id === id);
      if (!ts) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { id, kind: "resize", side, startX: e.clientX, baseStart: ts.startTime, baseEnd: ts.endTime };
      selectOnly(id);
    },
    [editMode, selectOnly, sorted]
  );

  const onSegmentPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string) => {
      if (!editMode) return;
      const ts = sorted.find((t) => t.id === id);
      if (!ts) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { id, kind: "move", startX: e.clientX, baseStart: ts.startTime, baseEnd: ts.endTime };
    },
    [editMode, sorted]
  );

  const onTimelinePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = timelineRef.current;
      const drag = dragRef.current;
      if (!el || !drag) return;
      const rect = el.getBoundingClientRect();
      const dt = ((e.clientX - drag.startX) / Math.max(1, rect.width)) * effectiveMax;

      if (drag.kind === "playhead") {
        seekByClientX(e.clientX);
        return;
      }
      if (drag.kind === "resize") {
        if (drag.side === "start") {
          updateOne(drag.id, { startTime: clamp(drag.baseStart + dt, 0, drag.baseEnd - MIN_SEGMENT_SECONDS) });
        } else {
          updateOne(drag.id, { endTime: clamp(drag.baseEnd + dt, drag.baseStart + MIN_SEGMENT_SECONDS, effectiveMax) });
        }
        return;
      }
      const duration = drag.baseEnd - drag.baseStart;
      const startTime = clamp(drag.baseStart + dt, 0, effectiveMax - duration);
      updateOne(drag.id, { startTime, endTime: startTime + duration });
    },
    [effectiveMax, seekByClientX, updateOne]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Browser may release capture automatically.
    }
  }, []);

  const canMerge = editMode && selectedList.length >= 2;
  const currentPct = clamp(currentTime / effectiveMax, 0, 1);
  const showGenerating = isGenerating && sorted.length === 0;

  return (
    <Card className={cn("rounded-3xl border-border/70 efb-panel efb-glow overflow-hidden", className)}>
      <CardHeader className="space-y-3 border-b border-border/40 bg-gradient-to-br from-background/40 to-transparent pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/20">
              <Clapperboard className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold tracking-tight">语音剪辑</CardTitle>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-full bg-background/50 px-2 py-0.5 ring-1 ring-border/50">
                  {showGenerating ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  ) : (
                    <Sparkles className="h-3 w-3 text-primary" />
                  )}
                  {showGenerating ? "识别中…" : `${sorted.length} 段`}
                </span>
                <span>总时长 {formatTime(effectiveMax)}</span>
                <span>{active ? `当前段 #${sorted.findIndex((x) => x.id === active.id) + 1}` : "指针未落在任一段内"}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("alpha.export", { detail: { type: "package" } })
                )
              }
              disabled={showGenerating || sorted.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              导出
            </Button>
            <Button
              variant={editMode ? "default" : "outline"}
              size="sm"
              onClick={() => setEditMode((v) => !v)}
              disabled={showGenerating}
            >
              {editMode ? <Check className="mr-2 h-4 w-4" /> : <Pencil className="mr-2 h-4 w-4" />}
              {editMode ? "完成" : "编辑"}
            </Button>
            <Button variant="outline" size="sm" onClick={doSplitAtPlayhead} disabled={showGenerating || !editMode || !active}>
              <Scissors className="mr-2 h-4 w-4" />
              拆分
            </Button>
            <Button variant="outline" size="sm" onClick={doMerge} disabled={showGenerating || !canMerge}>
              <Combine className="mr-2 h-4 w-4" />
              合并
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={doDelete}
              disabled={showGenerating || !editMode || selectedIds.size === 0}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              删除
            </Button>
          </div>
        </div>

        <div
          ref={timelineRef}
          className={cn(
            "relative h-11 overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-background/30 to-muted/10 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.05)]",
            showGenerating && "pointer-events-none opacity-40"
          )}
          onPointerDown={(e) => !showGenerating && seekByClientX(e.clientX)}
          onPointerMove={onTimelinePointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {showGenerating ? (
            <div className="absolute inset-0 flex items-center px-3">
              <div className="h-2 w-full animate-pulse rounded-full bg-primary/20" />
            </div>
          ) : null}
          {!showGenerating
            ? sorted.map((t) => {
            const left = clamp(t.startTime / effectiveMax, 0, 1);
            const right = clamp(t.endTime / effectiveMax, 0, 1);
            const selected = selectedIds.has(t.id);
            const isActive = active?.id === t.id;
            return (
              <div
                key={t.id}
                className={cn(
                  "absolute bottom-1 top-1 cursor-pointer rounded-lg border",
                  selected ? "border-primary bg-primary/25" : "border-border/50 bg-muted/30 hover:bg-muted/40",
                  isActive && "ring-1 ring-primary"
                )}
                style={{ left: `${left * 100}%`, width: `${Math.max(0.2, (right - left) * 100)}%` }}
                title={`${formatTime(t.startTime)} - ${formatTime(t.endTime)}`}
                onClick={() => {
                  if (editMode) {
                    toggleSelect(t.id);
                  } else {
                    selectOnly(t.id);
                    onSeek?.(t.startTime);
                  }
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (editMode && e.altKey) {
                    const rect = timelineRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const atTime = (clamp(e.clientX - rect.left, 0, rect.width) / Math.max(1, rect.width)) * effectiveMax;
                    splitSegment(t, atTime);
                    return;
                  }
                  onSegmentPointerDown(e, t.id);
                }}
              >
                <div
                  className="absolute bottom-0 left-0 top-0 w-2 cursor-ew-resize"
                  style={{ pointerEvents: editMode ? "auto" : "none" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onHandlePointerDown(e, t.id, "start");
                  }}
                />
                <div
                  className="absolute bottom-0 right-0 top-0 w-2 cursor-ew-resize"
                  style={{ pointerEvents: editMode ? "auto" : "none" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onHandlePointerDown(e, t.id, "end");
                  }}
                />
              </div>
            );
          })
            : null}

          {!showGenerating ? (
          <div
            className="absolute bottom-0 top-0 z-20 w-8 -translate-x-1/2 cursor-ew-resize"
            style={{ left: `${currentPct * 100}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = {
                id: "__playhead__",
                kind: "playhead",
                startX: e.clientX,
                baseStart: currentTime,
                baseEnd: currentTime,
              };
            }}
          >
            <div className="absolute left-1/2 top-1 -translate-x-1/2 rounded-md bg-primary/95 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground shadow-[0_2px_8px_hsl(var(--primary)/0.35)]">
              {formatTime(currentTime)}
            </div>
            <div className="absolute bottom-0 left-1/2 top-5 w-[2px] -translate-x-1/2 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.85)]" />
          </div>
          ) : null}
        </div>

        {!showGenerating && sorted.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border/50 bg-muted/10 p-3">
            <div className="min-w-[88px] flex-1">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                开始时间
              </div>
              <Input
                value={queryStart}
                onChange={(e) => setQueryStart(e.target.value)}
                placeholder="mm:ss 或秒"
                className="h-8 rounded-xl text-xs"
                disabled={queryAtPlayhead}
              />
            </div>
            <div className="min-w-[88px] flex-1">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                结束时间
              </div>
              <Input
                value={queryEnd}
                onChange={(e) => setQueryEnd(e.target.value)}
                placeholder="mm:ss 或秒"
                className="h-8 rounded-xl text-xs"
                disabled={queryAtPlayhead}
              />
            </div>
            <div className="min-w-[120px] flex-[1.4]">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                文本关键词
              </div>
              <Input
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="呼号 / 转写内容"
                className="h-8 rounded-xl text-xs"
              />
            </div>
            <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-border/50 bg-background/40 px-2.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={queryAtPlayhead}
                onChange={(e) => setQueryAtPlayhead(e.target.checked)}
                className="rounded"
              />
              当前指针
            </label>
            <Button type="button" size="sm" variant="secondary" className="h-8" onClick={runTimeQuery}>
              <Search className="mr-1.5 h-3.5 w-3.5" />
              查询
            </Button>
            {queryActive ? (
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={clearTimeQuery}>
                <X className="mr-1.5 h-3.5 w-3.5" />
                清除
              </Button>
            ) : null}
            {queryActive ? (
              <span className="w-full text-xs text-muted-foreground sm:w-auto">
                匹配 {filtered.length} / {sorted.length} 段
              </span>
            ) : null}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="pt-5">
        {showGenerating ? (
          <TranscriptGeneratingPanel message={generatingMessage} />
        ) : (
        <>
        <ScrollArea className="h-[min(520px,55vh)] pr-2">
          <div ref={segmentListRef} className="space-y-3">
            {sorted.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 px-4 py-10 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground/90">暂无语音片段（尚未 ASR 转写）</p>
                <p className="mt-2 text-xs leading-relaxed max-w-lg mx-auto">
                  已有录音不会自动出字，每条需单独跑一次 ASR。当前列表约 {pendingTranscriptCount}{" "}
                  条尚无转写；选中一条后点下方按钮，或左侧「立即更新」（会顺带同步 A2）。
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={syncing}
                    onClick={() => onTranscribeSelected?.()}
                  >
                    {syncing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    {syncing ? "识别中…" : "转写当前选中录音"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={addFirstSegment}>
                    <Plus className="mr-2 h-4 w-4" />
                    手动添加一段
                  </Button>
                </div>
              </div>
            ) : null}
            {filtered.length === 0 && queryActive ? (
              <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
                无匹配片段，请调整时间范围或关键词后重试。
              </div>
            ) : null}
            {filtered.map((t) => {
              const selected = selectedIds.has(t.id);
              const isActive = active?.id === t.id;
              return (
                <div
                  key={t.id}
                  data-segment-id={t.id}
                  className={cn(
                    "relative rounded-2xl border p-3 transition-colors duration-150",
                    selected ? "border-primary/80 bg-primary/10" : "border-border/60 bg-background/10",
                    isActive && "ring-2 ring-primary/40",
                    !editMode && "cursor-pointer hover:border-primary/50"
                  )}
                  onClick={() => {
                    if (editMode) toggleSelect(t.id);
                    else {
                      selectOnly(t.id);
                      onSeek?.(t.startTime);
                    }
                  }}
                >
                  {isActive ? (
                    <span className="absolute right-3 top-3 z-10 rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground shadow-[0_2px_8px_hsl(var(--primary)/0.35)]">
                      当前播放
                    </span>
                  ) : null}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!editMode}
                      onChange={(e) => toggleSelect(t.id, e.target.checked)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(!editMode && "cursor-not-allowed opacity-50")}
                    />
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        selectOnly(t.id);
                        onSeek?.(t.startTime);
                      }}
                    >
                      {formatTime(t.startTime)} - {formatTime(t.endTime)}
                    </button>
                    {t.speaker ? <span>({t.speaker})</span> : null}
                  </div>

                  <div className="mt-2 grid grid-cols-12 gap-2" onClick={(e) => e.stopPropagation()}>
                    <div className="col-span-6 sm:col-span-3">
                      <div className="mb-1 text-xs text-muted-foreground">开始(s)</div>
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8 rounded-xl" onClick={(e) => { e.stopPropagation(); nudge(t.id, "startTime", -0.1); }} disabled={!editMode}>
                          <Minus className="h-4 w-4" />
                        </Button>
                        <Input type="number" step="0.05" value={t.startTime} onChange={(e) => updateOne(t.id, { startTime: Number(e.target.value || 0) })} onClick={(e) => e.stopPropagation()} className="h-8 rounded-xl" disabled={!editMode} />
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8 rounded-xl" onClick={(e) => { e.stopPropagation(); nudge(t.id, "startTime", 0.1); }} disabled={!editMode}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="col-span-6 sm:col-span-3">
                      <div className="mb-1 text-xs text-muted-foreground">结束(s)</div>
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8 rounded-xl" onClick={(e) => { e.stopPropagation(); nudge(t.id, "endTime", -0.1); }} disabled={!editMode}>
                          <Minus className="h-4 w-4" />
                        </Button>
                        <Input type="number" step="0.05" value={t.endTime} onChange={(e) => updateOne(t.id, { endTime: Number(e.target.value || 0) })} onClick={(e) => e.stopPropagation()} className="h-8 rounded-xl" disabled={!editMode} />
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8 rounded-xl" onClick={(e) => { e.stopPropagation(); nudge(t.id, "endTime", 0.1); }} disabled={!editMode}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="col-span-12 sm:col-span-3">
                      <div className="mb-1 text-xs text-muted-foreground">说话人</div>
                      <Input value={t.speaker ?? ""} onChange={(e) => updateOne(t.id, { speaker: e.target.value || undefined })} onClick={(e) => e.stopPropagation()} className="h-8 rounded-xl" placeholder="ATC / Pilot" disabled={!editMode} />
                    </div>
                  </div>

                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    <div className="mb-1 text-xs text-muted-foreground">文本</div>
                    <Textarea value={t.text} onChange={(e) => updateOne(t.id, { text: e.target.value })} onClick={(e) => e.stopPropagation()} className="min-h-[70px] rounded-2xl" placeholder="在这里编辑该段转写文本" disabled={!editMode} />
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <div className="mt-4 rounded-xl border border-border/40 bg-muted/15 p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="mb-2 font-medium text-foreground/90">操作说明</p>
          <ul className="list-disc space-y-1.5 pl-4 marker:text-primary/80">
            <li>点击“编辑”后，可多选片段并执行合并、删除，也可在播放指针处拆分当前片段。</li>
            <li>拖动片段可整体平移，拖动左右边缘可调整开始/结束时间。</li>
            <li>按住 Alt 点击时间轴片段内部，可以直接在点击位置拆分为两段。</li>
          </ul>
        </div>
        </>
        )}
      </CardContent>
    </Card>
  );
}
