"use client";

import { useMemo, useState } from "react";
import { AudioData, RecordingMeta } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatTime } from "@/lib/utils";
import { Star, Radio, Headphones, User } from "lucide-react";
import { VirtualList } from "@/components/ui/virtual-list";

export function RecordingsPanel({
  recordings,
  activeId,
  onSelect,
  recordingMeta = {},
  className,
}: {
  recordings: AudioData[];
  activeId: string;
  onSelect: (id: string) => void;
  recordingMeta?: Record<string, RecordingMeta>;
  className?: string;
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
    return [...list].sort((a, b) => (recentMap[b.id] ?? 0) - (recentMap[a.id] ?? 0));
  }, [recordings, tab, recordingMeta, starredSet, recentMap]);

  const toggleStar = (id: string) => {
    const next = new Set(starredSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setStarredSet(next);
    persistStarred(next);
  };

  const tabs: { id: "Radio" | "Cabin" | "Starred" | "Mine"; label: string; icon: typeof Radio }[] = [
    { id: "Radio", label: "电台", icon: Radio },
    { id: "Cabin", label: "客舱", icon: Headphones },
    { id: "Starred", label: "收藏", icon: Star },
    { id: "Mine", label: "我的", icon: User },
  ];

  return (
    <Card className={cn("dashboard-card flex h-full min-h-0 flex-col overflow-hidden border-border/70 efb-panel efb-glow", className)}>
      <CardHeader className="shrink-0 border-b border-border/40 bg-gradient-to-br from-background/35 to-transparent px-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight">录音列表</CardTitle>
          <span className="rounded-full bg-background/50 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/50">
            {filtered.length} 条
          </span>
        </div>
      </CardHeader>
      <CardContent className="card-body flex min-h-0 flex-1 flex-col px-2 py-2">
        <div
          className="mb-2 flex shrink-0 flex-wrap gap-1 rounded-lg border border-border/50 bg-muted/15 p-0.5"
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
                "inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition-all",
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
          className="audio-list min-h-0 flex-1 pr-1"
          gapPx={6}
          overscan={10}
          estimateSizePx={84}
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
                "w-full text-left rounded-lg border p-2 transition-all duration-200",
                r.id === activeId
                  ? "border-primary/80 bg-primary/12 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                  : "border-border/60 bg-background/15 hover:border-border hover:bg-accent/30"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium truncate">{r.id}</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStar(r.id);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                    title="收藏"
                  >
                    <Star className={cn("h-4 w-4", starredSet.has(r.id) ? "fill-yellow-400 text-yellow-400" : "")} />
                  </button>
                  <div className="text-xs text-muted-foreground">{formatTime(r.duration)}</div>
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground truncate">
                {recordingMeta[r.id]?.channel ?? "电台"} · {r.metadata?.icao ?? "ICAO -"} · {r.metadata?.frequency ?? "频率 -"} · {r.metadata?.date ?? "日期 -"}
              </div>
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}

