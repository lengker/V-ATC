"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn, formatTime } from "@/lib/utils";
import { Pause, Play, StepBack, StepForward, Zap } from "lucide-react";

export function TimeRover({
  value,
  max,
  onChange,
  className,
}: {
  value: number;
  max: number;
  onChange: (t: number) => void;
  className?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<0.5 | 1 | 2 | 4>(1);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);

  const step = useMemo(() => {
    // 步进粒度：根据时长自适应
    if (max <= 60) return 1;
    if (max <= 10 * 60) return 2;
    return 5;
  }, [max]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
      return;
    }

    const loop = (ts: number) => {
      if (lastRef.current == null) lastRef.current = ts;
      const dt = (ts - lastRef.current) / 1000;
      lastRef.current = ts;

      const next = Math.min(max, value + dt * rate);
      onChange(next);
      if (next >= max) {
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, rate, max, value]);

  return (
    <div className={cn("rounded-2xl border border-border/60 bg-background/20 p-3", className)}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-muted-foreground">Time Rover</div>
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
          onClick={() => setPlaying((p) => !p)}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
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
          title="Playback rate"
        >
          <Zap className="h-4 w-4 mr-2" />
          {rate}x
        </Button>
      </div>
    </div>
  );
}

