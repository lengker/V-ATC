"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn, formatTime } from "@/lib/utils";
import { Play, StepBack, StepForward, Zap } from "lucide-react";

export function TimeRover({
  value,
  max,
  onChange,
  onTogglePlayPause,
  className,
}: {
  value: number;
  max: number;
  onChange: (t: number) => void;
  onTogglePlayPause?: () => void;
  className?: string;
}) {
  const [rate, setRate] = useState<0.5 | 1 | 2 | 4>(1);

  const step = useMemo(() => {
    // 姝ヨ繘绮掑害锛氭牴鎹椂闀胯嚜閫傚簲
    if (max <= 60) return 1;
    if (max <= 10 * 60) return 2;
    return 5;
  }, [max]);

  return (
    <div className={cn("rounded-2xl border border-border/60 bg-background/20 p-3", className)}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-muted-foreground">鏃堕棿娴忚</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {formatTime(value)} / {formatTime(max)}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="rounded-full bg-background/30"
          onClick={() => onChange(Math.max(0, value - step))}
          title={`- ${step}s`}
        >
          <StepBack className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="rounded-full bg-background/30"
          onClick={onTogglePlayPause}
          disabled={!onTogglePlayPause}
          title="播放/暂停音频"
        >
          <Play className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="rounded-full bg-background/30"
          onClick={() => onChange(Math.min(max, value + step))}
          title={`+ ${step}s`}
        >
          <StepForward className="h-4 w-4" />
        </Button>

        <div className="flex-1 px-2">
          <Slider
            value={[value]}
            max={max}
            step={0.1}
            onValueChange={([v]) => onChange(v)}
          />
        </div>

        <Button
          variant="outline"
          className="rounded-full bg-background/30 h-9 px-3 text-xs"
          onClick={() => setRate((r) => (r === 4 ? 0.5 : r === 2 ? 4 : r === 1 ? 2 : 1))}
          title="鎾斁閫熷害"
        >
          <Zap className="h-4 w-4 mr-2" />
          {rate}x
        </Button>
      </div>
    </div>
  );
}

