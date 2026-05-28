"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { RecordingsPanel } from "@/components/recordings-panel";
import { A2VoicePanel } from "@/components/a2-voice-panel";
import { QianwenAgentWidget } from "@/components/qianwen-agent-widget";
import { ErrorBoundary } from "@/components/error-boundary";
import { AudioData, ADSBData, VoiceTimestamp } from "@/types";
import type { RecordingMeta } from "@/mock/demo-data";
import { audioAPI } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { type VhhhStaticLayers } from "@/mock/vhhh-static";
import { exportAsJson, exportTimestampsAsCsv } from "@/lib/exporters";
import {
  VspAirport,
  VspFrequency,
  VspNavaid,
  VspProcedure,
  VspRunway,
  VspWaypoint,
  VspAirline,
  vspAPI,
} from "@/lib/api";
import {
  applyTimestampOverrides,
  loadTimestampOverrides,
  saveTimestampOverride,
  saveFullTimestamps,
} from "@/lib/local-annotation-store";
import { PlaybackProvider, usePlayback } from "@/context/PlaybackContext";

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
  recordings?: AudioData[];
  recordingMeta?: Record<string, RecordingMeta>;
  onSelectRecording?: (id: string) => void;
  onLoadRecording?: (audio: AudioData) => void;
  onRefreshRecordings?: () => void;
}

function createPendingAsrTimestamp(audioData: AudioData): VoiceTimestamp[] {
  if (!audioData.url) return [];
  const endTime = Math.max(audioData.duration || 0, 1);
  return [
    {
      id: `pending-asr-${audioData.id}`,
      startTime: 0,
      endTime,
      text: "",
      speaker: "ASR",
    },
  ];
}

export function AnnotationPage({
  audioData,
  adsbData,
  recordings = [audioData],
  recordingMeta = {},
  onSelectRecording,
  onLoadRecording,
  onRefreshRecordings,
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
    const merged = applyTimestampOverrides(audioData.timestamps, overrides);
    return merged.length > 0 ? merged : createPendingAsrTimestamp(audioData);
  });

  const timelineMax = Math.max(
    audioData.duration || 0,
    ...timestamps.map((t) => t.endTime),
    ...adsbData.map((d) => d.timestamp)
  );

  // 同步 audioData 的 timestamps 变化（优先使用本地 full 列表，再合并 overrides）
  useEffect(() => {
    try {
      const fullRaw = localStorage.getItem(`alpha.timestamps.full.${audioData.id}`);
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
    const merged = applyTimestampOverrides(audioData.timestamps, overrides);
    setTimestamps(merged.length > 0 ? merged : createPendingAsrTimestamp(audioData));
  }, [audioData.id, audioData.timestamps, audioData.url, audioData.duration]);

  return (
    <PlaybackProvider timelineMax={timelineMax || 60}>
      <AnnotationPageInner
        audioData={audioData}
        adsbData={adsbData}
        recordings={recordings}
        recordingMeta={recordingMeta}
        onSelectRecording={onSelectRecording}
        onLoadRecording={onLoadRecording}
        onRefreshRecordings={onRefreshRecordings}
        timestamps={timestamps}
        setTimestamps={setTimestamps}
        timelineMax={timelineMax || 60}
      />
    </PlaybackProvider>
  );
}

function VspSourceBanner({
  data,
  loading,
  error,
}: {
  data: VspMapData | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <Card className="mb-2.5 rounded-2xl border-border/70 p-3 efb-panel">
        <div className="text-sm text-muted-foreground">正在加载 VSP/AIP 数据...</div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="mb-2.5 rounded-2xl border-destructive/50 p-3 efb-panel">
        <div className="text-sm font-semibold text-destructive">VSP/AIP 数据加载失败</div>
        <div className="mt-1 text-xs text-muted-foreground">{error}</div>
      </Card>
    );
  }

  const airports = data?.airports.length ?? 0;
  const runways = data?.runways.length ?? 0;
  const frequencies = data?.frequencies.length ?? 0;
  const navaids = data?.navaids.length ?? 0;
  const waypoints = data?.waypoints.length ?? 0;
  const procedures = data?.procedures.length ?? 0;
  const airlines = data?.airlines.length ?? 0;
  const airport = data?.airports[0];

  return (
    <Card className="mb-2.5 rounded-2xl border-emerald-500/40 bg-emerald-500/5 p-3 efb-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-emerald-300">
            VSP/AIP 数据已加载
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            机场 {airports}，跑道 {runways}，频率 {frequencies}，导航台 {navaids}，航路点 {waypoints}，程序 {procedures}，航司 {airlines}
          </div>
        </div>
        {airport ? (
          <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-xs">
            <span className="font-semibold">{airport.icao_code}</span>
            <span className="text-muted-foreground"> · {airport.airport_name}</span>
          </div>
        ) : null}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        地图叠加层：橙色线条为跑道，紫色标签为导航台，蓝色点为航路点，绿色标记为机场参考点。
      </div>
    </Card>
  );
}

