"use client";

import { useMemo, useState } from "react";
import { AudioData } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatTime } from "@/lib/utils";
import { Star, Radio, Headphones, User } from "lucide-react";
import type { RecordingMeta } from "@/mock/demo-data";
import { VirtualList } from "@/components/ui/virtual-list";

export function RecordingsPanel({
  recordings,
  activeId,
  onSelect,
  recordingMeta = {},
}: {
  recordings: AudioData[];
  activeId: string;
  onSelect: (id: string) => void;
  recordingMeta?: Record<string, RecordingMeta>;
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
    { id: "Radio", label: "Radio", icon: Radio },
    { id: "Cabin", label: "Cabin", icon: Headphones },
    { id: "Starred", label: "Starred", icon: Star },
    { id: "Mine", label: "Mine", icon: User },
  ];

  return (
    <Card className="rounded-3xl border-border/70 efb-panel efb-glow overflow-hidden">
      <CardHeader className="border-b border-border/40 bg-gradient-to-br from-background/35 to-transparent pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold tracking-tight">录音列表</CardTitle>
          <span className="rounded-full bg-background/50 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/50">
            {filtered.length} 条
          </span>
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
                <div className="text-sm font-medium truncate">{r.id}</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStar(r.id);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                    title="Star"
                  >
                    <Star className={cn("h-4 w-4", starredSet.has(r.id) ? "fill-yellow-400 text-yellow-400" : "")} />
                  </button>
                  <div className="text-xs text-muted-foreground">{formatTime(r.duration)}</div>
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

