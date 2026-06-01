"use client";

import { memo, useState, useEffect, useCallback, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { AudioWaveform, type AudioWaveformHandle } from "@/components/audio-waveform";
import { TimestampList } from "@/components/timestamp-list";
import { TranscriptTimelineEditor } from "@/components/transcript-timeline-editor";
import { AuxiliaryInfo } from "@/components/auxiliary-info";
import { EfbTopbar } from "@/components/efb-topbar";
import { EfbBottomNav } from "@/components/efb-bottom-nav";
import { InstrumentPanel } from "@/components/instrument-panel";
import { LayerToggles, type LayerTogglesState } from "@/components/layer-toggles";
import { TimeRover } from "@/components/time-rover";
import { TargetsPanel } from "@/components/targets-panel";
import { RecordingsPanel } from "@/components/recordings-panel";
import { QianwenAgentWidget } from "@/components/qianwen-agent-widget";
import { ErrorBoundary } from "@/components/error-boundary";
import { AudioData, ADSBData, VoiceTimestamp } from "@/types";
import { audioAPI } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { vhhhStatic } from "@/mock/vhhh-static";
import { exportAsJson, exportAnnotationPackage, exportTimestampsAsCsv } from "@/lib/exporters";
import {
  applyTimestampOverrides,
  loadTimestampOverrides,
  saveTimestampOverride,
  saveFullTimestamps,
} from "@/lib/local-annotation-store";
import { storeTranscriptSegments } from "@/lib/transcript-store";
import { PlaybackProvider, usePlayback } from "@/context/PlaybackContext";
import {
  isRecordingTimelineAligned,
  matchesFlightKey,
  primaryCallsignForRecording,
  recordingHasTimelineAdsb,
  recordingTrackSummary,
  resolvePrimaryAircraftKey,
  resolveBestRecordingUtcStartSec,
  timelineAdsbPoints,
} from "@/lib/recording-adsb-alignment";
import { useRecordingsSync } from "@/context/recordings-sync-context";
import { pickRecordingBySearchQuery } from "@/lib/global-search";
import { buildAgentWorkspaceSnapshot } from "@/lib/agent-workspace-context";
import {
  applyAgentTranscriptOps,
  type AgentTranscriptOps,
} from "@/lib/agent-transcript-ops";
import { getRecordingDisplayName } from "@/lib/recording-display";
import { recordingTimelineMax } from "@/lib/utils";

function timestampsSignature(ts: { id: string; startTime: number; endTime: number }[]) {
  if (!ts.length) return "0";
  const head = ts[0];
  const tail = ts[ts.length - 1];
  return `${ts.length}:${head.id}:${head.startTime}:${tail.id}:${tail.endTime}`;
}

// 动态导入地图组件，禁用 SSR
const ADSBMap = dynamic(() => import("@/components/adsb-map-leaflet").then((mod) => ({ default: mod.ADSBMap })), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-muted rounded-lg">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-sm text-muted-foreground">加载地图中...</p>
      </div>
    </div>
  ),
});

interface AnnotationPageProps {
  audioData: AudioData;
  adsbData: ADSBData[];
  /** OpenSky 实时全量（与录音对齐层分离，保证地图上始终有真实机 */
  mapLiveAdsb?: ADSBData[];
  /** 地图轮询版本号，强制航迹/标记重绘 */
  adsbMapRevision?: number;
  onSelectRecording?: (id: string) => void;
}

