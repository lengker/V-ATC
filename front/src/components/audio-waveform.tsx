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
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Radio,
  Keyboard,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatTime } from "@/lib/utils";
import { createMockWavBlob } from "@/lib/mock-audio";
import { VoiceTimestamp } from "@/types";
import { usePlaybackOptional } from "@/context/PlaybackContext";

export type AudioWaveformHandle = {
  seekTo: (time: number) => void;
  playSegment: (startTime: number, endTime: number) => void;
  getDuration: () => number;
  togglePlayPause: () => void;
  skipBy: (deltaSeconds: number) => void;
  getVolume: () => number;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  getZoom: () => number;
  setZoom: (z: number) => void;
  zoomBy: (delta: number) => void;
  resetZoom: () => void;
};

interface AudioWaveformProps {
  audioUrl: string;
  timestamps?: VoiceTimestamp[];
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
  onTimestampClick?: (timestamp: VoiceTimestamp) => void;
  /** Extra classes on the root wrapper (e.g. padding from parent card). */
  className?: string;
}

// 时间戳叠加层子组件 - 使用Canvas实现高性能渲染 + VAD 边界拖拽
interface TimestampOverlayProps {
  timestamps: VoiceTimestamp[];
  duration: number;
  currentTime: number;
  selectedTimestampId?: string;
  onTimestampClick: (timestamp: VoiceTimestamp) => void;
  onTimestampBoundaryDrag?: (timestamp: VoiceTimestamp, startTime: number, endTime: number) => void;
  /** 按住拖拽波形区时连续跳转播放头（丝滑 scrub） */
  onScrubSeek?: (timeSec: number) => void;
}

