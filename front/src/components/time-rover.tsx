"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn, formatTime } from "@/lib/utils";
import { Pause, Play, StepBack, StepForward } from "lucide-react";

/**
 * 全局播放头控制：拖动/点击滑块、步进、播放暂停均委托给左侧波形播放器。
 */
export function TimeRover({
  value,
  max,
  isPlaying = false,
  onSeek,
  onStep,
  onTogglePlay,
  className,
}: {
  value: number;
  max: number;
  isPlaying?: boolean;
  /** 拖动或点击进度条 */
  onSeek: (t: number) => void;
  /** 前进/后退步进（秒） */
  onStep?: (deltaSeconds: number) => void;
  onTogglePlay?: () => void;
  className?: string;
}) {
  const step = useMemo(() => {
    if (max <= 60) return 1;
    if (max <= 10 * 60) return 2;
    return 5;
  }, [max]);

  return (
    <div className={cn("rounded-2xl border border-border/60 bg-background/20 p-3", className)}>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-muted-foreground">播放进度</div>
          <div className="text-[10px] text-muted-foreground/80">与左侧波形同步，拖动可跳转</div>
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {formatTime(value)} / {formatTime(max)}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full bg-background/30"
          onClick={() => (onStep ? onStep(-step) : onSeek(Math.max(0, value - step)))}
          title={`后退 ${step}s`}
        >
          <StepBack className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full bg-background/30"
          onClick={() => onTogglePlay?.()}
          disabled={!onTogglePlay}
          title={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full bg-background/30"
          onClick={() => (onStep ? onStep(step) : onSeek(Math.min(max, value + step)))}
          title={`前进 ${step}s`}
        >
          <StepForward className="h-4 w-4" />
        </Button>

        <div className="flex-1 px-2">
          <Slider
            value={[Math.min(value, max)]}
            max={max}
            step={0.05}
            onValueChange={([v]) => onSeek(v)}
          />
        </div>
      </div>
    </div>
  );
}