type AnnotationPageInnerProps = AnnotationPageProps & {
  timestamps: VoiceTimestamp[];
  setTimestamps: React.Dispatch<React.SetStateAction<VoiceTimestamp[]>>;
  timelineMax: number;
};

type VspMapData = {
  airports: VspAirport[];
  runways: VspRunway[];
  frequencies: VspFrequency[];
  navaids: VspNavaid[];
  waypoints: VspWaypoint[];
  procedures: VspProcedure[];
  airlines: VspAirline[];
};

const emptyStaticLayers: VhhhStaticLayers = {
  runways: [],
  taxiways: [],
  waypoints: [],
  landmarks: [],
  procedures: [],
  routeLines: [],
  obstacleZones: [],
};

function destinationPoint(lat: number, lon: number, bearingDeg: number, distanceM: number) {
  const radiusM = 6371000;
  const angularDistance = distanceM / radiusM;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

function parseProcedureLine(pathGeojson?: string | null) {
  if (!pathGeojson) return [];
  try {
    const parsed = JSON.parse(pathGeojson) as { type?: string; coordinates?: unknown };
    if (parsed.type !== "LineString" || !Array.isArray(parsed.coordinates)) return [];
    return parsed.coordinates
      .map((coord) => {
        if (!Array.isArray(coord) || coord.length < 2) return null;
        const lon = Number(coord[0]);
        const lat = Number(coord[1]);
        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
      })
      .filter((point): point is { lat: number; lon: number } => Boolean(point));
  } catch {
    return [];
  }
}

function buildVspStaticLayers(data: VspMapData): VhhhStaticLayers {
  const navaidWaypointIds = new Set(data.navaids.map((navaid) => navaid.ident.toLowerCase()));
  const nonNavaidWaypoints = data.waypoints.filter(
    (waypoint) => waypoint.type !== "navaid" && !navaidWaypointIds.has(waypoint.name.toLowerCase())
  );

  return {
    runways: data.runways
      .filter(
        (rw) =>
          rw.threshold_lat != null &&
          rw.threshold_lng != null &&
          rw.bearing_deg != null &&
          rw.runway_length_m != null
      )
      .map((rw) => {
        const end = destinationPoint(
          rw.threshold_lat!,
          rw.threshold_lng!,
          rw.bearing_deg!,
          rw.runway_length_m!
        );
        return {
          id: rw.runway_id,
          name: `RWY ${rw.runway_designator}`,
          kind: "runway" as const,
          points: [{ lat: rw.threshold_lat!, lon: rw.threshold_lng! }, end],
          note: `${rw.runway_length_m} x ${rw.runway_width_m ?? "-"} m`,
        };
      }),
    taxiways: [],
    waypoints: [
      ...data.navaids.map((navaid) => ({
        id: navaid.navaid_id,
        name: navaid.ident,
        kind: "navaid" as const,
        lat: navaid.lat,
        lon: navaid.lng,
        note: [navaid.navaid_type, navaid.frequency].filter(Boolean).join(" · "),
      })),
      ...nonNavaidWaypoints.map((waypoint) => ({
        id: waypoint.waypoint_id,
        name: waypoint.name,
        kind: "waypoint" as const,
        lat: waypoint.lat,
        lon: waypoint.lng,
        note: [waypoint.type, waypoint.description].filter(Boolean).join(" · "),
      })),
    ],
    landmarks: data.airports.map((airport) => ({
      id: airport.airport_id,
      name: `${airport.icao_code} ${airport.airport_name}`,
      kind: "landmark" as const,
      lat: airport.lat,
      lon: airport.lng,
      note: airport.iata_code ?? undefined,
    })),
    procedures: data.procedures.map((procedure) => ({
      id: procedure.procedure_id,
      type: procedure.procedure_type.toUpperCase() === "SID" ? ("SID" as const) : ("STAR" as const),
      name: procedure.procedure_name,
      runway: procedure.runway ?? undefined,
      note: procedure.procedure_code,
    })),
    routeLines: data.procedures
      .map((procedure) => {
        const points = parseProcedureLine(procedure.path_geojson);
        if (points.length < 2) return null;
        return {
          id: procedure.procedure_id,
          name: procedure.procedure_name,
          kind: procedure.procedure_type.toLowerCase() === "star" ? ("planned" as const) : ("detour" as const),
          points,
          note: procedure.procedure_code,
          endLabel: procedure.runway ?? undefined,
        };
      })
      .filter((route): route is NonNullable<typeof route> => Boolean(route)),
    obstacleZones: [],
  };
}

function AnnotationPageInner({
  audioData,
  adsbData,
  recordings = [audioData],
  recordingMeta = {},
  onSelectRecording,
  onLoadRecording,
  onRefreshRecordings,
  timestamps,
  setTimestamps,
  timelineMax,
}: AnnotationPageInnerProps) {
  const { currentTime, setCurrentTime } = usePlayback();
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
  const [activeBottomTab, setActiveBottomTab] = useState<
    "map" | "transcripts" | "radio" | "audio" | "settings"
  >("transcripts");
  const [vspMapData, setVspMapData] = useState<VspMapData | null>(null);
  const [vspMapError, setVspMapError] = useState<string | null>(null);
  const [vspMapLoading, setVspMapLoading] = useState(true);
  const mapSectionRef = useRef<HTMLDivElement>(null);
  const audioWaveformRef = useRef<AudioWaveformHandle>(null);
  const transcriptSectionRef = useRef<HTMLDivElement>(null);
  const radioSectionRef = useRef<HTMLDivElement>(null);
  const audioSectionRef = useRef<HTMLDivElement>(null);
  const settingsSectionRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  const fullSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFullDraftRef = useRef<VoiceTimestamp[] | null>(null);
  const asrRequestedForRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadVspForMap() {
      setVspMapLoading(true);
      setVspMapError(null);
      try {
        const airports = await vspAPI.airports();
        const airportId = airports[0]?.airport_id;
        const [runways, frequencies, navaids, waypointsPage, procedures, airlines] = await Promise.all([
          vspAPI.runways(airportId),
          vspAPI.frequencies(airportId),
          vspAPI.navaids(airportId),
          vspAPI.waypoints(),
          vspAPI.procedures(airportId),
          vspAPI.airlines(),
        ]);
        if (!cancelled) {
          setVspMapData({ airports, runways, frequencies, navaids, waypoints: waypointsPage.items, procedures, airlines });
        }
      } catch (error) {
        if (!cancelled) {
          setVspMapError(error instanceof Error ? error.message : "Failed to load VSP data");
          setVspMapData(null);
        }
      } finally {
        if (!cancelled) {
          setVspMapLoading(false);
        }
      }
    }

    loadVspForMap();
    return () => {
      cancelled = true;
    };
  }, []);

  const vspStaticLayers = useMemo(
    () => (vspMapData ? buildVspStaticLayers(vspMapData) : emptyStaticLayers),
    [vspMapData]
  );

  // audioId 切换/组件卸载时，清理未完成的防抖写入
  useEffect(() => {
    return () => {
      if (fullSaveDebounceRef.current) {
        clearTimeout(fullSaveDebounceRef.current);
        fullSaveDebounceRef.current = null;
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
      setTimestamps(next);
      // 支持拆分/合并/删除/新增段落：用 full list 持久化，刷新不丢
      if (typeof window !== "undefined") {
        latestFullDraftRef.current = next;
        if (fullSaveDebounceRef.current) {
          clearTimeout(fullSaveDebounceRef.current);
        }
        fullSaveDebounceRef.current = setTimeout(() => {
          const latest = latestFullDraftRef.current;
          if (!latest) return;
          try {
            saveFullTimestamps(audioData.id, latest);
          } catch {
            // ignore
          }
        }, 600);
      }
    },
    [audioData.id, setTimestamps]
  );

  // 从音频数据中提取所有唯一的飞机 ICAO24
  useEffect(() => {
    if (!audioData.url) return;
    const hasRecognizedText = [...timestamps, ...audioData.timestamps].some((item) => item.text.trim().length > 0);
    if (hasRecognizedText) return;
    if (asrRequestedForRef.current === audioData.id) return;

    let cancelled = false;
    asrRequestedForRef.current = audioData.id;
    toast({
      title: "ASR 识别中",
      description: audioData.id,
    });

    audioAPI.recognizeAudio(audioData).then((result) => {
      if (cancelled) return;
      if (!result.success || !result.data) {
        asrRequestedForRef.current = null;
        toast({
          title: "ASR 识别失败",
          description: result.error ?? "后端没有返回识别结果",
          variant: "destructive",
        });
        return;
      }

      const next = result.data.length > 0 ? result.data : createPendingAsrTimestamp(audioData);
      handleSetTimestamps(next);
      setSelectedTimestamp(next[0] ?? null);
      toast({
        title: "ASR 识别完成",
        description: "识别结果已加载到语音剪辑",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [audioData, handleSetTimestamps, timestamps.length, toast]);

  const aircraftList = Array.from(
    new Set(adsbData.map((d) => d.icao24))
  );

  useEffect(() => {
    setVisibleAircraftSet(new Set(aircraftList));
  }, [audioData.id]); // 切录音后重置

  // 处理时间戳点击
  const handleTimestampClick = useCallback((timestamp: VoiceTimestamp) => {
    setSelectedTimestamp(timestamp);
    setCurrentTime(timestamp.startTime, "ui");
  }, [setCurrentTime]);

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

  // 把智能体 suggestedText 直接应用到当前选中的时间戳，并走原有保存逻辑
  const handleApplyAiSuggestedText = useCallback(
    (text: string) => {
      if (!selectedTimestamp) return;
      handleSaveTimestamp({
        ...selectedTimestamp,
        text,
      });
    },
    [handleSaveTimestamp, selectedTimestamp]
  );

  // 处理音频时间更新
  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time, "waveform");
  }, [setCurrentTime]);

  // 处理飞机选择
  const handleAircraftSelect = useCallback((icao24: string) => {
    setSelectedAircraft((prev) => (prev === icao24 ? undefined : icao24));
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
      const container = contentScrollRef.current;
      if (container && target) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const top = targetRect.top - containerRect.top + container.scrollTop - 12;
        container.scrollTo({ top, behavior: "smooth" });
        return;
      }
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    []
  );

  // 顶部菜单触发导出
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { type: "json" | "csv" } | undefined;
      if (!detail) return;
      if (detail.type === "json") {
        exportAsJson({
          audio: audioData,
          timestamps,
          adsb: adsbData,
          staticLayers: vspStaticLayers,
          exportedAt: new Date().toISOString(),
        });
        toast({ title: "已导出", description: "JSON 文件已下载" });
      } else {
        exportTimestampsAsCsv(timestamps);
        toast({ title: "已导出", description: "CSV 文件已下载" });
      }
    };
    window.addEventListener("alpha.export", handler as EventListener);
    return () => window.removeEventListener("alpha.export", handler as EventListener);
  }, [audioData, timestamps, adsbData, toast, vspStaticLayers]);

  return (
    <div className="min-h-screen flex flex-col efb-surface">
      <EfbTopbar
        title="ATC 转写与播放"
        subtitle={`音频：${audioData.id} · 目标：${aircraftList.length}`}
      />

      {/* 主内容区 */}
      <div ref={contentScrollRef} className="flex-1 overflow-y-auto scroll-smooth p-2.5">
        <VspSourceBanner data={vspMapData} loading={vspMapLoading} error={vspMapError} />
        <div className="grid grid-cols-12 gap-2.5">
        {/* 左侧：录音列表 + 波形 */}
        <div className="col-span-12 flex flex-col gap-2.5 lg:col-span-3">
          <div ref={radioSectionRef}>
            <RecordingsPanel
              recordings={recordings}
              activeId={audioData.id}
              onSelect={(id) => onSelectRecording?.(id)}
              recordingMeta={recordingMeta}
            />
          </div>
          <A2VoicePanel
            onRefreshRecordings={onRefreshRecordings}
            onSelectRecording={onSelectRecording}
            onLoadRecording={onLoadRecording}
          />
        </div>

        {/* 中间：地图/航迹（整栏用于地图可视化） */}
        <div className="col-span-12 flex min-h-0 flex-col gap-2.5 lg:col-span-6">
          <div ref={mapSectionRef} className="min-h-0 flex-1">
            <Card className="flex h-[clamp(300px,42vh,520px)] min-h-[300px] flex-col overflow-hidden rounded-2xl border-border/70 p-2.5 efb-panel efb-glow">
              <div className="min-h-0 flex-1">
                <ADSBMap
                  adsbData={adsbData}
                  visibleAircraftSet={visibleAircraftSet}
                  staticLayers={vspStaticLayers}
                  toggles={layerToggles}
                  currentTime={currentTime}
                  selectedAircraft={selectedAircraft}
                  onAircraftSelect={handleAircraftSelect}
                />
              </div>
            </Card>
          </div>
          <div ref={audioSectionRef}>
            <div className="overflow-hidden rounded-2xl border border-border/70 efb-panel efb-glow">
              <AudioWaveform
                className="p-3 sm:p-4"
                ref={audioWaveformRef}
                audioUrl={audioData.url}
                timestamps={timestamps}
                currentTime={currentTime}
                onTimeUpdate={handleTimeUpdate}
                onTimestampClick={handleTimestampClick}
                onTimestampsChange={handleSetTimestamps}
              />
              <div className="border-t border-border/50 p-3 sm:p-4">
                <TranscriptTimelineEditor
                  value={timestamps}
                  currentTime={currentTime}
                  timelineMax={timelineMax || 60}
                  onSeek={(t) => setCurrentTime(t)}
                  onChange={(next) => {
                    handleSetTimestamps(next);
                    const active =
                      next.find((x) => currentTime >= x.startTime && currentTime <= x.endTime) ?? null;
                    setSelectedTimestamp(active);
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：仪表 + 辅助信息 */}
        <div className="col-span-12 flex flex-col gap-2.5 lg:col-span-3 lg:row-span-2">
          <div className="flex justify-end">
              <ErrorBoundary name="千问智能体（A-4）" className="w-[320px]">
                <QianwenAgentWidget
                  audioId={audioData.id}
                  currentTime={currentTime}
                  selectedAircraft={selectedAircraft}
                  selectedTimestamp={selectedTimestamp}
                  onApplySuggestedText={handleApplyAiSuggestedText}
                />
              </ErrorBoundary>
          </div>
          <div ref={settingsSectionRef}>
            <LayerToggles value={layerToggles} onChange={setLayerToggles} />
          </div>
          <TimeRover value={currentTime} max={timelineMax || 60} onChange={(t) => setCurrentTime(t, "ui")} />
          <InstrumentPanel
            currentTime={currentTime}
            selectedAircraft={selectedAircraft}
            adsbData={adsbData}
          />
          <div className="min-h-[220px]">
            <AuxiliaryInfo
              audioData={audioData}
              adsbData={adsbData}
              currentTime={currentTime}
              selectedAircraft={selectedAircraft}
            />
          </div>
        </div>

        {/* 语音剪辑：在原网格内扩宽到左+中区域，不单开整行 */}
        <div ref={transcriptSectionRef} className="col-span-12 lg:col-span-9">
          <TimestampList
            timestamps={timestamps}
            currentTime={currentTime}
            selectedTimestampId={selectedTimestamp?.id}
            onTimestampClick={handleTimestampClick}
            onTimestampEdit={handleTimestampClick}
          />
        </div>

        {false && (
          <TranscriptTimelineEditor
            value={timestamps}
            currentTime={currentTime}
            timelineMax={timelineMax || 60}
            onSeek={(t) => setCurrentTime(t)}
            onChange={(next) => {
              handleSetTimestamps(next);
              // 同步右侧智能体上下文：优先选中“当前播放指针所在段”
              const active =
                next.find((x) => currentTime >= x.startTime && currentTime <= x.endTime) ?? null;
              setSelectedTimestamp(active);
            }}
          />
        )}
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
