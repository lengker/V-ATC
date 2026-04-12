"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { VoiceTimestamp } from "@/types";
import { cn, formatTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Minus,
  Plus,
  Scissors,
  Trash2,
  Combine,
  Pencil,
  Check,
  Clapperboard,
  Sparkles,
} from "lucide-react";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function safeUuid() {
  try {
    // modern browsers
    return crypto.randomUUID();
  } catch {
    return `ts_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
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

  const sorted = useMemo(() => {
    return [...value].sort((a, b) => a.startTime - b.startTime);
  }, [value]);

  const totalSpan = useMemo(() => {
    if (sorted.length === 0) return 0;
    return Math.max(...sorted.map((t) => t.endTime)) - Math.min(...sorted.map((t) => t.startTime));
  }, [sorted]);

  const selectedList = useMemo(() => {
    const set = selectedIds;
    return sorted.filter((t) => set.has(t.id));
  }, [sorted, selectedIds]);

  const active = useMemo(() => {
    return sorted.find((t) => currentTime >= t.startTime && currentTime <= t.endTime) ?? null;
  }, [sorted, currentTime]);

  const toggleSelect = useCallback((id: string, checked?: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldSelect = checked ?? !next.has(id);
      if (shouldSelect) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const selectOnly = useCallback((id: string) => {
    setSelectedIds(new Set([id]));
  }, []);

  const updateOne = useCallback(
    (id: string, patch: Partial<VoiceTimestamp>) => {
      if (!editMode) return;
      const next = sorted.map((t) => (t.id === id ? { ...t, ...patch } : t));
      onChange(next);
    },
    [sorted, onChange, editMode]
  );

  const nudge = useCallback(
    (id: string, which: "startTime" | "endTime", delta: number) => {
      if (!editMode) return;
      const ts = sorted.find((t) => t.id === id);
      if (!ts) return;
      const nextVal = ts[which] + delta;
      const minGap = 0.05;
      if (which === "startTime") {
        updateOne(id, { startTime: clamp(nextVal, 0, ts.endTime - minGap) });
      } else {
        updateOne(id, { endTime: clamp(nextVal, ts.startTime + minGap, timelineMax || ts.endTime + 1) });
      }
    },
    [sorted, timelineMax, updateOne]
  );

  const doDelete = useCallback(() => {
    if (!editMode) return;
    if (selectedIds.size === 0) return;
    const next = sorted.filter((t) => !selectedIds.has(t.id));
    onChange(next);
    setSelectedIds(new Set());
  }, [sorted, selectedIds, onChange, editMode]);

  const doMerge = useCallback(() => {
    if (!editMode) return;
    if (selectedList.length < 2) return;
    const list = [...selectedList].sort((a, b) => a.startTime - b.startTime);
    // Only allow merge if they are consecutive in the sorted array to keep behavior predictable.
    const idsInOrder = sorted.map((t) => t.id);
    const idxs = list.map((t) => idsInOrder.indexOf(t.id)).sort((a, b) => a - b);
    const consecutive = idxs.every((v, i) => (i === 0 ? true : v === idxs[i - 1] + 1));
    if (!consecutive) return;

    const merged: VoiceTimestamp = {
      id: safeUuid(),
      startTime: Math.min(...list.map((t) => t.startTime)),
      endTime: Math.max(...list.map((t) => t.endTime)),
      text: list.map((t) => t.text).filter(Boolean).join("\n"),
      speaker: list.map((t) => t.speaker).find(Boolean),
      confidence: undefined,
    };

    const firstIdx = idxs[0];
    const removeSet = new Set(list.map((t) => t.id));
    const next = sorted.filter((t) => !removeSet.has(t.id));
    next.splice(firstIdx, 0, merged);
    onChange(next);
    setSelectedIds(new Set([merged.id]));
  }, [selectedList, sorted, onChange, editMode]);

  const doSplitAtPlayhead = useCallback(() => {
    if (!editMode) return;
    const target = active;
    if (!target) return;
    const t = clamp(currentTime, target.startTime + 0.05, target.endTime - 0.05);
    const a: VoiceTimestamp = { ...target, endTime: t };
    const b: VoiceTimestamp = {
      ...target,
      id: safeUuid(),
      startTime: t,
      // make second part empty by default so user can refine like video editing
      text: "",
      confidence: undefined,
    };
    const next = sorted.flatMap((x) => (x.id === target.id ? [a, b] : [x]));
    onChange(next);
    setSelectedIds(new Set([a.id, b.id]));
  }, [active, currentTime, sorted, onChange, editMode]);

  const seekByClientX = useCallback(
    (clientX: number) => {
      const el = timelineRef.current;
      if (!el || !onSeek) return;
      const rect = el.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, rect.width);
      const pct = rect.width > 0 ? x / rect.width : 0;
      const t = pct * (timelineMax || 0);
      onSeek(t);
    },
    [onSeek, timelineMax]
  );

  const cutAt = useCallback(
    (id: string, atTime: number) => {
      if (!editMode) return;
      const target = sorted.find((t) => t.id === id);
      if (!target) return;
      const t = clamp(atTime, target.startTime + 0.05, target.endTime - 0.05);
      const a: VoiceTimestamp = { ...target, endTime: t };
      const b: VoiceTimestamp = {
        ...target,
        id: safeUuid(),
        startTime: t,
        text: "",
        confidence: undefined,
      };
      const next = sorted.flatMap((x) => (x.id === target.id ? [a, b] : [x]));
      onChange(next);
      setSelectedIds(new Set([a.id, b.id]));
    },
    [editMode, sorted, onChange]
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string, side: "start" | "end") => {
      if (!editMode) return;
      const el = timelineRef.current;
      if (!el) return;
      const ts = sorted.find((t) => t.id === id);
      if (!ts) return;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        id,
        kind: "resize",
        side,
        startX: e.clientX,
        baseStart: ts.startTime,
        baseEnd: ts.endTime,
      };
      selectOnly(id);
    },
    [editMode, sorted, selectOnly]
  );

  const onSegmentPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string) => {
      if (!editMode) return;
      const ts = sorted.find((t) => t.id === id);
      if (!ts) return;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        id,
        kind: "move",
        startX: e.clientX,
        baseStart: ts.startTime,
        baseEnd: ts.endTime,
      };
      selectOnly(id);
    },
    [editMode, sorted, selectOnly]
  );

  const onPlayheadPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!onSeek) return;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        id: "__playhead__",
        kind: "playhead",
        startX: e.clientX,
        baseStart: currentTime,
        baseEnd: currentTime,
      };
    },
    [onSeek, currentTime]
  );

  const onTimelinePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = timelineRef.current;
      const drag = dragRef.current;
      if (!el || !drag) return;
      const rect = el.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const dx = e.clientX - drag.startX;
      const dt = (dx / width) * (timelineMax || 1);
      const minGap = 0.05;
      if (drag.kind === "playhead") {
        seekByClientX(e.clientX);
        return;
      }
      if (drag.kind === "resize") {
        if (drag.side === "start") {
          const nextStart = clamp(drag.baseStart + dt, 0, drag.baseEnd - minGap);
          updateOne(drag.id, { startTime: nextStart });
        } else {
          const nextEnd = clamp(drag.baseEnd + dt, drag.baseStart + minGap, timelineMax || drag.baseEnd + 1);
          updateOne(drag.id, { endTime: nextEnd });
        }
        return;
      }
      // move whole segment
      const dur = drag.baseEnd - drag.baseStart;
      const maxStart = Math.max(0, (timelineMax || drag.baseEnd) - dur);
      const nextStart = clamp(drag.baseStart + dt, 0, maxStart);
      updateOne(drag.id, { startTime: nextStart, endTime: nextStart + dur });
    },
    [timelineMax, updateOne]
  );

  const onTimelinePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const currentPct = timelineMax > 0 ? clamp(currentTime / timelineMax, 0, 1) : 0;

  return (
    <Card className={cn("rounded-3xl border-border/70 efb-panel efb-glow overflow-hidden", className)}>
      <CardHeader className="space-y-3 border-b border-border/40 bg-gradient-to-br from-background/40 to-transparent pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
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
                <span>总时长约 {formatTime(Math.max(timelineMax, totalSpan))}</span>
                {active ? (
                  <span className="text-primary">当前段 #{sorted.findIndex((x) => x.id === active.id) + 1}</span>
                ) : (
                  <span>指针未落在任一段内</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant={editMode ? "default" : "outline"}
              size="sm"
              onClick={() => setEditMode((v) => !v)}
              title={editMode ? "退出编辑（仅浏览/定位）" : "进入编辑（裁剪/拆分/改文本）"}
            >
              {editMode ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  完成
                </>
              ) : (
                <>
                  <Pencil className="h-4 w-4 mr-2" />
                  编辑
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={doSplitAtPlayhead}
              disabled={!active || !editMode}
              title="在播放指针处拆分当前段"
            >
              <Scissors className="h-4 w-4 mr-2" />
              拆分
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={doMerge}
              disabled={selectedList.length < 2 || !editMode}
              title="合并所选相邻段"
            >
              <Combine className="h-4 w-4 mr-2" />
              合并
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={doDelete}
              disabled={selectedIds.size === 0 || !editMode}
              title="删除所选段"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              删除
            </Button>
          </div>
        </div>

        {/* mini timeline */}
        <div
          ref={timelineRef}
          className="relative h-11 rounded-2xl border border-border/50 bg-gradient-to-b from-background/30 to-muted/10 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.05)] overflow-hidden"
          onPointerDown={(e) => {
            // 浏览/定位：点击时间轴任意位置跳转播放指针（像剪辑软件）
            // 编辑模式下也保留这个能力（不影响拖拽句柄）
            seekByClientX(e.clientX);
          }}
          onPointerMove={onTimelinePointerMove}
          onPointerUp={onTimelinePointerUp}
        >
          {/* segments */}
          {sorted.map((t) => {
            const left = timelineMax > 0 ? clamp(t.startTime / timelineMax, 0, 1) : 0;
            const right = timelineMax > 0 ? clamp(t.endTime / timelineMax, 0, 1) : 0;
            const widthPct = Math.max(0.002, right - left);
            const selected = selectedIds.has(t.id);
            const isActive = active?.id === t.id;
            return (
              <div
                key={t.id}
                className={cn(
                  "absolute top-1 bottom-1 rounded-lg border cursor-pointer",
                  selected ? "bg-primary/25 border-primary" : "bg-muted/30 border-border/50 hover:bg-muted/40",
                  isActive && "ring-1 ring-primary"
                )}
                style={{ left: `${left * 100}%`, width: `${widthPct * 100}%` }}
                onClick={() => {
                  // 浏览态：只允许单选定位；编辑态：仍旧单选并进入当前段上下文
                  selectOnly(t.id);
                  onSeek?.(t.startTime);
                }}
                title={`${formatTime(t.startTime)} - ${formatTime(t.endTime)}`}
                onPointerDown={(e) => {
                  // 阻止触发背景 seek
                  e.stopPropagation();
                  // 编辑态：Alt + 点击条块内部，直接“切一刀”到点击位置（像剪辑软件）
                  if (editMode && e.altKey) {
                    const el = timelineRef.current;
                    if (!el) return;
                    const rect = el.getBoundingClientRect();
                    const x = clamp(e.clientX - rect.left, 0, rect.width);
                    const pct = rect.width > 0 ? x / rect.width : 0;
                    const atTime = pct * (timelineMax || 0);
                    cutAt(t.id, atTime);
                    return;
                  }
                  // 编辑态：拖动条块整体移动
                  if (editMode) onSegmentPointerDown(e, t.id);
                }}
              >
                {/* drag handles */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onHandlePointerDown(e, t.id, "start");
                  }}
                  style={{ pointerEvents: editMode ? "auto" : "none" }}
                />
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onHandlePointerDown(e, t.id, "end");
                  }}
                  style={{ pointerEvents: editMode ? "auto" : "none" }}
                />
              </div>
            );
          })}
          {/* playhead */}
          <div
            className="absolute top-0 bottom-0 z-10 w-px cursor-ew-resize bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.85)]"
            style={{ left: `${currentPct * 100}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPlayheadPointerDown(e);
            }}
          />
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
                    "rounded-2xl border p-3 transition-all duration-200",
                    selected ? "border-primary/80 bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]" : "border-border/60 bg-background/10 hover:border-border hover:bg-accent/25",
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
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!editMode}
                          onChange={(e) => toggleSelect(t.id, e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                          className={cn(!editMode && "opacity-50 cursor-not-allowed")}
                        />
                        <button
                          type="button"
                          className="hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            selectOnly(t.id);
                            onSeek?.(t.startTime);
                          }}
                          title="跳转到该段开始"
                        >
                          {formatTime(t.startTime)} - {formatTime(t.endTime)}
                        </button>
                        {t.speaker ? <span>({t.speaker})</span> : null}
                        {typeof t.confidence === "number" ? (
                          <span>置信度 {(t.confidence * 100).toFixed(1)}%</span>
                        ) : null}
                      </div>

                      <div className="mt-2 grid grid-cols-12 gap-2">
                        <div className="col-span-6 sm:col-span-3">
                          <div className="text-xs text-muted-foreground mb-1">开始(s)</div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 rounded-xl"
                              onClick={(e) => {
                                e.stopPropagation();
                                nudge(t.id, "startTime", -0.1);
                              }}
                              title="-0.1s"
                              disabled={!editMode}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <Input
                              type="number"
                              step="0.05"
                              value={t.startTime}
                              onChange={(e) => updateOne(t.id, { startTime: parseFloat(e.target.value || "0") })}
                              onClick={(e) => e.stopPropagation()}
                              className="h-8 rounded-xl"
                              disabled={!editMode}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 rounded-xl"
                              onClick={(e) => {
                                e.stopPropagation();
                                nudge(t.id, "startTime", +0.1);
                              }}
                              title="+0.1s"
                              disabled={!editMode}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="col-span-6 sm:col-span-3">
                          <div className="text-xs text-muted-foreground mb-1">结束(s)</div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 rounded-xl"
                              onClick={(e) => {
                                e.stopPropagation();
                                nudge(t.id, "endTime", -0.1);
                              }}
                              title="-0.1s"
                              disabled={!editMode}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <Input
                              type="number"
                              step="0.05"
                              value={t.endTime}
                              onChange={(e) => updateOne(t.id, { endTime: parseFloat(e.target.value || "0") })}
                              onClick={(e) => e.stopPropagation()}
                              className="h-8 rounded-xl"
                              disabled={!editMode}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 rounded-xl"
                              onClick={(e) => {
                                e.stopPropagation();
                                nudge(t.id, "endTime", +0.1);
                              }}
                              title="+0.1s"
                              disabled={!editMode}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="col-span-12 sm:col-span-3">
                          <div className="text-xs text-muted-foreground mb-1">说话人</div>
                          <Input
                            value={t.speaker ?? ""}
                            onChange={(e) => updateOne(t.id, { speaker: e.target.value || undefined })}
                            onClick={(e) => e.stopPropagation()}
                            className="h-8 rounded-xl"
                            placeholder="ATC / Pilot"
                            disabled={!editMode}
                          />
                        </div>
                      </div>

                      <div className="mt-2">
                        <div className="text-xs text-muted-foreground mb-1">文本（可多段编辑）</div>
                        <Textarea
                          value={t.text}
                          onChange={(e) => updateOne(t.id, { text: e.target.value })}
                          onClick={(e) => e.stopPropagation()}
                          className="min-h-[70px] rounded-2xl"
                          placeholder="在这里精细修改逐字稿…"
                          disabled={!editMode}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <div className="mt-4 rounded-xl border border-border/40 bg-muted/15 p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="mb-2 font-medium text-foreground/90">操作说明</p>
          <ul className="list-disc space-y-1.5 pl-4 marker:text-primary/80">
            <li>
              <strong className="font-medium text-foreground/90">浏览</strong>
              ：点击时间轴跳转播放指针；点击段落定位到段首。
            </li>
            <li>
              <strong className="font-medium text-foreground/90">编辑</strong>
              ：点「编辑」后可多选、拆分、合并、删段，并改时间/文本。
            </li>
            <li>
              <strong className="font-medium text-foreground/90">时间线</strong>
              ：编辑态下拖动条块平移；拖两端裁剪；按住 <kbd className="rounded border border-border/60 bg-background px-1 py-px font-mono text-[10px]">Alt</kbd>{" "}
              在条内点击可截断为两段。
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