const TimestampOverlay = memo(function TimestampOverlay({
  timestamps,
  duration,
  currentTime,
  selectedTimestampId,
  onTimestampClick,
  onTimestampBoundaryDrag,
  onScrubSeek,
}: TimestampOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const deferredTimestamps = useDeferredValue(timestamps);
  const dragStateRef = useRef<{ timestamp: VoiceTimestamp; edge: "start" | "end"; startX: number } | null>(null);
  const scrubRef = useRef<{ pointerId: number; startClientX: number; moved: boolean } | null>(null);

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

    // 清除画布（保持透明，避免遮挡底下的 WaveSurfer 波形）
    ctx.clearRect(0, 0, width, height);

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

  const pickTimeFromClientX = (clientX: number, rect: DOMRect) => {
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const t = rect.width > 0 ? (x / rect.width) * duration : 0;
    return Math.max(0, Math.min(t, duration));
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;

    for (const timestamp of deferredTimestamps) {
      const startX = (timestamp.startTime / duration) * rect.width;
      const endX = (timestamp.endTime / duration) * rect.width;

      if (Math.abs(clickX - startX) < 8) {
        if (onTimestampBoundaryDrag) {
          dragStateRef.current = { timestamp, edge: "start", startX: e.clientX };
          canvas.style.cursor = "ew-resize";
          canvas.setPointerCapture(e.pointerId);
        }
        return;
      }
      if (Math.abs(clickX - endX) < 8) {
        if (onTimestampBoundaryDrag) {
          dragStateRef.current = { timestamp, edge: "end", startX: e.clientX };
          canvas.style.cursor = "ew-resize";
          canvas.setPointerCapture(e.pointerId);
        }
        return;
      }
    }

    // 非边界：进入 scrub / 单击 待定（松手时若未移动则视为选中段）
    if (onScrubSeek) {
      scrubRef.current = { pointerId: e.pointerId, startClientX: e.clientX, moved: false };
      canvas.style.cursor = "grabbing";
      canvas.setPointerCapture(e.pointerId);
      onScrubSeek(pickTimeFromClientX(e.clientX, rect));
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (dragStateRef.current && onTimestampBoundaryDrag) {
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
      return;
    }

    if (scrubRef.current && onScrubSeek) {
      if (Math.abs(e.clientX - scrubRef.current.startClientX) > 3) {
        scrubRef.current.moved = true;
      }
      onScrubSeek(pickTimeFromClientX(e.clientX, rect));
      return;
    }

    let showResizeCursor = false;
    for (const timestamp of deferredTimestamps) {
      const startX = (timestamp.startTime / duration) * rect.width;
      const endX = (timestamp.endTime / duration) * rect.width;
      if (Math.abs(x - startX) < 8 || Math.abs(x - endX) < 8) {
        showResizeCursor = true;
        break;
      }
    }
    canvas.style.cursor = showResizeCursor ? "ew-resize" : "grab";
  };

  const endPointerGesture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (dragStateRef.current) {
      dragStateRef.current = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      canvas.style.cursor = "grab";
      return;
    }

    if (scrubRef.current) {
      const { moved } = scrubRef.current;
      scrubRef.current = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      const rect = canvas.getBoundingClientRect();
      if (!moved) {
        const clickTime = pickTimeFromClientX(e.clientX, rect);
        for (const timestamp of deferredTimestamps) {
          if (clickTime >= timestamp.startTime && clickTime <= timestamp.endTime) {
            onTimestampClick(timestamp);
            break;
          }
        }
      }
      canvas.style.cursor = "grab";
      return;
    }
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={endPointerGesture}
        onPointerCancel={endPointerGesture}
        className="absolute inset-0 touch-none"
        style={{ cursor: "grab" }}
        title="拖拽：移动播放头；单击：选中段；拖 VAD 左右沿：裁剪边界"
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
      className,
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
  const timelineMaxFromCtx = playback?.timelineMax ?? 0;
  const rafRef = useRef<number | null>(null);
  const lastEmitRef = useRef<number>(-1);
  const lastNonZeroVolumeRef = useRef<number>(1);
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
  const isMockSource = !(audioUrl?.trim() ?? "");
  /** WaveSurfer.zoom(minPxPerSec)：「整段适配容器宽度」时的 px/s，再乘以界面 zoom 倍率 */
  const fitMinPxPerSecRef = useRef(50);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const expectedDuration = useDeferredValue(
    timestamps.length > 0 ? Math.max(...timestamps.map((t) => t.endTime)) : 0
  );

  const getLiveDuration = useCallback(() => {
    const ws = wavesurferRef.current;
    const wsDuration = ws ? ws.getDuration() : 0;
    const d = Number.isFinite(wsDuration) && wsDuration > 0 ? wsDuration : 0;
    return Math.max(d, duration, expectedDuration, 0);
  }, [duration, expectedDuration]);

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
      waveColor: "hsl(215 22% 38% / 0.45)",
      progressColor: "hsl(var(--primary))",
      cursorColor: "hsl(210 100% 65%)",
      barWidth: 2,
      barRadius: 4,
      height: 108,
      normalize: true,
      dragToSeek: true,
      interact: true,
    });

    const applyFitZoom = () => {
      const el = waveformRef.current;
      if (!el) return;
      const d = wavesurfer.getDuration();
      if (!d || d <= 0) return;
      const w = el.offsetWidth || 400;
      fitMinPxPerSecRef.current = Math.max(24, w / d);
      try {
        const px = Math.max(16, Math.round(fitMinPxPerSecRef.current * zoomRef.current));
        wavesurfer.zoom(px);
      } catch {
        // decodedData 尚未就绪时可能抛错，忽略
      }
    };

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
      const d = wavesurfer.getDuration();
      const next = Math.max(d, expectedDuration, 0);
      setDuration(next);
      setPlaybackAudioDuration?.(next);
      setIsLoading(false);
      setAudioError(null);
      applyFitZoom();
      try {
        const audio = wavesurfer.getMediaElement();
        if (audio instanceof HTMLAudioElement && audio.buffered.length > 0) {
          const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
          setBufferedPercent((bufferedEnd / wavesurfer.getDuration()) * 100);
        }
      } catch {
        // ignore
      }
    });

    // 播放/暂停事件
    wavesurfer.on("play", () => setIsPlaying(true));
    wavesurfer.on("pause", () => setIsPlaying(false));
    wavesurfer.on("finish", () => setIsPlaying(false));

    // 时间更新事件
    const handleTimeUpdate = (time: number) => {
      // 某些音频源会先返回错误/过小 duration；播放中如果时间超过 duration，动态抬高 UI 的 duration
      if (time > duration) {
        setDuration((prev) => Math.max(prev, time, expectedDuration));
      }
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
    // 某些 backend 下播放过程主要通过 audioprocess 更稳定地推送时间
    wavesurfer.on("audioprocess", handleTimeUpdate);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && waveformRef.current) {
      resizeObserver = new ResizeObserver(() => applyFitZoom());
      resizeObserver.observe(waveformRef.current);
    }

    // 尝试加载音频（若 url 为空，则生成 mock WAV）
    try {
      const rawUrl = audioUrl?.trim() ?? "";
      const shouldUseMockAudio = rawUrl.length === 0;

      if (shouldUseMockAudio) {
        const mockDurationSec = Math.max(timelineMaxFromCtx, expectedDuration, 1);
        const blob = createMockWavBlob({ durationSec: mockDurationSec });
        const maybePromise = wavesurfer.loadBlob(blob) as unknown;
        if (
          maybePromise &&
          typeof (maybePromise as Promise<unknown>).catch === "function"
        ) {
          (maybePromise as Promise<unknown>).catch((error) => {
            if (error instanceof Error && error.name === "AbortError") return;
            console.error("Error loading mock audio blob:", error);
          });
        }
      } else {
        const maybePromise = wavesurfer.load(rawUrl) as unknown;
        if (
          maybePromise &&
          typeof (maybePromise as Promise<unknown>).catch === "function"
        ) {
          (maybePromise as Promise<unknown>).catch((error) => {
            if (error instanceof Error && error.name === "AbortError") return;
            console.error("Error loading audio:", error);
          });
        }
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
      resizeObserver?.disconnect();
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
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [audioUrl, emitTimeUpdate, expectedDuration, setPlaybackAudioDuration, timelineMaxFromCtx, timestamps]);

  // 播放时用 rAF 轮询 currentTime，确保进度条/时间稳定前进
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastEmitRef.current = -1;
      return;
    }

    const tick = () => {
      const ws = wavesurferRef.current;
      if (ws) {
        try {
          const t = ws.getCurrentTime();
          // 降低抖动：只有明显变化才推送
          if (Math.abs(t - lastEmitRef.current) >= 0.05) {
            lastEmitRef.current = t;
            emitTimeUpdate(t);
          }
        } catch {
          // ignore
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastEmitRef.current = -1;
    };
  }, [isPlaying, emitTimeUpdate]);

  // 外部时间变化时，同步 wavesurfer 播放头（解决 TimeRover/列表点击后波形不同步）
  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws || audioError) return;
    if (Date.now() < seekingUntilRef.current) return;

    const liveDuration = getLiveDuration();
    if (liveDuration <= 0) return;
    const next = Math.max(0, Math.min(deferredCurrentTime, liveDuration));
    try {
      const wsTime = ws.getCurrentTime();
      if (Math.abs(wsTime - next) < 0.15) return;
      ws.seekTo(Math.max(0, Math.min(1, next / liveDuration)));
    } catch (e) {
      console.warn("Failed to sync external time:", e);
    }
  }, [deferredCurrentTime, audioError, getLiveDuration]);

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

  // 同步波形缩放（minPxPerSec = 适配宽度基准 × UI 倍率，见 WaveSurfer.zoom 文档）
  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    try {
      if (ws.getDuration() <= 0) return;
      const el = waveformRef.current;
      if (el) {
        const w = el.offsetWidth || 400;
        const d = ws.getDuration();
        fitMinPxPerSecRef.current = Math.max(24, w / d);
      }
      const px = Math.max(16, Math.round(fitMinPxPerSecRef.current * zoom));
      ws.zoom(px);
    } catch (e) {
      if (e instanceof Error && e.message.includes("No audio loaded")) return;
      console.warn("Failed to set zoom:", e);
    }
  }, [zoom]);

  // 同步音量并持久化
  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(volume);
      localStorage.setItem("audio-waveform-volume", volume.toString());
    }
    if (volume > 0) lastNonZeroVolumeRef.current = volume;
  }, [volume]);

  // Ctrl + 滚轮缩放（仅当鼠标在波形区域上）
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if ((e.ctrlKey || e.metaKey) && waveformRef.current?.contains(e.target as Node)) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.3 : 0.3;
        setZoom((prev) => Math.max(1, Math.min(prev + delta, 5)));
      }
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, []);

  // 事件处理优化 - 使用 useCallback
  const togglePlayPause = useCallback(() => {
    // 不要被 isLoading 挡住：有些音频 ready 事件会延迟/缺失，但 play 仍可触发
    if (wavesurferRef.current && !audioError) {
      try {
        wavesurferRef.current.playPause();
      } catch (error) {
        console.error("Playback error:", error);
        setAudioError("播放失败");
      }
    }
  }, [audioError]);

  const handleTimestampClick = useCallback(
    (timestamp: VoiceTimestamp) => {
      if (wavesurferRef.current && duration > 0 && !audioError) {
        try {
          const liveDuration = getLiveDuration();
          if (liveDuration > 0) {
            wavesurferRef.current.seekTo(Math.max(0, Math.min(1, timestamp.startTime / liveDuration)));
          }
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
    [duration, audioError, onTimeUpdate, onTimestampClick, setPlaybackCurrentTime, getLiveDuration]
  );

  const handleSeek = useCallback(
    (value: number) => {
      if (wavesurferRef.current && duration > 0 && !audioError) {
        try {
          const liveDuration = getLiveDuration();
          if (liveDuration > 0) {
            wavesurferRef.current.seekTo(Math.max(0, Math.min(1, value / liveDuration)));
          }
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
    [duration, audioError, onTimeUpdate, setPlaybackCurrentTime, getLiveDuration]
  );

  const handleScrubSeek = useCallback(
    (t: number) => {
      seekingUntilRef.current = Date.now() + 900;
      const ws = wavesurferRef.current;
      const liveDuration = getLiveDuration();
      if (ws && liveDuration > 0 && !audioError) {
        try {
          ws.seekTo(Math.max(0, Math.min(1, t / liveDuration)));
        } catch {
          // ignore
        }
      }
      setPlaybackCurrentTime?.(t, "ui");
      onTimeUpdate?.(t);
    },
    [audioError, getLiveDuration, onTimeUpdate, setPlaybackCurrentTime]
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
        const liveDuration = getLiveDuration();
        const next = Math.max(0, Math.min(time, liveDuration));
        try {
          seekingUntilRef.current = Date.now() + 150;
          ws.seekTo(liveDuration > 0 ? Math.max(0, Math.min(1, next / liveDuration)) : 0);
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
        const liveDuration = getLiveDuration();
        const s = Math.max(0, Math.min(startTime, liveDuration));
        const e = Math.max(s, Math.min(endTime, liveDuration));
        segmentEndRef.current = e;
        try {
          seekingUntilRef.current = Date.now() + 150;
          ws.seekTo(liveDuration > 0 ? Math.max(0, Math.min(1, s / liveDuration)) : 0);
          setPlaybackCurrentTime?.(s, "ui");
          onTimeUpdate?.(s);
          ws.play();
        } catch (err) {
          console.warn("playSegment failed:", err);
          segmentEndRef.current = null;
        }
      },
      getDuration: () => getLiveDuration(),
      togglePlayPause: () => {
        togglePlayPause();
      },
      skipBy: (deltaSeconds: number) => {
        const ws = wavesurferRef.current;
        const liveDuration = getLiveDuration();
        const baseTime = ws ? ws.getCurrentTime() : deferredCurrentTime;
        const maxT = liveDuration > 0 ? liveDuration : Math.max(duration, expectedDuration, baseTime);
        const next = Math.max(0, Math.min(baseTime + deltaSeconds, maxT));
        try {
          seekingUntilRef.current = Date.now() + 150;
          if (ws && maxT > 0 && !audioError) {
            ws.seekTo(Math.max(0, Math.min(1, next / maxT)));
          }
          setPlaybackCurrentTime?.(next, "ui");
          onTimeUpdate?.(next);
        } catch {
          // ignore
        }
      },
      getVolume: () => volume,
      setVolume: (v: number) => {
        const next = Math.max(0, Math.min(1, v));
        setVolume(next);
      },
      toggleMute: () => {
        setVolume((prev) => {
          if (prev === 0) return Math.max(0.05, Math.min(1, lastNonZeroVolumeRef.current || 1));
          return 0;
        });
      },
      getZoom: () => zoom,
      setZoom: (z: number) => {
        const next = Math.max(1, Math.min(5, z));
        setZoom(next);
      },
      zoomBy: (delta: number) => {
        setZoom((prev) => Math.max(1, Math.min(5, prev + delta)));
      },
      resetZoom: () => setZoom(1),
    }),
    [
      audioError,
      deferredCurrentTime,
      duration,
      getLiveDuration,
      onTimeUpdate,
      setPlaybackCurrentTime,
      togglePlayPause,
      volume,
      zoom,
    ]
  );

  return (
    <div ref={containerRef} className={cn("space-y-4", className)}>
      {/* 标题与状态 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/25">
            <Radio className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">波形与播放</h3>
            <p className="text-xs text-muted-foreground">
              按住拖拽波形可连续移动播放头；单击选中段；拖 VAD 左右沿裁剪边界
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
              isMockSource
                ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            )}
          >
            {isMockSource ? "演示音频" : "已加载音源"}
          </span>
          {isPlaying ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              播放中
            </span>
          ) : null}
        </div>
      </div>

      {audioError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">{audioError}</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            仍可浏览时间轴与转写；恢复 URL 后即可播放。快捷键：空格、←→、↑↓、M。
          </p>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          解码波形与缓冲中…
        </div>
      )}

      <div className="audio-waveform-shell relative overflow-hidden rounded-2xl border border-border/40 ring-1 ring-white/5">
        <div ref={waveformRef} className="w-full" style={{ height: "108px" }} />

        <TimestampOverlay
          timestamps={timestamps}
          duration={duration}
          currentTime={deferredCurrentTime}
          onTimestampClick={handleTimestampClick}
          onTimestampBoundaryDrag={handleTimestampBoundaryDrag}
          onScrubSeek={handleScrubSeek}
        />

        {bufferedPercent > 0 && (
          <div
            className="absolute bottom-0 left-0 h-0.5 bg-primary/35 pointer-events-none transition-[width] duration-300"
            style={{ width: `${bufferedPercent}%` }}
          />
        )}
      </div>

      <div className="audio-control-cluster">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="default"
            size="icon"
            className="h-10 w-10 rounded-xl shadow-sm"
            onClick={togglePlayPause}
            title="播放 / 暂停（空格）"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 rounded-xl gap-0.5 px-2"
            onClick={() => {
              if (wavesurferRef.current && duration > 0) {
                const newTime = Math.max(deferredCurrentTime - 5, 0);
                const liveDuration = getLiveDuration();
                if (liveDuration > 0) {
                  wavesurferRef.current.seekTo(Math.max(0, Math.min(1, newTime / liveDuration)));
                }
                seekingUntilRef.current = Date.now() + 150;
                setPlaybackCurrentTime?.(newTime, "ui");
                onTimeUpdate?.(newTime);
              }
            }}
            title="快退 5 秒（←）"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="text-xs">5s</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 rounded-xl gap-0.5 px-2"
            onClick={() => {
              if (wavesurferRef.current && duration > 0) {
                const newTime = Math.min(deferredCurrentTime + 5, duration);
                const liveDuration = getLiveDuration();
                if (liveDuration > 0) {
                  wavesurferRef.current.seekTo(Math.max(0, Math.min(1, newTime / liveDuration)));
                }
                seekingUntilRef.current = Date.now() + 150;
                setPlaybackCurrentTime?.(newTime, "ui");
                onTimeUpdate?.(newTime);
              }
            }}
            title="快进 5 秒（→）"
          >
            <span className="text-xs">5s</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="hidden h-8 w-px bg-border/70 sm:block" aria-hidden />

        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="w-[4.25rem] shrink-0 font-mono tabular-nums text-xs text-muted-foreground">
            {formatTime(deferredCurrentTime)}
          </span>
          <Slider
            value={[deferredCurrentTime]}
            max={duration || 1}
            step={0.1}
            onValueChange={([value]) => handleSeek(value)}
            className="flex-1 py-1"
          />
          <span className="w-[4.25rem] shrink-0 text-right font-mono tabular-nums text-xs text-muted-foreground">
            {formatTime(duration)}
          </span>
        </div>

        <div className="hidden h-8 w-px bg-border/70 md:block" aria-hidden />

        <div className="flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 min-w-[3.25rem] rounded-xl" title="播放倍速">
                {playbackRate.toFixed(2)}×
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[8rem]">
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                <DropdownMenuItem
                  key={rate}
                  onClick={() => setPlaybackRate(rate)}
                  className={cn("font-mono", playbackRate === rate && "bg-accent")}
                >
                  {rate.toFixed(2)}×
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center gap-0.5 rounded-xl border border-border/50 bg-background/40 px-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => setZoom((prev) => Math.max(1, prev - 0.5))}
              title="缩小波形（-）"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="min-w-[2.75rem] text-center font-mono text-[11px] text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => setZoom((prev) => Math.min(prev + 0.5, 5))}
              title="放大波形（+）"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-background/40 px-2 py-1">
            {volume === 0 ? (
              <VolumeX className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <Slider
              value={[volume]}
              max={1}
              step={0.01}
              onValueChange={([value]) => handleVolumeChange(value)}
              className="w-[5.5rem]"
              title="音量（↑↓ / M 静音）"
            />
            <span className="w-8 text-right font-mono text-[11px] text-muted-foreground">
              {Math.round(volume * 100)}
            </span>
          </div>
        </div>
      </div>

      <details className="group rounded-xl border border-border/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground open:bg-muted/30">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-foreground/90 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
          <Keyboard className="h-3.5 w-3.5 text-primary" />
          键盘与手势快捷键
          <span className="ml-auto text-[10px] font-normal text-muted-foreground group-open:hidden">展开</span>
          <span className="ml-auto hidden text-[10px] font-normal text-muted-foreground group-open:inline">收起</span>
        </summary>
        <ul className="mt-2 space-y-1.5 border-t border-border/40 pt-2 pl-1 leading-relaxed">
          <li>
            <span className="text-foreground/80">播放</span>：Space · ← / → 快退快进 5s · ↑ / ↓ 音量 · M 静音
          </li>
          <li>
            <span className="text-foreground/80">波形</span>：+ / − 横向放大缩小（相对整段铺满宽度）· Ctrl+0 重置 · Ctrl+滚轮在波形区缩放
          </li>
          <li>
            <span className="text-foreground/80">标注</span>：点击段落跳转；拖拽 VAD 左右边界调整起止时间
          </li>
        </ul>
      </details>
    </div>
  );
  })
);
