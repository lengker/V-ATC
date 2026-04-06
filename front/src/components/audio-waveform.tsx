"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  memo,
  useDeferredValue,
  forwardRef,
  useImperativeHandle,
} from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, Volume2, VolumeX, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTime } from "@/lib/utils";
import { VoiceTimestamp } from "@/types";
import { usePlaybackOptional } from "@/context/PlaybackContext";

export type AudioWaveformHandle = {
  seekTo: (time: number) => void;
  playSegment: (startTime: number, endTime: number) => void;
  getDuration: () => number;
};

interface AudioWaveformProps {
  audioUrl: string;
  timestamps?: VoiceTimestamp[];
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
  onTimestampClick?: (timestamp: VoiceTimestamp) => void;
}

// 时间戳叠加层子组件 - 使用Canvas实现高性能渲染 + VAD 边界拖拽
interface TimestampOverlayProps {
  timestamps: VoiceTimestamp[];
  duration: number;
  currentTime: number;
  selectedTimestampId?: string;
  onTimestampClick: (timestamp: VoiceTimestamp) => void;
  onTimestampBoundaryDrag?: (timestamp: VoiceTimestamp, startTime: number, endTime: number) => void;
}

const TimestampOverlay = memo(function TimestampOverlay({
  timestamps,
  duration,
  currentTime,
  selectedTimestampId,
  onTimestampClick,
  onTimestampBoundaryDrag,
}: TimestampOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const deferredTimestamps = useDeferredValue(timestamps);
  const dragStateRef = useRef<{ timestamp: VoiceTimestamp; edge: "start" | "end"; startX: number } | null>(null);

  // 绘制 Canvas 上的 VAD 区间
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || duration === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    const width = container.offsetWidth;
    const height = container.offsetHeight;

    canvas.width = width;
    canvas.height = height;

    // 清除画布
    ctx.fillStyle = "hsl(var(--background))";
    ctx.fillRect(0, 0, width, height);

    // 绘制时间戳标记 - 改进样式
    deferredTimestamps.forEach((timestamp) => {
      const startPercent = (timestamp.startTime / duration) * 100;
      const endPercent = (timestamp.endTime / duration) * 100;
      const startX = (startPercent / 100) * width;
      const endX = (endPercent / 100) * width;
      const barWidth = Math.max(2, endX - startX);

      const isActive = currentTime >= timestamp.startTime && currentTime <= timestamp.endTime;
      const isSelected = timestamp.id === selectedTimestampId;

      // 绘制 VAD 区间背景 - 更明显的颜色
      if (isActive) {
        ctx.fillStyle = "hsl(var(--primary) / 0.25)";
      } else if (isSelected) {
        ctx.fillStyle = "hsl(var(--primary) / 0.15)";
      } else {
        ctx.fillStyle = "hsl(var(--accent) / 0.08)";
      }
      ctx.fillRect(startX, 0, barWidth, height);

      // 绘制左边框
      ctx.strokeStyle = isActive
        ? "hsl(var(--primary))"
        : isSelected
          ? "hsl(var(--primary) / 0.8)"
          : "hsl(var(--accent) / 0.4)";
      ctx.lineWidth = isActive ? 3 : isSelected ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, height);
      ctx.stroke();

      // 绘制右边框
      ctx.beginPath();
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX, height);
      ctx.stroke();

      // 绘制上下边框 - 标明 VAD 区间
      ctx.strokeStyle = isActive
        ? "hsl(var(--primary) / 0.5)"
        : "hsl(var(--accent) / 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX, 2);
      ctx.lineTo(endX, 2);
      ctx.moveTo(startX, height - 2);
      ctx.lineTo(endX, height - 2);
      ctx.stroke();

      // 如果说话人信息，在边框上绘制标签
      if (timestamp.speaker && barWidth > 40) {
        const speakerText = timestamp.speaker.substring(0, 3);
        ctx.fillStyle = isActive ? "hsl(var(--primary))" : "hsl(var(--accent))";
        ctx.font = "11px sans-serif";
        ctx.fillText(speakerText, startX + 3, 14);
      }
    });
  }, [deferredTimestamps, duration, currentTime, selectedTimestampId]);

  // 处理 Canvas 上的拖拽（VAD 边界调整）
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;

    // 查找点击的时间戳，特别是边界
    for (const timestamp of deferredTimestamps) {
      const startX = (timestamp.startTime / duration) * rect.width;
      const endX = (timestamp.endTime / duration) * rect.width;

      // 检测点击是否在边界附近 (±5px)
      if (Math.abs(clickX - startX) < 8) {
        if (onTimestampBoundaryDrag) {
          dragStateRef.current = { timestamp, edge: "start", startX: e.clientX };
          canvas.style.cursor = "ew-resize";
        }
        return;
      }
      if (Math.abs(clickX - endX) < 8) {
        if (onTimestampBoundaryDrag) {
          dragStateRef.current = { timestamp, edge: "end", startX: e.clientX };
          canvas.style.cursor = "ew-resize";
        }
        return;
      }

      // 检测点击是否在时间戳区域内
      const clickTime = (clickX / rect.width) * duration;
      if (clickTime >= timestamp.startTime && clickTime <= timestamp.endTime) {
        onTimestampClick(timestamp);
        return;
      }
    }
  };

  // 处理鼠标移动 - 显示拖拽光标
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;

    if (dragStateRef.current && onTimestampBoundaryDrag) {
      // 正在拖拽
      const dx = e.clientX - dragStateRef.current.startX;
      const timeOffset = (dx / rect.width) * duration;
      const { timestamp, edge } = dragStateRef.current;

      if (edge === "start") {
        const newStartTime = Math.max(0, timestamp.startTime + timeOffset);
        if (newStartTime < timestamp.endTime) {
          onTimestampBoundaryDrag(timestamp, newStartTime, timestamp.endTime);
        }
      } else {
        const newEndTime = Math.min(duration, timestamp.endTime + timeOffset);
        if (newEndTime > timestamp.startTime) {
          onTimestampBoundaryDrag(timestamp, timestamp.startTime, newEndTime);
        }
      }
    } else {
      // 悬停检测 - 显示可拖拽光标
      let showResizeCursor = false;
      for (const timestamp of deferredTimestamps) {
        const startX = (timestamp.startTime / duration) * rect.width;
        const endX = (timestamp.endTime / duration) * rect.width;

        if (Math.abs(clickX - startX) < 8 || Math.abs(clickX - endX) < 8) {
          showResizeCursor = true;
          break;
        }
      }
      canvas.style.cursor = showResizeCursor ? "ew-resize" : "pointer";
    }
  };

  const handleCanvasMouseUp = () => {
    dragStateRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = "pointer";
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        className="absolute inset-0"
        title="点击选择时间戳，拖拽边界调整时间"
      />
    </div>
  );
})

