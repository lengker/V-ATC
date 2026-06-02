"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { VoiceTimestamp } from "@/types";
import { formatTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePlaybackOptional } from "@/context/PlaybackContext";
import { VirtualList } from "@/components/ui/virtual-list";

interface TimestampListProps {
  timestamps: VoiceTimestamp[];
  currentTime?: number;
  selectedTimestampId?: string;
  onTimestampClick?: (timestamp: VoiceTimestamp) => void;
  onTimestampEdit?: (timestamp: VoiceTimestamp) => void;
  searchQuery?: string;
  className?: string;
}

export function TimestampList({
  timestamps,
  currentTime = 0,
  selectedTimestampId,
  onTimestampClick,
  onTimestampEdit,
  searchQuery = "",
  className,
}: TimestampListProps) {
  const playback = usePlaybackOptional();
  const effectiveCurrentTime = playback?.currentTime ?? currentTime;

  const [q, setQ] = useState("");
  const debouncedQuery = useDebouncedValue(q, 250);
  const query = [debouncedQuery, searchQuery].filter(Boolean).join(" ").trim().toLowerCase();

  const sortedTimestamps = useMemo(
    () => [...timestamps].sort((a, b) => a.startTime - b.startTime),
    [timestamps]
  );

  const filteredTimestamps = useMemo(() => {
    if (!query) return sortedTimestamps;
    return sortedTimestamps.filter((t) => {
      const hay = `${t.text} ${t.speaker ?? ""} ${formatTime(t.startTime)} ${formatTime(t.endTime)}`.toLowerCase();
      return hay.includes(query);
    });
  }, [query, sortedTimestamps]);

  const deferredTimestamps = useDeferredValue(filteredTimestamps);

  const isActive = (timestamp: VoiceTimestamp) => {
    return (
      effectiveCurrentTime >= timestamp.startTime && effectiveCurrentTime <= timestamp.endTime
    );
  };

  const activeIndex = useMemo(
    () =>
      deferredTimestamps.findIndex(
        (timestamp) => effectiveCurrentTime >= timestamp.startTime && effectiveCurrentTime <= timestamp.endTime
      ),
    [deferredTimestamps, effectiveCurrentTime]
  );

  return (
    <Card className={cn("dashboard-card flex h-full min-h-0 flex-col overflow-hidden border-border/70 efb-panel efb-glow", className)}>
      <CardHeader className="shrink-0 px-2 py-2">
        <CardTitle>语音时间戳</CardTitle>
      </CardHeader>
      <CardContent className="card-body flex min-h-0 flex-1 flex-col px-2 pb-2 pt-0">
        <div className="mb-2 shrink-0 space-y-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索：文本 / 说话人 / 时间…"
            className="h-8 bg-background/40 border-border/60 text-xs"
          />
          <div className="text-xs text-muted-foreground">
            显示 {deferredTimestamps.length} / {sortedTimestamps.length}
          </div>
        </div>
          <VirtualList
            items={deferredTimestamps}
            className="timestamp-list min-h-0 flex-1"
            gapPx={6}
            overscan={10}
            estimateSizePx={80}
            scrollToIndex={activeIndex}
            getKey={(t) => t.id}
            empty={
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                暂无结果
              </div>
            }
            renderItem={(timestamp) => {
              const active = isActive(timestamp);
              const selected = timestamp.id === selectedTimestampId;

              return (
                <div
                  className={cn(
                    "p-2 rounded-lg border cursor-pointer transition-colors",
                    active && "bg-primary/10 border-primary",
                    selected && "ring-2 ring-primary",
                    !active && !selected && "hover:bg-accent"
                  )}
                  onClick={() => {
                    if (onTimestampClick) {
                      onTimestampClick(timestamp);
                    } else {
                      playback?.setCurrentTime(timestamp.startTime, "ui");
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="text-xs text-muted-foreground mb-1">
                        {formatTime(timestamp.startTime)} - {formatTime(timestamp.endTime)}
                        {timestamp.speaker && <span className="ml-2">({timestamp.speaker})</span>}
                      </div>
                      <div className="text-sm">{timestamp.text}</div>
                      {timestamp.confidence !== undefined && (
                        <div className="text-xs text-muted-foreground mt-1">
                          置信度: {(timestamp.confidence * 100).toFixed(1)}%
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTimestampEdit?.(timestamp);
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      编辑
                    </button>
                  </div>
                </div>
              );
            }}
          />
      </CardContent>
    </Card>
  );
}
