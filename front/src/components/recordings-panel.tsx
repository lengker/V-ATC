"use client";

import { useEffect, useMemo, useState } from "react";
import { AudioData } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatTime } from "@/lib/utils";
import { Star, Radio, Headphones, User, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RecordingMeta } from "@/mock/demo-data";
import { VirtualList } from "@/components/ui/virtual-list";
import { getRecordingDisplayName } from "@/lib/recording-display";

export function RecordingsPanel({
  recordings,
  activeId,
  onSelect,
  recordingMeta = {},
  updatedAt = null,
  syncing = false,
  onUpdateOneRecording,
  onTranscribeSelected,
  pendingTranscriptCount = 0,
  onDeleteRecording,
  deletingRecordingId = null,
}: {
  recordings: AudioData[];
  activeId: string;
  onSelect: (id: string) => void;
  recordingMeta?: Record<string, RecordingMeta>;
  updatedAt?: number | null;
  syncing?: boolean;
  onUpdateOneRecording?: () => void;
  onTranscribeSelected?: () => void;
  pendingTranscriptCount?: number;
  onDeleteRecording?: (id: string) => void | Promise<void>;
  deletingRecordingId?: string | null;
}) {
  const [tab, setTab] = useState<"Radio" | "Cabin" | "Starred" | "Mine">("Radio");
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
    if (tab === "Cabin") {
      list = list.filter((r) => recordingMeta[r.id]?.channel === "Cabin");
    } else if (tab === "Radio") {
      list = list.filter((r) => recordingMeta[r.id]?.channel !== "Cabin");
    } else if (tab === "Starred") {
      list = list.filter((r) => starredSet.has(r.id));
    } else if (tab === "Mine") {
      list = list.filter((r) => recordingMeta[r.id]?.mine);
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

  const tabs: { id: "Radio" | "Cabin" | "Starred" | "Mine"; label: string; icon: typeof Radio }[] = [
    { id: "Radio", label: "Radio", icon: Radio },
    { id: "Cabin", label: "Cabin", icon: Headphones },
    { id: "Starred", label: "Starred", icon: Star },
    { id: "Mine", label: "Mine", icon: User },
  ];

  return (
    <Card className="rounded-3xl border-border/70 efb-panel efb-glow overflow-hidden">
      <CardHeader className="border-b border-border/40 bg-gradient-to-br from-background/35 to-transparent pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-semibold tracking-tight">录音列表</CardTitle>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              共 {recordings.length} 条
              {pendingTranscriptCount > 0 ? ` · ${pendingTranscriptCount} 条无转写` : " · 均已转写"}
              {syncing ? " · 识别中…" : ""}
              {updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString()}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex flex-row flex-wrap items-center justify-end gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
                disabled={syncing}
                onClick={() => onTranscribeSelected?.()}
                title="仅对当前选中的录音做 ASR 转写"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                {syncing ? "转写中…" : "转写选中"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
                disabled={syncing}
                onClick={() => onUpdateOneRecording?.()}
                title="从 A2 拉取新录音并同步；优先转写当前选中且无文本的录音"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                {syncing ? "更新中…" : "实时更新"}
              </Button>
            </div>
            <span className="rounded-full bg-background/50 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/50">
              {filtered.length} 条
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div
          className="mb-3 flex flex-wrap gap-1.5 rounded-2xl border border-border/50 bg-muted/15 p-1"
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
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-medium transition-all sm:text-xs",
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
                  : "border-border/60 bg-background/15 hover:border-border hover:bg-accent/30"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
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
                {recordingMeta[r.id]?.channel ?? "Radio"} · {r.metadata?.icao ?? "ICAO -"} · {r.metadata?.frequency ?? "FREQ -"} · {r.metadata?.date ?? "DATE -"}
              </div>
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}

