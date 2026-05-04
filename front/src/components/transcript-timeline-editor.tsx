"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { VoiceTimestamp } from "@/types";
import { cn, formatTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, Clapperboard, Combine, Minus, Pencil, Plus, Scissors, Sparkles, Trash2 } from "lucide-react";

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

export function TranscriptTimelineEditor({
  value,
  currentTime,
  timelineMax,
  onChange,
  onSeek,
  className,
}: {
  value: VoiceTimestamp[];
  currentTime: number;
  timelineMax: number;
  onChange: (next: VoiceTimestamp[]) => void;
  onSeek?: (t: number) => void;
  className?: string;
}) {
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    kind: "resize" | "move" | "playhead";
    side?: "start" | "end";
    startX: number;
    baseStart: number;
    baseEnd: number;
  } | null>(null);

  const sorted = useMemo(() => normalizeSegments(value), [value]);
  const effectiveMax = Math.max(timelineMax || 0, ...sorted.map((t) => t.endTime), 1);
  const selectedList = useMemo(() => sorted.filter((t) => selectedIds.has(t.id)), [sorted, selectedIds]);
  const active = useMemo(
    () => sorted.find((t) => currentTime >= t.startTime && currentTime <= t.endTime) ?? null,
    [sorted, currentTime]
  );

  const emit = useCallback((next: VoiceTimestamp[]) => onChange(normalizeSegments(next)), [onChange]);

  const selectOnly = useCallback((id: string) => {
    setSelectedIds(new Set([id]));
  }, []);

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
                  <Sparkles className="h-3 w-3 text-primary" />
                  {sorted.length} 段
                </span>
                <span>总时长 {formatTime(effectiveMax)}</span>
                <span>{active ? `当前段 #${sorted.findIndex((x) => x.id === active.id) + 1}` : "指针未落在任一段内"}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant={editMode ? "default" : "outline"} size="sm" onClick={() => setEditMode((v) => !v)}>
              {editMode ? <Check className="mr-2 h-4 w-4" /> : <Pencil className="mr-2 h-4 w-4" />}
              {editMode ? "完成" : "编辑"}
            </Button>
            <Button variant="outline" size="sm" onClick={doSplitAtPlayhead} disabled={!editMode || !active}>
              <Scissors className="mr-2 h-4 w-4" />
              拆分
            </Button>
            <Button variant="outline" size="sm" onClick={doMerge} disabled={!canMerge}>
              <Combine className="mr-2 h-4 w-4" />
              合并
            </Button>
            <Button variant="destructive" size="sm" onClick={doDelete} disabled={!editMode || selectedIds.size === 0}>
              <Trash2 className="mr-2 h-4 w-4" />
              删除
            </Button>
          </div>
        </div>

        <div
          ref={timelineRef}
          className="relative h-11 overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-background/30 to-muted/10 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.05)]"
          onPointerDown={(e) => seekByClientX(e.clientX)}
          onPointerMove={onTimelinePointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {sorted.map((t) => {
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
          })}

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
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        <ScrollArea className="h-[min(520px,55vh)] pr-2">
          <div className="space-y-3">
            {sorted.map((t) => {
              const selected = selectedIds.has(t.id);
              const isActive = active?.id === t.id;
              return (
                <div
                  key={t.id}
                  className={cn(
                    "rounded-2xl border p-3 transition-colors duration-150",
                    selected ? "border-primary/80 bg-primary/10" : "border-border/60 bg-background/10",
                    isActive && "ring-2 ring-primary/40"
                  )}
                  onClick={() => {
                    if (editMode) toggleSelect(t.id);
                    else {
                      selectOnly(t.id);
                      onSeek?.(t.startTime);
                    }
                  }}
                >
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
      </CardContent>
    </Card>
  );
}
