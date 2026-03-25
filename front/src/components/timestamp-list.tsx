"use client";

import { VoiceTimestamp } from "@/types";
import { formatTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

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
  const sortedTimestamps = [...timestamps].sort(
    (a, b) => a.startTime - b.startTime
  );

  const isActive = (timestamp: VoiceTimestamp) => {
    return (
      currentTime >= timestamp.startTime && currentTime <= timestamp.endTime
    );
  };

  return (
    <Card className="h-full rounded-3xl border-border/70 efb-panel efb-glow">
      <CardHeader>
        <CardTitle>语音时间戳</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px]">
          <div className="space-y-2">
            {sortedTimestamps.map((timestamp) => {
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
                  onClick={() => onTimestampClick?.(timestamp)}
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
