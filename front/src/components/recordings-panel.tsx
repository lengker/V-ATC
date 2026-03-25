"use client";

import { useMemo, useState } from "react";
import { AudioData } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatTime } from "@/lib/utils";
import { Star } from "lucide-react";
import type { RecordingMeta } from "@/mock/demo-data";

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

  const tabBtn = (id: "Radio" | "Cabin" | "Starred" | "Mine") => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={cn(
        "px-2 py-1 rounded-lg text-xs border transition-colors",
        tab === id ? "bg-primary/15 border-primary/40 text-primary" : "bg-background/20 border-border/60 text-muted-foreground hover:text-foreground"
      )}
    >
      {id}
    </button>
  );

  return (
    <Card className="rounded-3xl border-border/70 efb-panel efb-glow">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Recordings</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-3">{(["Radio", "Cabin", "Starred", "Mine"] as const).map(tabBtn)}</div>
        <ScrollArea className="h-[180px] pr-2">
          <div className="space-y-2">
            {filtered.map((r) => (
              <div
                key={r.id}
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
                  "w-full text-left rounded-xl border p-3 transition-colors",
                  r.id === activeId
                    ? "border-primary bg-primary/10"
                    : "border-border/60 bg-background/20 hover:bg-accent/50"
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
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

