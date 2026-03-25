"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatTime } from "@/lib/utils";
import { VoiceTimestamp } from "@/types";

interface AudioWaveformProps {
  audioUrl: string;
  timestamps?: VoiceTimestamp[];
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
  onTimestampClick?: (timestamp: VoiceTimestamp) => void;
}

export function AudioWaveform({
  audioUrl,
  timestamps = [],
  currentTime = 0,
  onTimeUpdate,
  onTimestampClick,
}: AudioWaveformProps) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    if (!waveformRef.current) return;

    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: "hsl(var(--primary))",
      progressColor: "hsl(var(--primary) / 0.5)",
      cursorColor: "hsl(var(--foreground))",
      barWidth: 2,
      barRadius: 3,
      responsive: true,
      height: 100,
      normalize: true,
      backend: "WebAudio",
    });

    // 添加错误处理
    wavesurfer.on("error", (error) => {
      if (error instanceof Error && error.name === "AbortError") return;
      console.error("WaveSurfer error:", error);
      setAudioError("音频加载失败，请检查网络连接或音频 URL");
      // 如果加载失败，使用 timestamps 的最大时间作为时长
      if (timestamps.length > 0) {
        const maxTime = Math.max(...timestamps.map((ts) => ts.endTime));
        setDuration(maxTime || 60);
      } else {
        setDuration(60);
      }
    });

    wavesurfer.on("ready", () => {
      setDuration(wavesurfer.getDuration());
    });

    wavesurfer.on("play", () => setIsPlaying(true));
    wavesurfer.on("pause", () => setIsPlaying(false));
    wavesurfer.on("finish", () => setIsPlaying(false));

    wavesurfer.on("timeupdate", (time) => {
      onTimeUpdate?.(time);
    });

    wavesurfer.on("seek", (progress) => {
      const time = progress * wavesurfer.getDuration();
      onTimeUpdate?.(time);
    });

    // 加载音频；不同版本的 load 返回值不同（void / Promise），统一兼容处理
    try {
      const maybePromise = wavesurfer.load(audioUrl) as unknown;
      if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
        (maybePromise as Promise<unknown>).catch((error) => {
          if (error instanceof Error && error.name === "AbortError") return;
          console.error("Error loading audio:", error);
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      console.error("Error loading audio:", error);
      if (timestamps.length > 0) {
        const maxTime = Math.max(...timestamps.map((ts) => ts.endTime));
        setDuration(maxTime || 60);
      } else {
        setDuration(60);
      }
    }

    wavesurferRef.current = wavesurfer;

    return () => {
      try {
        // 先停止播放，再销毁
        if (wavesurferRef.current) {
          wavesurferRef.current.pause();
          wavesurferRef.current.unAll(); // 移除所有事件监听器
          wavesurferRef.current.destroy();
        }
      } catch (error) {
        console.warn("WaveSurfer cleanup error:", error);
      }
      wavesurferRef.current = null;
    };
  }, [audioUrl, onTimeUpdate, timestamps]);

  useEffect(() => {
    if (wavesurferRef.current && currentTime !== undefined) {
      const currentProgress = wavesurferRef.current.getCurrentTime();
      if (duration > 0 && Math.abs(currentProgress - currentTime) > 0.1) {
        wavesurferRef.current.seekTo(currentTime / duration);
      }
    }
  }, [currentTime, duration]);

  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(volume);
    }
  }, [volume]);

  const togglePlayPause = () => {
    if (wavesurferRef.current && !audioError) {
      try {
        wavesurferRef.current.playPause();
      } catch (error) {
        console.error("Playback error:", error);
        setAudioError("播放失败");
      }
    }
  };

  const handleTimestampClick = (timestamp: VoiceTimestamp) => {
    if (wavesurferRef.current && duration > 0 && !audioError) {
      try {
        wavesurferRef.current.seekTo(timestamp.startTime / duration);
        onTimestampClick?.(timestamp);
      } catch (error) {
        console.error("Seek error:", error);
      }
    } else {
      // 即使音频加载失败，也允许点击时间戳来更新 UI
      onTimestampClick?.(timestamp);
    }
  };

  return (
    <div className="space-y-4">
      {audioError && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
          {audioError}
          <div className="text-xs text-muted-foreground mt-1">
            界面仍可正常使用，但无法播放音频
          </div>
        </div>
      )}
      <div className="relative">
        <div ref={waveformRef} className="w-full" />
        {/* 时间戳标记 */}
        {timestamps.map((timestamp) => (
          <div
            key={timestamp.id}
            className="absolute top-0 h-full cursor-pointer border-l-2 border-accent hover:bg-accent/20 transition-colors"
            style={{
              left: `${duration > 0 ? (timestamp.startTime / duration) * 100 : 0}%`,
              width: `${duration > 0 ? ((timestamp.endTime - timestamp.startTime) / duration) * 100 : 0}%`,
            }}
            onClick={() => handleTimestampClick(timestamp)}
            title={`${formatTime(timestamp.startTime)} - ${formatTime(timestamp.endTime)}`}
          />
        ))}
      </div>

      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={togglePlayPause}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        <div className="flex-1 flex items-center gap-2">
          <span className="text-sm text-muted-foreground min-w-[50px]">
            {formatTime(currentTime)}
          </span>
          <Slider
            value={[currentTime]}
            max={duration}
            step={0.1}
            onValueChange={([value]) => {
              if (wavesurferRef.current && duration > 0 && !audioError) {
                try {
                  wavesurferRef.current.seekTo(value / duration);
                  onTimeUpdate?.(value);
                } catch (error) {
                  console.error("Seek error:", error);
                }
              } else {
                // 即使音频加载失败，也允许拖动进度条来更新 UI
                onTimeUpdate?.(value);
              }
            }}
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground min-w-[50px]">
            {formatTime(duration)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {volume === 0 ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
          <Slider
            value={[volume]}
            max={1}
            step={0.01}
            onValueChange={([value]) => setVolume(value)}
            className="w-24"
          />
        </div>
      </div>
    </div>
  );
}