export const AudioWaveform = memo(
  forwardRef<AudioWaveformHandle, AudioWaveformProps>(function AudioWaveform(
    {
      audioUrl,
      timestamps = [],
      currentTime = 0,
      onTimeUpdate,
      onTimestampClick,
    },
    ref
  ) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const seekingUntilRef = useRef<number>(0);
  const segmentEndRef = useRef<number | null>(null);
  const playback = usePlaybackOptional();
  const setPlaybackCurrentTime = playback?.setCurrentTime;
  const setPlaybackAudioDuration = playback?.setAudioDuration;
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(() => {
    // 从 localStorage 恢复音量设置
    if (typeof window === "undefined") return 1;
    const saved = localStorage.getItem("audio-waveform-volume");
    return saved ? parseFloat(saved) : 1;
  });
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const effectiveCurrentTime = playback?.currentTime ?? currentTime;
  const deferredCurrentTime = useDeferredValue(effectiveCurrentTime);

  const emitTimeUpdate = useCallback(
    (time: number) => {
      setPlaybackCurrentTime?.(time, "waveform");
      onTimeUpdate?.(time);
    },
    [onTimeUpdate, setPlaybackCurrentTime]
  );

  // 初始化 WaveSurfer
  useEffect(() => {
    if (!waveformRef.current) return;

    setIsLoading(true);
    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: "hsl(var(--primary))",
      progressColor: "hsl(var(--primary) / 0.5)",
      cursorColor: "hsl(var(--foreground))",
      barWidth: 2,
      barRadius: 3,
      height: 100,
      normalize: true,
    });

    // 错误处理
    wavesurfer.on("error", (error) => {
      if (error instanceof Error && error.name === "AbortError") return;
      console.error("WaveSurfer error:", error);
      setAudioError("音频加载失败，请检查网络连接或音频 URL");
      setIsLoading(false);
      if (timestamps.length > 0) {
        const maxTime = Math.max(...timestamps.map((ts) => ts.endTime));
        setDuration(maxTime || 60);
      } else {
        setDuration(60);
      }
    });

    // 音频准备完毕
    wavesurfer.on("ready", () => {
      setDuration(wavesurfer.getDuration());
      setPlaybackAudioDuration?.(wavesurfer.getDuration());
      setIsLoading(false);
      setAudioError(null);
    });

    // 播放/暂停事件
    wavesurfer.on("play", () => setIsPlaying(true));
    wavesurfer.on("pause", () => setIsPlaying(false));
    wavesurfer.on("finish", () => setIsPlaying(false));

    // 时间更新事件
    const handleTimeUpdate = (time: number) => {
      if (segmentEndRef.current != null && time >= segmentEndRef.current) {
        try {
          wavesurfer.pause();
        } catch {
          // ignore
        }
        segmentEndRef.current = null;
      }
      emitTimeUpdate(time);
    };

    wavesurfer.on("timeupdate", handleTimeUpdate);
    wavesurfer.on("ready", () => {
      try {
        // 尝试获取缓冲信息
        const audio = wavesurfer.getMediaElement();
        if (audio instanceof HTMLAudioElement && audio.buffered.length > 0) {
          const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
          setBufferedPercent((bufferedEnd / wavesurfer.getDuration()) * 100);
        }
      } catch (e) {
        // 某些浏览器不支持缓冲信息
      }
    });

    // 尝试加载音频
    try {
      const maybePromise = wavesurfer.load(audioUrl) as unknown;
      if (
        maybePromise &&
        typeof (maybePromise as Promise<unknown>).catch === "function"
      ) {
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
      setIsLoading(false);
    }

    wavesurferRef.current = wavesurfer;

    // 清理函数
    return () => {
      try {
        if (wavesurferRef.current) {
          wavesurferRef.current.pause();
          wavesurferRef.current.unAll();
          wavesurferRef.current.destroy();
        }
      } catch (error) {
        console.warn("WaveSurfer cleanup error:", error);
      }
      wavesurferRef.current = null;
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
    };
  }, [audioUrl, emitTimeUpdate, setPlaybackAudioDuration, timestamps]);

  // 外部时间变化时，同步 wavesurfer 播放头（解决 TimeRover/列表点击后波形不同步）
  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws || duration <= 0 || audioError) return;
    if (Date.now() < seekingUntilRef.current) return;

    const next = Math.max(0, Math.min(deferredCurrentTime, duration));
    try {
      const wsTime = ws.getCurrentTime();
      if (Math.abs(wsTime - next) < 0.15) return;
      ws.seekTo(next / duration);
    } catch (e) {
      console.warn("Failed to sync external time:", e);
    }
  }, [deferredCurrentTime, duration, audioError]);

  // 同步倍速播放
  useEffect(() => {
    if (wavesurferRef.current) {
      try {
        const audio = wavesurferRef.current.getMediaElement();
        if (audio instanceof HTMLAudioElement) {
          audio.playbackRate = playbackRate;
        }
      } catch (e) {
        console.warn("Failed to set playback rate:", e);
      }
    }
  }, [playbackRate]);

  // 同步波形缩放
  useEffect(() => {
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.zoom(Math.round(zoom));
      } catch (e) {
        console.warn("Failed to set zoom:", e);
      }
    }
  }, [zoom]);

  // 同步音量并持久化
  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(volume);
      localStorage.setItem("audio-waveform-volume", volume.toString());
    }
  }, [volume]);

  // 键盘快捷键处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!wavesurferRef.current) return;
      
      // 避免在输入框中触发快捷键
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          wavesurferRef.current.playPause();
          break;
        case "ArrowRight":
          e.preventDefault();
          const nextTime = Math.min(
            wavesurferRef.current.getCurrentTime() + 5,
            duration
          );
          wavesurferRef.current.seekTo(nextTime / duration);
          seekingUntilRef.current = Date.now() + 150;
          setPlaybackCurrentTime?.(nextTime, "ui");
          onTimeUpdate?.(nextTime);
          break;
        case "ArrowLeft":
          e.preventDefault();
          const prevTime = Math.max(
            wavesurferRef.current.getCurrentTime() - 5,
            0
          );
          wavesurferRef.current.seekTo(prevTime / duration);
          seekingUntilRef.current = Date.now() + 150;
          setPlaybackCurrentTime?.(prevTime, "ui");
          onTimeUpdate?.(prevTime);
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((prev) => Math.min(prev + 0.1, 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((prev) => Math.max(prev - 0.1, 0));
          break;
        case "KeyM":
          e.preventDefault();
          setVolume((prev) => (prev === 0 ? 1 : 0));
          break;
        case "Equal":
        case "NumpadAdd":
          e.preventDefault();
          setZoom((prev) => Math.min(prev + 0.5, 5));
          break;
        case "Minus":
        case "NumpadSubtract":
          e.preventDefault();
          setZoom((prev) => Math.max(prev - 0.5, 1));
          break;
        case "Digit0":
          // Ctrl+0 重置缩放
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setZoom(1);
          }
          break;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      // Ctrl + 滚轮缩放
      if ((e.ctrlKey || e.metaKey) && waveformRef.current?.contains(e.target as Node)) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.3 : 0.3;
        setZoom((prev) => Math.max(1, Math.min(prev + delta, 5)));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleWheel);
    };
  }, [duration, onTimeUpdate, setPlaybackCurrentTime]);

  // 事件处理优化 - 使用 useCallback
  const togglePlayPause = useCallback(() => {
    if (wavesurferRef.current && !audioError && !isLoading) {
      try {
        wavesurferRef.current.playPause();
      } catch (error) {
        console.error("Playback error:", error);
        setAudioError("播放失败");
      }
    }
  }, [audioError, isLoading]);

  const handleTimestampClick = useCallback(
    (timestamp: VoiceTimestamp) => {
      if (wavesurferRef.current && duration > 0 && !audioError) {
        try {
          wavesurferRef.current.seekTo(timestamp.startTime / duration);
          seekingUntilRef.current = Date.now() + 150;
          setPlaybackCurrentTime?.(timestamp.startTime, "ui");
          onTimeUpdate?.(timestamp.startTime);
          onTimestampClick?.(timestamp);
        } catch (error) {
          console.error("Seek error:", error);
        }
      } else {
        // 即使音频加载失败，也允许点击时间戳来更新 UI
        onTimestampClick?.(timestamp);
      }
    },
    [duration, audioError, onTimeUpdate, onTimestampClick, setPlaybackCurrentTime]
  );

  const handleSeek = useCallback(
    (value: number) => {
      if (wavesurferRef.current && duration > 0 && !audioError) {
        try {
          wavesurferRef.current.seekTo(value / duration);
          seekingUntilRef.current = Date.now() + 150;
          setPlaybackCurrentTime?.(value, "ui");
          // 使用防抖避免过频繁更新
          if (seekTimeoutRef.current) {
            clearTimeout(seekTimeoutRef.current);
          }
          seekTimeoutRef.current = setTimeout(() => {
            onTimeUpdate?.(value);
          }, 50);
        } catch (error) {
          console.error("Seek error:", error);
        }
      } else {
        setPlaybackCurrentTime?.(value, "ui");
        onTimeUpdate?.(value);
      }
    },
    [duration, audioError, onTimeUpdate, setPlaybackCurrentTime]
  );

  const handleVolumeChange = useCallback((value: number) => {
    setVolume(value);
  }, []);

  // 处理 VAD 边界拖拽 - 更新时间戳
  const handleTimestampBoundaryDrag = useCallback(
    (timestamp: VoiceTimestamp, startTime: number, endTime: number) => {
      // 直接更新本地状态，实时显示调整
      const updatedTimestamp = {
        ...timestamp,
        startTime,
        endTime,
      };
      onTimestampClick?.(updatedTimestamp);
    },
    [onTimestampClick]
  );

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (time: number) => {
        const ws = wavesurferRef.current;
        if (!ws || duration <= 0 || audioError) {
          setPlaybackCurrentTime?.(time, "ui");
          onTimeUpdate?.(time);
          return;
        }
        const next = Math.max(0, Math.min(time, duration));
        try {
          seekingUntilRef.current = Date.now() + 150;
          ws.seekTo(next / duration);
          setPlaybackCurrentTime?.(next, "ui");
          onTimeUpdate?.(next);
        } catch (e) {
          console.warn("imperative seek failed:", e);
        }
      },
      playSegment: (startTime: number, endTime: number) => {
        const ws = wavesurferRef.current;
        if (!ws || duration <= 0 || audioError) {
          setPlaybackCurrentTime?.(startTime, "ui");
          onTimeUpdate?.(startTime);
          return;
        }
        const s = Math.max(0, Math.min(startTime, duration));
        const e = Math.max(s, Math.min(endTime, duration));
        segmentEndRef.current = e;
        try {
          seekingUntilRef.current = Date.now() + 150;
          ws.seekTo(s / duration);
          setPlaybackCurrentTime?.(s, "ui");
          onTimeUpdate?.(s);
          ws.play();
        } catch (err) {
          console.warn("playSegment failed:", err);
          segmentEndRef.current = null;
        }
      },
      getDuration: () => duration,
    }),
    [audioError, duration, onTimeUpdate, setPlaybackCurrentTime]
  );

  return (
    <div ref={containerRef} className="space-y-4">
      {audioError && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
          {audioError}
          <div className="text-xs text-muted-foreground mt-1">
            界面仍可正常使用，但无法播放音频。快捷键：空格(播放/暂停)、左右箭头(快进/快退)、上下箭头(音量)
          </div>
        </div>
      )}

      {isLoading && (
        <div className="p-2 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700 flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          加载音频中...
        </div>
      )}

      <div className="relative bg-background rounded-lg overflow-hidden border border-border/50">
        {/* 波形容器 */}
        <div ref={waveformRef} className="w-full" style={{ height: "100px" }} />
        
        {/* Canvas 时间戳叠加层 - 替代 DOM 方式提高性能 */}
        <TimestampOverlay
          timestamps={timestamps}
          duration={duration}
          currentTime={deferredCurrentTime}
          onTimestampClick={handleTimestampClick}
          onTimestampBoundaryDrag={handleTimestampBoundaryDrag}
        />

        {/* 缓冲进度条 */}
        {bufferedPercent > 0 && (
          <div
            className="absolute bottom-0 left-0 h-0.5 bg-primary/30 pointer-events-none"
            style={{ width: `${bufferedPercent}%` }}
          />
        )}
      </div>

      {/* 播放控制栏 */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={togglePlayPause}
          disabled={isLoading}
          title="快捷键: 空格"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        {/* 快进/快退按钮 */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (wavesurferRef.current && duration > 0) {
              const newTime = Math.max(deferredCurrentTime - 5, 0);
              wavesurferRef.current.seekTo(newTime / duration);
              seekingUntilRef.current = Date.now() + 150;
              setPlaybackCurrentTime?.(newTime, "ui");
              onTimeUpdate?.(newTime);
            }
          }}
          title="快退 5 秒 (快捷键: ←)"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          5s
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (wavesurferRef.current && duration > 0) {
              const newTime = Math.min(deferredCurrentTime + 5, duration);
              wavesurferRef.current.seekTo(newTime / duration);
              seekingUntilRef.current = Date.now() + 150;
              setPlaybackCurrentTime?.(newTime, "ui");
              onTimeUpdate?.(newTime);
            }
          }}
          title="快进 5 秒 (快捷键: →)"
        >
          5s
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>

        {/* 进度条、时间显示 */}
        <div className="flex-1 flex items-center gap-2">
          <span className="text-sm text-muted-foreground min-w-[50px]">
            {formatTime(deferredCurrentTime)}
          </span>
          <Slider
            value={[deferredCurrentTime]}
            max={duration}
            step={0.1}
            onValueChange={([value]) => handleSeek(value)}
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground min-w-[50px]">
            {formatTime(duration)}
          </span>
        </div>

        {/* 倍速播放下拉菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" title="倍速播放">
              {playbackRate.toFixed(1)}x
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
              <DropdownMenuItem
                key={rate}
                onClick={() => setPlaybackRate(rate)}
                className={playbackRate === rate ? "bg-accent" : ""}
              >
                {rate.toFixed(2)}x
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 波形缩放按钮 */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setZoom((prev) => Math.max(1, prev - 0.5))}
          title="缩小波形 (快捷键: -)"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>

        <span className="text-xs text-muted-foreground min-w-[35px] text-center">
          {Math.round(zoom * 100)}%
        </span>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setZoom((prev) => Math.min(prev + 0.5, 5))}
          title="放大波形 (快捷键: +)"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>

        {/* 音量控制 */}
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
            onValueChange={([value]) => handleVolumeChange(value)}
            className="w-24"
            title="调节音量 (快捷键: ↑↓, M 静音)"
          />
          <span className="text-xs text-muted-foreground min-w-[35px] text-right">
            {Math.round(volume * 100)}%
          </span>
        </div>
      </div>

      {/* 快捷键提示 */}
      <div className="text-xs text-muted-foreground space-y-1">
        <div>播放控制: Space(播放/暂停) • ←→(快进/快退 5s) • ↑↓(音量调节) • M(静音)</div>
        <div>参数控制: +/-(缩放波形) • Ctrl+0(重置缩放) • Ctrl+滚轮(缩放) • 拖拽 VAD 边界调整时间</div>
      </div>
    </div>
  );
  })
);
