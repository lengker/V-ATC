"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { AudioWaveform, type AudioWaveformHandle } from "@/components/audio-waveform";
import { TimestampList } from "@/components/timestamp-list";
import { TextEditor } from "@/components/text-editor";
import { AuxiliaryInfo } from "@/components/auxiliary-info";
import { EfbTopbar } from "@/components/efb-topbar";
import { EfbBottomNav } from "@/components/efb-bottom-nav";
import { InstrumentPanel } from "@/components/instrument-panel";
import { LayerToggles, type LayerTogglesState } from "@/components/layer-toggles";
import { TimeRover } from "@/components/time-rover";
import { TargetsPanel } from "@/components/targets-panel";
import { RecordingsPanel } from "@/components/recordings-panel";
import { AudioData, ADSBData, VoiceTimestamp } from "@/types";
import type { RecordingMeta } from "@/mock/demo-data";
import { audioAPI } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { vhhhStatic } from "@/mock/vhhh-static";
import { exportAsJson, exportTimestampsAsCsv } from "@/lib/exporters";
import {
  applyTimestampOverrides,
  loadTimestampOverrides,
  saveTimestampOverride,
} from "@/lib/local-annotation-store";
import { PlaybackProvider, usePlayback } from "@/context/PlaybackContext";

// 动态导入地图组件，禁用 SSR
const ADSBMap = dynamic(() => import("@/components/adsb-map").then((mod) => ({ default: mod.ADSBMap })), {
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
}

export function AnnotationPage({
  audioData,
  adsbData,
  recordings = [audioData],
  recordingMeta = {},
  onSelectRecording,
}: AnnotationPageProps) {
  const [timestamps, setTimestamps] = useState<VoiceTimestamp[]>(() => {
    // 初次加载：合并本地保存的 override（无后端也能持久化）
    if (typeof window === "undefined") return audioData.timestamps;
    const overrides = loadTimestampOverrides(audioData.id);
    return applyTimestampOverrides(audioData.timestamps, overrides);
  });

  const timelineMax = Math.max(
    audioData.duration || 0,
    ...timestamps.map((t) => t.endTime),
    ...adsbData.map((d) => d.timestamp)
  );

  // 同步 audioData 的 timestamps 变化
  useEffect(() => {
    const overrides = loadTimestampOverrides(audioData.id);
    setTimestamps(applyTimestampOverrides(audioData.timestamps, overrides));
  }, [audioData.timestamps]);

  return (
    <PlaybackProvider timelineMax={timelineMax || 60}>
      <AnnotationPageInner
        audioData={audioData}
        adsbData={adsbData}
        recordings={recordings}
        recordingMeta={recordingMeta}
        onSelectRecording={onSelectRecording}
        timestamps={timestamps}
        setTimestamps={setTimestamps}
        timelineMax={timelineMax || 60}
      />
    </PlaybackProvider>
  );
}

type AnnotationPageInnerProps = AnnotationPageProps & {
  timestamps: VoiceTimestamp[];
  setTimestamps: React.Dispatch<React.SetStateAction<VoiceTimestamp[]>>;
  timelineMax: number;
};

function AnnotationPageInner({
  audioData,
  adsbData,
  recordings = [audioData],
  recordingMeta = {},
  onSelectRecording,
  timestamps,
  setTimestamps,
  timelineMax,
}: AnnotationPageInnerProps) {
  const { currentTime, setCurrentTime } = usePlayback();
  const [selectedTimestamp, setSelectedTimestamp] = useState<VoiceTimestamp | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<string | undefined>();
  const [isEditing, setIsEditing] = useState(false);
  const { toast } = useToast();
  const [layerToggles, setLayerToggles] = useState<LayerTogglesState>({
    runways: true,
    taxiways: true,
    waypoints: true,
    landmarks: true,
    trails: true,
  });
  const [visibleAircraftSet, setVisibleAircraftSet] = useState<Set<string>>(new Set());
  const [activeBottomTab, setActiveBottomTab] = useState<
    "map" | "transcripts" | "radio" | "audio" | "settings"
  >("transcripts");
  const mapSectionRef = useRef<HTMLDivElement>(null);
  const audioWaveformRef = useRef<AudioWaveformHandle>(null);
  const transcriptSectionRef = useRef<HTMLDivElement>(null);
  const radioSectionRef = useRef<HTMLDivElement>(null);
  const audioSectionRef = useRef<HTMLDivElement>(null);
  const settingsSectionRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // 从音频数据中提取所有唯一的飞机 ICAO24
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
    setIsEditing(false);
  }, [setCurrentTime]);

  // 处理时间戳编辑
  const handleTimestampEdit = useCallback((timestamp: VoiceTimestamp) => {
    setSelectedTimestamp(timestamp);
    setIsEditing(true);
  }, []);

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
          setIsEditing(false);
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

          toast({
            title: "成功",
            description: "时间戳已更新",
          });
          setIsEditing(false);
          setSelectedTimestamp(null);
        } else {
          // fallback：本地保存
          const updatedTimestamps = timestamps.map((ts) =>
            ts.id === updatedTimestamp.id ? updatedTimestamp : ts
          );
          setTimestamps(updatedTimestamps);
          saveTimestampOverride(audioData.id, updatedTimestamp);
          toast({
            title: "已本地保存",
            description: "后端未就绪/保存失败，已先保存到浏览器本地（待后续同步）",
          });
          setIsEditing(false);
          setSelectedTimestamp(null);
        }
      } catch (error) {
        // fallback：本地保存
        const updatedTimestamps = timestamps.map((ts) =>
          ts.id === updatedTimestamp.id ? updatedTimestamp : ts
        );
        setTimestamps(updatedTimestamps);
        saveTimestampOverride(audioData.id, updatedTimestamp);
        toast({
          title: "已本地保存",
          description: "网络/后端异常，已先保存到浏览器本地（待后续同步）",
        });
        setIsEditing(false);
        setSelectedTimestamp(null);
      }
    },
    [audioData.id, audioData.url, timestamps, toast]
  );

  // 取消编辑
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setSelectedTimestamp(null);
  }, []);

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
          staticLayers: vhhhStatic,
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
  }, [audioData, timestamps, adsbData, toast]);

  return (
    <div className="min-h-screen flex flex-col efb-surface">
      <EfbTopbar
        title="ATC Transcriptions & Playback"
        subtitle={`Audio: ${audioData.id} · Targets: ${aircraftList.length}`}
      />

      {/* 主内容区 */}
      <div ref={contentScrollRef} className="flex-1 overflow-y-auto scroll-smooth p-3">
        <div className="grid grid-cols-12 gap-3">
        {/* 左侧：转写列表（Stratus-like） */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-3">
          <div ref={radioSectionRef}>
            <RecordingsPanel
              recordings={recordings}
              activeId={audioData.id}
              onSelect={(id) => onSelectRecording?.(id)}
              recordingMeta={recordingMeta}
            />
          </div>
          <div ref={audioSectionRef}>
            <Card className="p-4 rounded-3xl border-border/70 efb-panel efb-glow">
              <AudioWaveform
                ref={audioWaveformRef}
                audioUrl={audioData.url}
                timestamps={timestamps}
                currentTime={currentTime}
                onTimeUpdate={handleTimeUpdate}
                onTimestampClick={handleTimestampClick}
              />
            </Card>
          </div>

          <div ref={transcriptSectionRef}>
            <TimestampList
              timestamps={timestamps}
              currentTime={currentTime}
              selectedTimestampId={selectedTimestamp?.id}
              onTimestampClick={handleTimestampClick}
              onTimestampEdit={handleTimestampEdit}
            />
          </div>
        </div>

        {/* 中间：地图/航迹 */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-3">
          <div ref={mapSectionRef}>
            <Card className="h-[420px] p-3 rounded-3xl border-border/70 efb-panel efb-glow">
              <ADSBMap
                adsbData={adsbData}
                visibleAircraftSet={visibleAircraftSet}
                staticLayers={vhhhStatic}
                toggles={layerToggles}
                currentTime={currentTime}
                selectedAircraft={selectedAircraft}
                onAircraftSelect={handleAircraftSelect}
              />
            </Card>
          </div>

          <div className="h-[320px]">
            {isEditing && selectedTimestamp ? (
              <div className="relative">
                <TextEditor
                  timestamp={selectedTimestamp}
                  onSave={handleSaveTimestamp}
                  onCancel={handleCancelEdit}
                  onPlay={(startTime, endTime) => {
                    audioWaveformRef.current?.playSegment(startTime, endTime);
                  }}
                />
              </div>
            ) : (
              <Card className="h-full p-4 rounded-3xl border-border/70 efb-panel efb-glow">
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  {selectedTimestamp ? (
                    <div className="text-center">
                      <p className="font-medium mb-2">
                        {selectedTimestamp.text}
                      </p>
                      <p className="text-sm">
                        点击“编辑”按钮修改此时间戳
                      </p>
                    </div>
                  ) : (
                    <p>选择一个时间戳进行编辑</p>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* 右侧：仪表 + 辅助信息 */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-3">
          <TargetsPanel
            adsbData={adsbData}
            visibleSet={visibleAircraftSet}
            onVisibleSetChange={setVisibleAircraftSet}
            selectedAircraft={selectedAircraft}
            onSelectAircraft={handleAircraftSelect}
          />
          <div ref={settingsSectionRef}>
            <LayerToggles value={layerToggles} onChange={setLayerToggles} />
          </div>
          <TimeRover value={currentTime} max={timelineMax || 60} onChange={(t) => setCurrentTime(t, "ui")} />
          <InstrumentPanel
            currentTime={currentTime}
            selectedAircraft={selectedAircraft}
            adsbData={adsbData}
          />
          <div className="min-h-[280px]">
            <AuxiliaryInfo
              audioData={audioData}
              adsbData={adsbData}
              currentTime={currentTime}
              selectedAircraft={selectedAircraft}
            />
          </div>
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
