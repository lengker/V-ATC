"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { VoiceTimestamp } from "@/types";
import { formatTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePlaybackOptional } from "@/context/PlaybackContext";

interface TimestampListProps {
  timestamps: VoiceTimestamp[];
  currentTime?: number;
  selectedTimestampId?: string;
  onTimestampClick?: (timestamp: VoiceTimestamp) => void;
  onTimestampEdit?: (timestamp: VoiceTimestamp) => void;
}

export function TimestampList({
  timestamps,
  currentTime = 0,
  selectedTimestampId,
  onTimestampClick,
  onTimestampEdit,
}: TimestampListProps) {
  const playback = usePlaybackOptional();
  const effectiveCurrentTime = playback?.currentTime ?? currentTime;

  const [q, setQ] = useState("");
  const debouncedQuery = useDebouncedValue(q, 250);
  const query = debouncedQuery.trim().toLowerCase();

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

  return (
    <Card className="h-full rounded-3xl border-border/70 efb-panel efb-glow">
      <CardHeader>
        <CardTitle>语音时间戳</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 space-y-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索：文本 / 说话人 / 时间…"
            className="h-9 bg-background/40 border-border/60"
          />
          <div className="text-xs text-muted-foreground">
            显示 {deferredTimestamps.length} / {sortedTimestamps.length}
          </div>
        </div>
        <ScrollArea className="h-[600px]">
          <div className="space-y-2">
            {deferredTimestamps.map((timestamp) => {
              const active = isActive(timestamp);
              const selected = timestamp.id === selectedTimestampId;

              return (
                <div
                  key={timestamp.id}
                  className={cn(
                    "p-3 rounded-lg border cursor-pointer transition-colors",
                    active && "bg-primary/10 border-primary",
                    selected && "ring-2 ring-primary",
                    !active && !selected && "hover:bg-accent"
                  )}
                  onClick={() => {
                    playback?.setCurrentTime(timestamp.startTime, "ui");
                    onTimestampClick?.(timestamp);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="text-xs text-muted-foreground mb-1">
                        {formatTime(timestamp.startTime)} -{" "}
                        {formatTime(timestamp.endTime)}
                        {timestamp.speaker && (
                          <span className="ml-2">({timestamp.speaker})</span>
                        )}
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
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