function RecordingsPanelSlot({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const {
    recordings,
    recordingMeta,
    updatedAt,
    syncing,
    pendingTranscriptCount,
    onUpdateOneRecording,
    onTranscribeSelected,
    onDeleteRecording,
    deletingRecordingId,
    onBatchExport,
    batchExporting,
    batchExportProgress,
  } = useRecordingsSync();
  return (
    <RecordingsPanel
      recordings={recordings}
      activeId={activeId}
      onSelect={onSelect}
      recordingMeta={recordingMeta}
      updatedAt={updatedAt}
      syncing={syncing}
      pendingTranscriptCount={pendingTranscriptCount}
      onUpdateOneRecording={onUpdateOneRecording}
      onTranscribeSelected={onTranscribeSelected}
      onDeleteRecording={onDeleteRecording}
      deletingRecordingId={deletingRecordingId}
      onBatchExport={onBatchExport}
      batchExporting={batchExporting}
      batchExportProgress={batchExportProgress}
    />
  );
}

function AnnotationPageComponent({
  audioData,
  adsbData,
  mapLiveAdsb = [],
  adsbMapRevision = 0,
  onSelectRecording,
}: AnnotationPageProps) {
  const [timestamps, setTimestamps] = useState<VoiceTimestamp[]>(() => {
    // 初次加载：合并本地保存的 override（无后端也能持久化）
    if (typeof window === "undefined") return audioData.timestamps;
    try {
      const fullRaw = localStorage.getItem(`alpha.timestamps.full.${audioData.id}`);
      if (fullRaw) {
        const full = JSON.parse(fullRaw) as VoiceTimestamp[];
        if (Array.isArray(full) && full.length > 0) return full;
      }
    } catch {
      // ignore
    }
    const overrides = loadTimestampOverrides(audioData.id);
    return applyTimestampOverrides(audioData.timestamps, overrides);
  });

  const timelineMax = useMemo(
    () =>
      Math.max(
        recordingTimelineMax(audioData.duration || 0, timestamps),
        Number(audioData.duration) || 0,
        1
      ),
    [audioData.duration, timestamps]
  );

  // 同步 audioData：服务端已有 ASR 时优先用服务端，避免空本地缓存盖住新转写
  useEffect(() => {
    const serverTs = audioData.timestamps ?? [];
    const storageKey = `alpha.timestamps.full.${audioData.id}`;
    if (serverTs.length > 0) {
      try {
        const fullRaw = localStorage.getItem(storageKey);
        if (fullRaw) {
          const full = JSON.parse(fullRaw) as VoiceTimestamp[];
          if (!Array.isArray(full) || full.length === 0) {
            localStorage.removeItem(storageKey);
          } else if (full.length < serverTs.length) {
            localStorage.removeItem(storageKey);
          }
        }
      } catch {
        // ignore
      }
      const overrides = loadTimestampOverrides(audioData.id);
      setTimestamps(applyTimestampOverrides(serverTs, overrides));
      return;
    }
    try {
      const fullRaw = localStorage.getItem(storageKey);
      if (fullRaw) {
        const full = JSON.parse(fullRaw) as VoiceTimestamp[];
        if (Array.isArray(full) && full.length > 0) {
          setTimestamps(full);
          return;
        }
      }
    } catch {
      // ignore
    }
    const overrides = loadTimestampOverrides(audioData.id);
    setTimestamps(applyTimestampOverrides(serverTs, overrides));
  }, [audioData.id, audioData.timestamps]);

  return (
    <PlaybackProvider key={audioData.id} timelineMax={timelineMax || 60} initialTime={0}>
      <AnnotationPageInner
        audioData={audioData}
        adsbData={adsbData}
        mapLiveAdsb={mapLiveAdsb}
        adsbMapRevision={adsbMapRevision}
        onSelectRecording={onSelectRecording}
        timestamps={timestamps}
        setTimestamps={setTimestamps}
        timelineMax={timelineMax || 60}
      />
    </PlaybackProvider>
  );
}

export const AnnotationPage = memo(
  AnnotationPageComponent,
  (prev, next) => {
    if (
      prev.onSelectRecording !== next.onSelectRecording ||
      prev.adsbData !== next.adsbData ||
      prev.mapLiveAdsb !== next.mapLiveAdsb ||
      prev.adsbMapRevision !== next.adsbMapRevision
    ) {
      return false;
    }
    const pa = prev.audioData;
    const na = next.audioData;
    if (pa.id !== na.id || pa.url !== na.url) return false;
    return timestampsSignature(pa.timestamps ?? []) === timestampsSignature(na.timestamps ?? []);
  }
);

type AnnotationPageInnerProps = {
  audioData: AudioData;
  adsbData: ADSBData[];
  mapLiveAdsb?: ADSBData[];
  adsbMapRevision?: number;
  onSelectRecording?: (id: string) => void;
  timestamps: VoiceTimestamp[];
  setTimestamps: React.Dispatch<React.SetStateAction<VoiceTimestamp[]>>;
  timelineMax: number;
};

function AnnotationPageInner({
  audioData,
  adsbData,
  mapLiveAdsb = [],
  adsbMapRevision = 0,
  onSelectRecording,
  timestamps,
  setTimestamps,
  timelineMax,
}: AnnotationPageInnerProps) {
  const { currentTime, setCurrentTime } = usePlayback();
  const { transcriptLoading, liveAdsbStatus, recordings, recordingMeta } = useRecordingsSync();
  const [selectedTimestamp, setSelectedTimestamp] = useState<VoiceTimestamp | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<string | undefined>();
  const { toast } = useToast();
  const [layerToggles, setLayerToggles] = useState<LayerTogglesState>({
    runways: true,
    taxiways: true,
    waypoints: true,
    landmarks: true,
    trails: true,
    routes: true,
    obstacles: true,
  });
  const [visibleAircraftSet, setVisibleAircraftSet] = useState<Set<string>>(new Set());
  const userPickedAircraftRef = useRef(false);
  const [activeBottomTab, setActiveBottomTab] = useState<
    "map" | "transcripts" | "radio" | "audio" | "settings"
  >("transcripts");
  const [globalSearch, setGlobalSearch] = useState("");
  const [targetsFilterQuery, setTargetsFilterQuery] = useState("");
  const agentWorkspace = useMemo(
    () =>
      buildAgentWorkspaceSnapshot({
        audioData,
        timestamps,
        adsbData,
        recordings,
        recordingMeta,
        currentTime,
        timelineMaxSec: timelineMax,
        selectedAircraft,
        selectedTimestamp,
        visibleAircraftSet,
        liveAdsbStatus,
      }),
    [
      audioData,
      timestamps,
      adsbData,
      recordings,
      recordingMeta,
      currentTime,
      timelineMax,
      selectedAircraft,
      selectedTimestamp,
      visibleAircraftSet,
      liveAdsbStatus,
    ]
  );
  const mapSectionRef = useRef<HTMLDivElement>(null);
  const audioWaveformRef = useRef<AudioWaveformHandle>(null);
  const [waveformPlaying, setWaveformPlaying] = useState(false);
  const [mapContinueLive, setMapContinueLive] = useState(false);
  const [mapLiveRealtimeMode, setMapLiveRealtimeMode] = useState(false);
  const useLivePanelClock =
    mapLiveRealtimeMode && !waveformPlaying && !mapContinueLive;
  const transcriptSectionRef = useRef<HTMLDivElement>(null);
  const radioSectionRef = useRef<HTMLDivElement>(null);
  const audioSectionRef = useRef<HTMLDivElement>(null);
  const settingsSectionRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSection = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    el.classList.add("efb-section-flash");
    flashTimerRef.current = setTimeout(() => {
      el.classList.remove("efb-section-flash");
      flashTimerRef.current = null;
    }, 1400);
  }, []);

  const fullSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backendSyncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFullDraftRef = useRef<VoiceTimestamp[] | null>(null);
  const timestampsSnapshotRef = useRef<VoiceTimestamp[]>(timestamps);
  timestampsSnapshotRef.current = timestamps;

  const syncDirtySegmentsToBackend = useCallback(
    async (prev: VoiceTimestamp[], next: VoiceTimestamp[]) => {
      if (!audioData.url) return;
      const prevMap = new Map(prev.map((t) => [t.id, t]));
      for (const t of next) {
        const old = prevMap.get(t.id);
        if (!old) continue;
        if (
          old.text === t.text &&
          old.startTime === t.startTime &&
          old.endTime === t.endTime &&
          (old.speaker ?? "") === (t.speaker ?? "")
        ) {
          continue;
        }
        const annotationId = Number(t.id);
        if (!Number.isFinite(annotationId)) continue;
        try {
          await audioAPI.updateTimestamp(audioData.id, t);
        } catch {
          // 本地已保存，后端失败不阻塞编辑
        }
      }
    },
    [audioData.id, audioData.url]
  );

  // audioId 切换/组件卸载时，清理未完成的防抖写入
  useEffect(() => {
    return () => {
      if (fullSaveDebounceRef.current) {
        clearTimeout(fullSaveDebounceRef.current);
        fullSaveDebounceRef.current = null;
      }
      if (backendSyncDebounceRef.current) {
        clearTimeout(backendSyncDebounceRef.current);
        backendSyncDebounceRef.current = null;
      }
    };
  }, [audioData.id]);

  // 全局快捷键：统一绑定在页面层，避免组件各自绑定导致冲突/重复触发
  useEffect(() => {
    const shouldIgnore = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (shouldIgnore(e.target)) return;

      const wf = audioWaveformRef.current;
      if (!wf) return;

      // Keep behavior consistent with the old AudioWaveform-level shortcuts.
      switch (e.code) {
        case "Space": {
          e.preventDefault();
          wf.togglePlayPause();
          return;
        }
        case "ArrowRight": {
          e.preventDefault();
          wf.skipBy(5);
          return;
        }
        case "ArrowLeft": {
          e.preventDefault();
          wf.skipBy(-5);
          return;
        }
        case "ArrowUp": {
          e.preventDefault();
          wf.setVolume(wf.getVolume() + 0.1);
          return;
        }
        case "ArrowDown": {
          e.preventDefault();
          wf.setVolume(wf.getVolume() - 0.1);
          return;
        }
        case "KeyM": {
          e.preventDefault();
          wf.toggleMute();
          return;
        }
        case "Equal":
        case "NumpadAdd": {
          e.preventDefault();
          wf.zoomBy(0.5);
          return;
        }
        case "Minus":
        case "NumpadSubtract": {
          e.preventDefault();
          wf.zoomBy(-0.5);
          return;
        }
        case "Digit0": {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            wf.resetZoom();
          }
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSetTimestamps = useCallback(
    (next: VoiceTimestamp[]) => {
      const prev = timestampsSnapshotRef.current;
      setTimestamps(next);
      timestampsSnapshotRef.current = next;
      if (typeof window !== "undefined") {
        latestFullDraftRef.current = next;
        if (fullSaveDebounceRef.current) {
          clearTimeout(fullSaveDebounceRef.current);
        }
        fullSaveDebounceRef.current = setTimeout(() => {
          const latest = latestFullDraftRef.current;
          if (!latest) return;
          try {
            storeTranscriptSegments(audioData.id, latest);
          } catch {
            // ignore
          }
        }, 600);

        if (backendSyncDebounceRef.current) {
          clearTimeout(backendSyncDebounceRef.current);
        }
        backendSyncDebounceRef.current = setTimeout(() => {
          const latest = latestFullDraftRef.current;
          if (!latest) return;
          void syncDirtySegmentsToBackend(prev, latest);
        }, 1500);
      }
    },
    [audioData.id, syncDirtySegmentsToBackend]
  );

  // 从音频数据中提取所有唯一的飞机 ICAO24
  const mergedAdsbPool = useMemo(
    () => [...adsbData, ...mapLiveAdsb],
    [adsbData, mapLiveAdsb]
  );

  const aircraftList = useMemo(
    () => Array.from(new Set(mergedAdsbPool.map((d) => d.icao24))),
    [mergedAdsbPool]
  );

  const primaryRecordingAircraft = useMemo(
    () => resolvePrimaryAircraftKey(audioData, mergedAdsbPool),
    [audioData, mergedAdsbPool]
  );

  const recordingUtcStartSec = useMemo(
    () => resolveBestRecordingUtcStartSec(audioData, mergedAdsbPool, primaryRecordingAircraft),
    [audioData, mergedAdsbPool, primaryRecordingAircraft]
  );

  /** 切换录音：选中主目标并显示该时段全部飞机（组件 remount 时 prevAudioId 初值会等于新 id，不能靠 !== 判断） */
  useEffect(() => {
    userPickedAircraftRef.current = false;
    setMapContinueLive(false);
    const primary = resolvePrimaryAircraftKey(audioData, mergedAdsbPool);
    if (primary) {
      setSelectedAircraft(primary);
      const vis = new Set<string>([primary.toLowerCase()]);
      const row = mergedAdsbPool.find((p) => matchesFlightKey(p, primary));
      if (row?.callsign?.trim()) vis.add(row.callsign.trim().toLowerCase());
      setVisibleAircraftSet(vis);
    } else {
      setVisibleAircraftSet(new Set());
      setSelectedAircraft(undefined);
    }
  }, [audioData.id]);

  /** 航迹数据晚于录音到达时，补选主目标（仅当用户尚未手动点选其他机） */
  useEffect(() => {
    if (!primaryRecordingAircraft || userPickedAircraftRef.current) return;
    setSelectedAircraft(primaryRecordingAircraft);
    setVisibleAircraftSet((prev) => {
      const next = new Set(prev);
      const pk = primaryRecordingAircraft.toLowerCase();
      next.add(pk);
      const row = mergedAdsbPool.find((p) => matchesFlightKey(p, pk));
      if (row?.callsign?.trim()) next.add(row.callsign.trim().toLowerCase());
      return next;
    });
  }, [primaryRecordingAircraft]);

  // 处理时间戳点击：跳转波形并播放该段
  const handleTimestampClick = useCallback((timestamp: VoiceTimestamp) => {
    setSelectedTimestamp(timestamp);
    setCurrentTime(timestamp.startTime, "ui");
    audioWaveformRef.current?.playSegment(timestamp.startTime, timestamp.endTime);
  }, [setCurrentTime]);

  const handleWaveformSeek = useCallback(
    (t: number) => {
      const dur = audioData.duration || timelineMax || 60;
      if (t < dur - 0.05) setMapContinueLive(false);
      setCurrentTime(t, "waveform");
      audioWaveformRef.current?.seekTo(t);
    },
    [audioData.duration, setCurrentTime, timelineMax]
  );

  const handleWaveformStep = useCallback((delta: number) => {
    audioWaveformRef.current?.skipBy(delta);
  }, []);

  const handleTranscriptSeek = useCallback(
    (time: number) => {
      const seg =
        timestamps.find((ts) => time >= ts.startTime && time <= ts.endTime) ??
        timestamps.find((ts) => Math.abs(ts.startTime - time) < 0.08);
      if (seg) {
        setSelectedTimestamp(seg);
        audioWaveformRef.current?.playSegment(seg.startTime, seg.endTime);
        return;
      }
      audioWaveformRef.current?.playFrom(time);
    },
    [timestamps]
  );

  // 保存时间戳编辑
  const handleSaveTimestamp = useCallback(
    async (updatedTimestamp: VoiceTimestamp) => {
      try {
        // Mock 模式（未接入后端音频/接口）：直接本地保存，避免请求 localhost:8000 报错刷屏
        if (!audioData.url) {
          const updatedTimestamps = timestamps.map((ts) =>
            ts.id === updatedTimestamp.id ? updatedTimestamp : ts
          );
          setTimestamps(updatedTimestamps);
          saveTimestampOverride(audioData.id, updatedTimestamp);
          toast({
            title: "已本地保存",
            description: "当前为 mock 模式（未接后端），已保存到浏览器本地（待后续同步）",
          });
          setSelectedTimestamp(null);
          return;
        }

        const response = await audioAPI.updateTimestamp(
          audioData.id,
          updatedTimestamp
        );

        // 无后端/接口失败也允许本地保存
        if (response.success) {
          // 更新本地数据
          const updatedTimestamps = timestamps.map((ts) =>
            ts.id === updatedTimestamp.id ? updatedTimestamp : ts
          );
          setTimestamps(updatedTimestamps);
          saveTimestampOverride(audioData.id, updatedTimestamp);
          try {
            localStorage.setItem(`alpha.timestamps.full.${audioData.id}`, JSON.stringify(updatedTimestamps));
          } catch {
            // ignore
          }

          toast({
            title: "成功",
            description: "时间戳已更新",
          });
          setSelectedTimestamp(null);
        } else {
          // fallback：本地保存
          const updatedTimestamps = timestamps.map((ts) =>
            ts.id === updatedTimestamp.id ? updatedTimestamp : ts
          );
          setTimestamps(updatedTimestamps);
          saveTimestampOverride(audioData.id, updatedTimestamp);
          try {
            localStorage.setItem(`alpha.timestamps.full.${audioData.id}`, JSON.stringify(updatedTimestamps));
          } catch {
            // ignore
          }
          toast({
            title: "已本地保存",
            description: "后端未就绪/保存失败，已先保存到浏览器本地（待后续同步）",
          });
          setSelectedTimestamp(null);
        }
      } catch (error) {
        // fallback：本地保存
        const updatedTimestamps = timestamps.map((ts) =>
          ts.id === updatedTimestamp.id ? updatedTimestamp : ts
        );
        setTimestamps(updatedTimestamps);
        saveTimestampOverride(audioData.id, updatedTimestamp);
        try {
          localStorage.setItem(`alpha.timestamps.full.${audioData.id}`, JSON.stringify(updatedTimestamps));
        } catch {
          // ignore
        }
        toast({
          title: "已本地保存",
          description: "网络/后端异常，已先保存到浏览器本地（待后续同步）",
        });
        setSelectedTimestamp(null);
      }
    },
    [audioData.id, audioData.url, timestamps, toast]
  );

  const findSegmentAtPlayhead = useCallback(() => {
    return (
      timestamps.find((t) => currentTime >= t.startTime && currentTime <= t.endTime) ?? null
    );
  }, [currentTime, timestamps]);

  const persistTimestamps = useCallback(
    async (next: VoiceTimestamp[], changed: VoiceTimestamp[]) => {
      setTimestamps(next);
      for (const t of changed) {
        saveTimestampOverride(audioData.id, t);
      }
      try {
        localStorage.setItem(`alpha.timestamps.full.${audioData.id}`, JSON.stringify(next));
      } catch {
        // ignore
      }
      if (audioData.url) {
        for (const t of changed) {
          try {
            await audioAPI.updateTimestamp(audioData.id, t);
          } catch {
            // 已写入本地
          }
        }
      }
    },
    [audioData.id, audioData.url]
  );

  const handleApplyAiTranscriptOps = useCallback(
    async (ops: AgentTranscriptOps) => {
      const result = applyAgentTranscriptOps(timestamps, ops);
      if (!result.applied) {
        toast({
          title: "未应用编辑",
          description: result.message,
          variant: "destructive",
        });
        return;
      }
      handleSetTimestamps(result.next);
      const firstMerged = result.next[0];
      if (firstMerged) setSelectedTimestamp(firstMerged);
      toast({
        title: "已应用智能体编辑",
        description: result.message,
      });
    },
    [handleSetTimestamps, timestamps, toast]
  );

  // 智能体 suggestedText：自动落到选中段 / 播放头段 / 全部段（不再要求「左侧」点录音列表）
  const handleApplyAiSuggestedText = useCallback(
    async (text: string, opts?: { applyToAll?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      let targets: VoiceTimestamp[] = [];
      if (opts?.applyToAll) {
        targets = [...timestamps];
      } else if (selectedTimestamp) {
        targets = [selectedTimestamp];
      } else {
        const atPlayhead = findSegmentAtPlayhead();
        if (atPlayhead) targets = [atPlayhead];
        else if (timestamps.length === 1) targets = [timestamps[0]];
        else if (timestamps.length > 0) targets = [...timestamps];
      }

      if (!targets.length) {
        toast({
          title: "暂无语音片段",
          description: "请先完成转写，或在语音剪辑区手动添加一段。",
          variant: "destructive",
        });
        return;
      }

      const targetIds = new Set(targets.map((t) => t.id));
      const changed = targets.map((t) => ({ ...t, text: trimmed }));
      const next = timestamps.map((ts) =>
        targetIds.has(ts.id) ? { ...ts, text: trimmed } : ts
      );
      await persistTimestamps(next, changed);

      const primary = targets[0];
      if (primary) setSelectedTimestamp({ ...primary, text: trimmed });

      toast({
        title: targets.length > 1 ? `已写入 ${targets.length} 段转写` : "已应用建议",
        description:
          targets.length > 1
            ? `全文已更新为：${trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed}`
            : trimmed.length > 80
              ? `${trimmed.slice(0, 80)}…`
              : trimmed,
      });
    },
    [findSegmentAtPlayhead, persistTimestamps, selectedTimestamp, timestamps, toast]
  );

  // 处理音频时间更新
  const handleTimeUpdate = useCallback(
    (time: number) => {
      setCurrentTime(time, "waveform");
      const dur = audioData.duration || timelineMax || 60;
      if (time >= dur - 0.05) setMapContinueLive(true);
    },
    [audioData.duration, setCurrentTime, timelineMax]
  );

  // 处理飞机选择
  const handleAircraftSelect = useCallback((icao24: string) => {
    userPickedAircraftRef.current = true;
    const key = icao24.toLowerCase();
    setVisibleAircraftSet((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setSelectedAircraft(key);
  }, []);

  const handleBottomNavChange = useCallback(
    (key: "map" | "transcripts" | "radio" | "audio" | "settings") => {
      setActiveBottomTab(key);
      const target =
        key === "map"
          ? mapSectionRef.current
          : key === "transcripts"
            ? transcriptSectionRef.current
            : key === "radio"
              ? radioSectionRef.current
              : key === "audio"
                ? audioSectionRef.current
                : settingsSectionRef.current;
      if (!target) return;

      flashSection(target);

      const container = contentScrollRef.current;
      const scrollBlock = key === "map" ? "center" : "start";
      if (container && container.scrollHeight > container.clientHeight + 8) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const top = targetRect.top - containerRect.top + container.scrollTop - 12;
        container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: scrollBlock, inline: "nearest" });
    },
    [flashSection]
  );

  const runGlobalSearch = useCallback(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) {
      toast({
        title: "请输入搜索内容",
        description: "可搜录音 ID、呼号、ICAO24、转写文本",
        variant: "destructive",
      });
      return;
    }

    const rec = pickRecordingBySearchQuery(q, recordings);
    if (rec) {
      onSelectRecording?.(rec.id);
      handleBottomNavChange("radio");
      toast({
        title: "已切换到录音",
        description: `${getRecordingDisplayName(rec)} (#${rec.id})`,
      });
      return;
    }

    if (audioData.id.toLowerCase().includes(q)) {
      handleBottomNavChange("radio");
      toast({ title: "当前录音", description: audioData.id });
      return;
    }

    const latestByIcao = new Map<string, ADSBData>();
    for (const p of adsbData) {
      const prev = latestByIcao.get(p.icao24);
      if (!prev || prev.timestamp < p.timestamp) latestByIcao.set(p.icao24, p);
    }
    const aircraftHit = Array.from(latestByIcao.values()).find((p) => {
      const icao = p.icao24.toLowerCase();
      const cs = (p.callsign ?? "").trim().toLowerCase();
      if (icao === q || cs === q) return true;
      if (/^\d+$/.test(q)) return false;
      return icao.includes(q) || cs.includes(q);
    });
    if (aircraftHit) {
      setSelectedAircraft(aircraftHit.icao24);
      setVisibleAircraftSet(new Set([aircraftHit.icao24]));
      setTargetsFilterQuery(aircraftHit.callsign?.trim() || aircraftHit.icao24);
      handleBottomNavChange("map");
      toast({
        title: "已选中目标",
        description: aircraftHit.callsign?.trim() || aircraftHit.icao24,
      });
      return;
    }

    const seg = timestamps.find(
      (t) =>
        t.id.toLowerCase().includes(q) || (t.text ?? "").toLowerCase().includes(q)
    );
    if (seg) {
      handleTimestampClick(seg);
      handleBottomNavChange("transcripts");
      toast({ title: "已定位语段", description: seg.id });
      return;
    }

    toast({
      title: "未找到匹配",
      description: "请检查录音 ID、呼号、ICAO 或转写关键词",
      variant: "destructive",
    });
  }, [
    globalSearch,
    recordings,
    onSelectRecording,
    handleBottomNavChange,
    audioData.id,
    adsbData,
    timestamps,
    handleTimestampClick,
    toast,
  ]);

  // 顶部菜单触发导出
  useEffect(() => {
    const handler = async (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { type: "json" | "csv" | "package" | "audio" }
        | undefined;
      if (!detail) return;
      const payload = {
        audio: audioData,
        timestamps,
        adsb: adsbData,
        staticLayers: vhhhStatic,
        exportedAt: new Date().toISOString(),
      };
      if (detail.type === "json") {
        exportAsJson(payload);
        toast({ title: "已导出", description: "JSON 标注包已下载" });
        return;
      }
      if (detail.type === "csv") {
        exportTimestampsAsCsv(timestamps, undefined, audioData.id);
        toast({ title: "已导出", description: "转写 CSV 已下载" });
        return;
      }
      if (detail.type === "audio") {
        if (!audioData.url) {
          toast({ title: "无法导出音频", description: "当前录音无音频 URL", variant: "destructive" });
          return;
        }
        try {
          const { exportAudioFile } = await import("@/lib/exporters");
          await exportAudioFile(audioData.url, `alpha-${audioData.id}-audio`);
          toast({ title: "已导出", description: "音频文件已下载" });
        } catch (e) {
          toast({
            title: "音频导出失败",
            description: e instanceof Error ? e.message : "请检查网络或 CORS",
            variant: "destructive",
          });
        }
        return;
      }
      if (detail.type === "package") {
        const result = await exportAnnotationPackage(payload);
        const parts = [
          result.json && "JSON",
          result.csv && "转写 CSV",
          result.adsbCsv && "ADSB CSV",
          result.audio && "音频",
        ].filter(Boolean);
        toast({
          title: parts.length ? "导出完成" : "导出未完成",
          description:
            parts.length > 0
              ? `已下载：${parts.join("、")}${result.errors.length ? `（${result.errors.join("；")}）` : ""}`
              : result.errors.join("；") || "无可用导出项",
          variant: parts.length ? "default" : "destructive",
        });
      }
    };
    window.addEventListener("alpha.export", handler as EventListener);
    return () => window.removeEventListener("alpha.export", handler as EventListener);
  }, [audioData, timestamps, adsbData, toast]);

  return (
    <div className="h-screen flex flex-col overflow-hidden efb-surface">
      <EfbTopbar
        title="ATC Transcriptions & Playback"
        subtitle={`${getRecordingDisplayName(audioData)} · ${recordingTrackSummary(audioData, adsbData)}`}
        searchValue={globalSearch}
        onSearchChange={setGlobalSearch}
        onSearchSubmit={runGlobalSearch}
        onMapClick={() => handleBottomNavChange("map")}
        onRadioClick={() => handleBottomNavChange("radio")}
        layerToggles={layerToggles}
        onLayerTogglesChange={setLayerToggles}
        onSettingsClick={() => handleBottomNavChange("settings")}
      />

      {/* 主内容区 */}
      <div ref={contentScrollRef} className="flex-1 min-h-0 overflow-y-auto scroll-smooth p-3">
        <div className="grid grid-cols-12 gap-3 lg:items-stretch">
        {/* 左侧：录音列表 + 波形（与地图同高，波形区自动撑满剩余高度） */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-3 self-stretch min-h-0">
          <div ref={radioSectionRef} className="scroll-mt-3 rounded-3xl shrink-0">
            <RecordingsPanelSlot
              activeId={audioData.id}
              onSelect={(id) => onSelectRecording?.(id)}
            />
          </div>
          <div ref={audioSectionRef} className="flex min-h-0 flex-1 flex-col">
            <Card className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border-border/70 efb-panel efb-glow">
              <AudioWaveform
                className="flex min-h-0 flex-1 flex-col p-4 sm:p-5"
                ref={audioWaveformRef}
                audioUrl={audioData.url}
                timestamps={timestamps}
                currentTime={currentTime}
                onTimeUpdate={handleTimeUpdate}
                onTimestampClick={handleTimestampClick}
                onTimestampsChange={handleSetTimestamps}
                onPlayStateChange={setWaveformPlaying}
              />
            </Card>
          </div>
        </div>

        {/* 中间：地图与左侧波形底部对齐，填满网格行高 */}
        <div className="col-span-12 lg:col-span-5 flex min-h-0 flex-col self-stretch">
          <div ref={mapSectionRef} className="flex min-h-0 flex-1 flex-col scroll-mt-3 rounded-3xl">
            <Card className="flex h-full min-h-[380px] flex-1 flex-col overflow-hidden rounded-3xl border-border/70 p-3 efb-panel efb-glow">
              <div className="flex min-h-0 flex-1 flex-col">
                <ADSBMap
                  adsbData={adsbData}
                  mapLiveAdsb={mapLiveAdsb}
                  mapRefreshRevision={adsbMapRevision}
                  visibleAircraftSet={visibleAircraftSet}
                  staticLayers={vhhhStatic}
                  toggles={layerToggles}
                  currentTime={currentTime}
                  selectedAircraft={selectedAircraft}
                  onAircraftSelect={handleAircraftSelect}
                  liveAdsbStatus={liveAdsbStatus}
                  focusRecordingId={audioData.id}
                  timelinePlaybackMode={isRecordingTimelineAligned(audioData)}
                  primaryRecordingAircraft={primaryRecordingAircraft}
                  recordingUtcStartSec={recordingUtcStartSec}
                  audioDurationSec={audioData.duration || timelineMax || 60}
                  mapPlaybackActive={waveformPlaying || mapContinueLive}
                  onLiveRealtimeModeChange={setMapLiveRealtimeMode}
                />
              </div>
            </Card>
          </div>
        </div>

        {/* 右侧：仪表 + 辅助信息 */}
        <div className="col-span-12 lg:col-span-3 lg:row-span-2 flex flex-col gap-3">
          <div className="relative">
            <TargetsPanel
              adsbData={mergedAdsbPool}
              visibleSet={visibleAircraftSet}
              onVisibleSetChange={setVisibleAircraftSet}
              selectedAircraft={selectedAircraft}
              onSelectAircraft={handleAircraftSelect}
              externalFilterQuery={targetsFilterQuery}
              currentTime={currentTime}
              recordingUtcStartSec={recordingUtcStartSec}
              recordingDurationSec={audioData.duration || timelineMax || 62}
              useLiveWallClockNow={useLivePanelClock}
              mapForceKeys={
                [primaryRecordingAircraft, selectedAircraft].filter(
                  Boolean
                ) as string[]
              }
            />
            <div className="absolute top-3 right-3 z-20">
              <ErrorBoundary name="千问智能体（A-4）" className="w-[320px]">
                <QianwenAgentWidget
                  audioId={audioData.id}
                  currentTime={currentTime}
                  selectedAircraft={selectedAircraft}
                  selectedTimestamp={selectedTimestamp}
                  workspace={agentWorkspace}
                  onApplySuggestedText={handleApplyAiSuggestedText}
                  onApplyTranscriptOps={handleApplyAiTranscriptOps}
                />
              </ErrorBoundary>
            </div>
          </div>
          <div
            ref={settingsSectionRef}
            className="scroll-mt-3 rounded-3xl border border-border/60 bg-background/15 p-3 space-y-3 efb-panel"
          >
            <div className="text-sm font-semibold tracking-tight">设置与图层</div>
            <LayerToggles value={layerToggles} onChange={setLayerToggles} />
            <TimeRover
            value={currentTime}
            max={timelineMax || 60}
            isPlaying={waveformPlaying}
            onSeek={handleWaveformSeek}
            onStep={handleWaveformStep}
            onTogglePlay={() => audioWaveformRef.current?.togglePlayPause()}
            />
          </div>
          <InstrumentPanel
            currentTime={currentTime}
            selectedAircraft={selectedAircraft}
            adsbData={mergedAdsbPool}
            recordingUtcStartSec={recordingUtcStartSec}
            recordingDurationSec={audioData.duration || timelineMax || 62}
            useLiveWallClockNow={useLivePanelClock}
          />
          <div className="min-h-[280px]">
            <AuxiliaryInfo
              audioData={audioData}
              adsbData={mergedAdsbPool}
              currentTime={currentTime}
              selectedAircraft={selectedAircraft}
              recordingUtcStartSec={recordingUtcStartSec}
              recordingDurationSec={audioData.duration || timelineMax || 62}
              useLiveWallClockNow={useLivePanelClock}
            />
          </div>
        </div>

        {/* 语音剪辑：在原网格内扩宽到左+中区域，不单开整行 */}
        <div ref={transcriptSectionRef} className="col-span-12 lg:col-span-9">
          <TranscriptTimelineEditor
            value={timestamps}
            currentTime={currentTime}
            timelineMax={timelineMax || 60}
            isGenerating={
              transcriptLoading?.audioId === audioData.id &&
              timestamps.length === 0
            }
            generatingMessage={transcriptLoading?.message}
            onSeek={handleTranscriptSeek}
            onSegmentFocus={handleTimestampClick}
            onChange={(next) => {
              handleSetTimestamps(next);
              // 同步右侧智能体上下文：优先选中“当前播放指针所在段”
              const active =
                next.find((x) => currentTime >= x.startTime && currentTime <= x.endTime) ?? null;
              setSelectedTimestamp(active);
            }}
          />
        </div>
        </div>
      </div>

      <EfbBottomNav
        active={activeBottomTab}
        onChange={handleBottomNavChange}
        className="sticky bottom-0 z-20"
      />
    </div>
  );
}
