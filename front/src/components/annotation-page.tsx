"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { AudioWaveform, type AudioWaveformHandle } from "@/components/audio-waveform";
import { TimestampList } from "@/components/timestamp-list";
import { TranscriptTimelineEditor } from "@/components/transcript-timeline-editor";
import { TextEditor } from "@/components/text-editor";
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
import { AudioData, ADSBData, RecordingMeta, VhhhStaticLayers, VoiceTimestamp } from "@/types";
import { audioAPI } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
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

type AsrStatus = "idle" | "running" | "failed" | "done";

function hasRecognizedText(list: VoiceTimestamp[]): boolean {
  return list.some((item) => item.text.trim().length > 0);
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
      <Card className="dashboard-card">
        <div className="text-sm text-muted-foreground">正在加载 VSP/AIP 数据...</div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="dashboard-card border-destructive/50">
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
    <Card className="dashboard-card border-emerald-500/40 bg-emerald-500/5 min-h-[140px]">
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

function parseStaticExtraJson(extraJson?: string | null): Record<string, unknown> {
  if (!extraJson) return {};
  try {
    const parsed = JSON.parse(extraJson);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isCommonLandmarkWaypoint(waypoint: VspWaypoint) {
  const type = String(waypoint.type ?? "").toLowerCase();
  const extra = parseStaticExtraJson(waypoint.extra_json);
  return (
    type.includes("landmark") ||
    type.includes("visual") ||
    type.includes("fix") ||
    extra.landmark === true ||
    extra.common === true
  );
}

function buildVspStaticLayers(data: VspMapData): VhhhStaticLayers {
  const navaidWaypointIds = new Set(data.navaids.map((navaid) => navaid.ident.toLowerCase()));
  const nonNavaidWaypoints = data.waypoints.filter(
    (waypoint) => waypoint.type !== "navaid" && !navaidWaypointIds.has(waypoint.name.toLowerCase())
  );
  const commonLandmarkWaypoints = nonNavaidWaypoints.filter(isCommonLandmarkWaypoint);
  const ordinaryWaypoints = nonNavaidWaypoints.filter((waypoint) => !isCommonLandmarkWaypoint(waypoint));

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
      ...ordinaryWaypoints.map((waypoint) => ({
        id: waypoint.waypoint_id,
        name: waypoint.name,
        kind: "waypoint" as const,
        lat: waypoint.lat,
        lon: waypoint.lng,
        note: [waypoint.type, waypoint.description].filter(Boolean).join(" · "),
      })),
    ],
    landmarks: [
      ...data.airports.map((airport) => ({
        id: airport.airport_id,
        name: `${airport.icao_code} ${airport.airport_name}`,
        kind: "landmark" as const,
        lat: airport.lat,
        lon: airport.lng,
        note: airport.iata_code ?? undefined,
      })),
      ...commonLandmarkWaypoints.map((waypoint) => ({
        id: waypoint.waypoint_id,
        name: waypoint.name,
        kind: "landmark" as const,
        lat: waypoint.lat,
        lon: waypoint.lng,
        note: [waypoint.type, waypoint.description].filter(Boolean).join(" · "),
      })),
    ],
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
  const [editingTimestamp, setEditingTimestamp] = useState<VoiceTimestamp | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<string | undefined>();
  const [globalSearch, setGlobalSearch] = useState("");
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
  const [asrStatus, setAsrStatus] = useState<AsrStatus>(() =>
    hasRecognizedText([...timestamps, ...audioData.timestamps]) ? "done" : "idle"
  );

  useEffect(() => {
    setAsrStatus(hasRecognizedText([...timestamps, ...audioData.timestamps]) ? "done" : "idle");
    asrRequestedForRef.current = null;
  }, [audioData.id]);

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
    const hasText = hasRecognizedText([...timestamps, ...audioData.timestamps]);
    if (hasText) {
      setAsrStatus("done");
      return;
    }
    if (asrRequestedForRef.current === audioData.id) return;

    let cancelled = false;
    asrRequestedForRef.current = audioData.id;
    setAsrStatus("running");
    toast({
      title: "ASR 识别中",
      description: audioData.id,
    });

    audioAPI.recognizeAudio(audioData).then((result) => {
      if (cancelled) return;
      if (!result.success || !result.data) {
        asrRequestedForRef.current = null;
        setAsrStatus("failed");
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
      setAsrStatus(hasRecognizedText(next) ? "done" : "idle");
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
  const globalSearchQuery = globalSearch.trim().toLowerCase();
  const matchingAircraftSet = useMemo(() => {
    if (!globalSearchQuery) return null;
    const matched = new Set<string>();
    for (const point of adsbData) {
      const hay = `${point.icao24} ${point.callsign ?? ""}`.toLowerCase();
      if (hay.includes(globalSearchQuery)) {
        matched.add(point.icao24);
      }
    }
    return matched;
  }, [adsbData, globalSearchQuery]);
  const effectiveVisibleAircraftSet = useMemo(() => {
    if (!matchingAircraftSet) return visibleAircraftSet;
    return new Set([...visibleAircraftSet].filter((icao24) => matchingAircraftSet.has(icao24)));
  }, [matchingAircraftSet, visibleAircraftSet]);
  const searchedAdsbData = useMemo(() => {
    if (!matchingAircraftSet) return adsbData;
    return adsbData.filter((point) => matchingAircraftSet.has(point.icao24));
  }, [adsbData, matchingAircraftSet]);

  useEffect(() => {
    setVisibleAircraftSet(new Set(aircraftList));
  }, [audioData.id]); // 切录音后重置

  const findTimestampAtTime = useCallback(
    (time: number) => timestamps.find((ts) => time >= ts.startTime && time <= ts.endTime) ?? null,
    [timestamps]
  );

  const seekToTime = useCallback(
    (time: number, timestamp?: VoiceTimestamp | null) => {
      const target = Math.max(0, Math.min(time, timelineMax || Math.max(audioData.duration || 0, time)));
      const active = timestamp ?? findTimestampAtTime(target);
      setSelectedTimestamp(active);
      const waveform = audioWaveformRef.current;
      if (waveform) {
        waveform.seekTo(target);
      } else {
        setCurrentTime(target, "ui");
      }
    },
    [audioData.duration, findTimestampAtTime, setCurrentTime, timelineMax]
  );

  // 处理时间戳点击
  const handleTimestampClick = useCallback((timestamp: VoiceTimestamp) => {
    seekToTime(timestamp.startTime, timestamp);
  }, [seekToTime]);

  const handleTimestampEdit = useCallback((timestamp: VoiceTimestamp) => {
    seekToTime(timestamp.startTime, timestamp);
    setEditingTimestamp(timestamp);
  }, [seekToTime]);

  // 保存时间戳编辑
  const handleSaveTimestamp = useCallback(
    async (updatedTimestamp: VoiceTimestamp) => {
      try {
        // 没有可写后端接口时，先保存到浏览器本地，避免请求报错刷屏
        if (!audioData.url) {
          const updatedTimestamps = timestamps.map((ts) =>
            ts.id === updatedTimestamp.id ? updatedTimestamp : ts
          );
          setTimestamps(updatedTimestamps);
          saveTimestampOverride(audioData.id, updatedTimestamp);
          toast({
            title: "已本地保存",
            description: "已保存到浏览器本地（待后续同步）",
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

  const handleSaveEditingTimestamp = useCallback(
    async (updatedTimestamp: VoiceTimestamp) => {
      await handleSaveTimestamp(updatedTimestamp);
      setEditingTimestamp(null);
    },
    [handleSaveTimestamp]
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
    setSelectedTimestamp((current) => {
      if (current && time >= current.startTime && time <= current.endTime) return current;
      return findTimestampAtTime(time);
    });
  }, [findTimestampAtTime, setCurrentTime]);

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
    <div className="dashboard-root efb-surface">
      <EfbTopbar
        className="dashboard-header"
        title="ATC 转写与播放"
        subtitle={`音频：${audioData.id} · 目标：${aircraftList.length}`}
        searchValue={globalSearch}
        onSearchChange={setGlobalSearch}
      />

      {/* 主内容区 */}
      <section className="dashboard-status">
          <VspSourceBanner data={vspMapData} loading={vspMapLoading} error={vspMapError} />
      </section>

      <main ref={contentScrollRef} className="dashboard-main">
        {/* 左侧：录音列表 + 波形 */}
        <section className="dashboard-left">
          <div ref={radioSectionRef} className="h-full min-h-0 overflow-hidden">
            <RecordingsPanel
              className="h-full"
              recordings={recordings}
              activeId={audioData.id}
              onSelect={(id) => onSelectRecording?.(id)}
              recordingMeta={recordingMeta}
              searchQuery={globalSearch}
            />
          </div>
          <div className="dashboard-left-lower">
            <A2VoicePanel
              className="min-h-0"
              onRefreshRecordings={onRefreshRecordings}
              onSelectRecording={onSelectRecording}
              onLoadRecording={onLoadRecording}
            />
            <div ref={transcriptSectionRef} className="h-full min-w-0 overflow-hidden">
              <TimestampList
                className="timestamp-card"
                timestamps={timestamps}
                currentTime={currentTime}
                selectedTimestampId={selectedTimestamp?.id}
                searchQuery={globalSearch}
                onTimestampClick={handleTimestampClick}
                onTimestampEdit={handleTimestampEdit}
              />
            </div>
          </div>
        </section>

        {/* 中间：地图/航迹（整栏用于地图可视化） */}
        <section className="dashboard-center">
          <div ref={mapSectionRef} className="h-full min-h-0 overflow-hidden">
            <Card className="dashboard-card map-card">
              <div className="map-container flex-1">
                <ADSBMap
                  adsbData={adsbData}
                  visibleAircraftSet={effectiveVisibleAircraftSet}
                  staticLayers={vspStaticLayers}
                  toggles={layerToggles}
                  currentTime={currentTime}
                  selectedAircraft={selectedAircraft}
                  onAircraftSelect={handleAircraftSelect}
                />
              </div>
            </Card>
          </div>
          <div className="dashboard-center-bottom">
            <div ref={audioSectionRef} className="h-full min-w-0 overflow-hidden">
              <div className="dashboard-card audio-timeline-card">
                <AudioWaveform
                  className="audio-waveform-panel p-2"
                  ref={audioWaveformRef}
                  audioUrl={audioData.url}
                  timestamps={timestamps}
                  asrStatus={asrStatus}
                  currentTime={currentTime}
                  onTimeUpdate={handleTimeUpdate}
                  onTimestampClick={handleTimestampClick}
                  onTimestampsChange={handleSetTimestamps}
                />
                <div className="scroll-area transcript-list min-h-0 border-t border-border/50 pt-2">
                  <TranscriptTimelineEditor
                    className="transcript-editor-card"
                    value={timestamps}
                    currentTime={currentTime}
                    timelineMax={timelineMax || 60}
                    onSeek={seekToTime}
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
        </section>

        <section className="dashboard-right">
          <div className="flex min-h-0 overflow-hidden">
              <ErrorBoundary name="千问智能体（A-4）" className="w-full">
                <QianwenAgentWidget
                  audioId={audioData.id}
                  currentTime={currentTime}
                  selectedAircraft={selectedAircraft}
                  selectedTimestamp={selectedTimestamp}
                  onApplySuggestedText={handleApplyAiSuggestedText}
                />
              </ErrorBoundary>
          </div>
          <div ref={settingsSectionRef} className="min-h-0 overflow-hidden">
            <LayerToggles value={layerToggles} onChange={setLayerToggles} className="rounded-lg p-2" />
          </div>
          <TimeRover
            className="rounded-lg p-2"
            value={currentTime}
            max={timelineMax || 60}
            onChange={seekToTime}
            onTogglePlayPause={() => audioWaveformRef.current?.togglePlayPause()}
          />
          <InstrumentPanel
            className="rounded-lg"
            currentTime={currentTime}
            selectedAircraft={selectedAircraft}
            adsbData={searchedAdsbData}
          />
          <div className="min-h-0 overflow-hidden">
            <AuxiliaryInfo
              audioData={audioData}
              adsbData={searchedAdsbData}
              currentTime={currentTime}
              selectedAircraft={selectedAircraft}
            />
          </div>
        </section>

        {false && (
          <TranscriptTimelineEditor
            value={timestamps}
            currentTime={currentTime}
            timelineMax={timelineMax || 60}
            onSeek={seekToTime}
            onChange={(next) => {
              handleSetTimestamps(next);
              // 同步右侧智能体上下文：优先选中“当前播放指针所在段”
              const active =
                next.find((x) => currentTime >= x.startTime && currentTime <= x.endTime) ?? null;
              setSelectedTimestamp(active);
            }}
          />
        )}
        {editingTimestamp && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
            <div className="w-full max-w-xl">
              <TextEditor
                timestamp={editingTimestamp}
                onSave={(timestamp) => void handleSaveEditingTimestamp(timestamp)}
                onCancel={() => setEditingTimestamp(null)}
                onPlay={(startTime) => seekToTime(startTime, editingTimestamp)}
              />
            </div>
          </div>
        )}
      </main>

      <EfbBottomNav
        active={activeBottomTab}
        onChange={handleBottomNavChange}
        className="dashboard-bottom-nav"
      />
    </div>
  );
}
