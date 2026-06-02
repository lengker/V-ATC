"use client";

import { AnnotationPage } from "@/components/annotation-page";
import { EmptyState } from "@/components/empty-state";
import { audioAPI, adsbAPI } from "@/lib/api";
import type { ADSBData, AudioData } from "@/types";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const DEFAULT_AUDIO_ID = "VHHH_20260601085535221_9b3e8a";
const HIDDEN_AUDIO_IDS = new Set(["VHHH_20260526000000000_59_7122aa"]);
const EMPTY_AUDIO: AudioData = {
  id: "no-audio-selected",
  url: "",
  duration: 0,
  timestamps: [],
  metadata: {
    icao: "VHHH",
    frequency: "string",
  },
};

function HomeContent() {
  const router = useRouter();
  const params = useSearchParams();
  const audioId = params.get("audioId");
  const useBackend = process.env.NEXT_PUBLIC_USE_BACKEND !== "0";

  const [backendLoading, setBackendLoading] = useState(false);
  const [backendError, setBackendError] = useState<{ title: string; description?: string } | null>(null);
  const [backendRecordings, setBackendRecordings] = useState<AudioData[] | null>(null);
  const [backendActive, setBackendActive] = useState<AudioData | null>(null);
  const [backendAdsb, setBackendAdsb] = useState<ADSBData[] | null>(null);
  const [loadedA2Audio, setLoadedA2Audio] = useState<AudioData | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const effectiveBackendActive =
    loadedA2Audio?.id === audioId ? loadedA2Audio : backendActive;

  const handleLoadA2Recording = (audio: AudioData) => {
    setLoadedA2Audio(audio);
    router.replace(`/?audioId=${encodeURIComponent(audio.id)}`);
  };

  const handleSelectRecording = (id: string) => {
    if (loadedA2Audio?.id !== id) {
      setLoadedA2Audio(null);
    }
    const cached = backendRecordings?.find((item) => item.id === id);
    if (cached) {
      setBackendActive(cached);
      setBackendAdsb([]);
    }
    router.replace(`/?audioId=${encodeURIComponent(id)}`);
  };

  useEffect(() => {
    if (!useBackend) return;

    let cancelled = false;
    const run = async () => {
      setBackendLoading(true);
      setBackendError(null);

      const listRes = await audioAPI.getAudioList();
      if (cancelled) return;
      if (!listRes.success || !listRes.data) {
        setBackendError({
          title: "无法加载音频列表",
          description: listRes.error || "请检查后端是否启动，以及 NEXT_PUBLIC_API_BASE_URL 配置。",
        });
        setBackendRecordings(null);
        setBackendActive(null);
        setBackendAdsb(null);
        setBackendLoading(false);
        return;
      }

      const recordings = listRes.data.filter((item) => !HIDDEN_AUDIO_IDS.has(item.id));
      if (recordings.length === 0) {
        setBackendRecordings([]);
        setBackendActive(EMPTY_AUDIO);
        setBackendAdsb([]);
        setBackendLoading(false);
        return;
      }
      setBackendRecordings(recordings);
      const preferredId = audioId && recordings.find((x) => x.id === audioId)?.id;
      const defaultId = recordings.find((x) => x.id === DEFAULT_AUDIO_ID)?.id;
      const chosenId = preferredId ?? defaultId ?? recordings[0].id;

      const audioRes = await audioAPI.getAudio(chosenId);
      if (cancelled) return;
      if (!audioRes.success || !audioRes.data) {
        setBackendError({
          title: "无法加载音频详情",
          description: audioRes.error || "请稍后重试。",
        });
        setBackendActive(null);
        setBackendAdsb(null);
        setBackendLoading(false);
        return;
      }

      const audio = {
        ...audioRes.data,
        timestamps: Array.isArray(audioRes.data.timestamps) ? audioRes.data.timestamps : [],
      };

      await adsbAPI.refreshVhhhFromAirplanesLive();
      const adsbRes = await adsbAPI.getADSBData(audio);
      if (cancelled) return;
      setBackendActive(audio);
      setBackendAdsb(adsbRes.success && adsbRes.data ? adsbRes.data : []);
      setBackendLoading(false);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [audioId, reloadToken, useBackend]);

  useEffect(() => {
    if (!useBackend || !effectiveBackendActive) return;

    let cancelled = false;
    const refreshCurrentAdsb = async () => {
      const adsbRes = await adsbAPI.getADSBData(effectiveBackendActive);
      if (cancelled) return;
      if (adsbRes.success && adsbRes.data) {
        setBackendAdsb(adsbRes.data);
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshCurrentAdsb();
    }, 10_000);

    void refreshCurrentAdsb();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    effectiveBackendActive?.id,
    effectiveBackendActive?.duration,
    effectiveBackendActive?.metadata?.date,
    effectiveBackendActive?.metadata?.startAt,
    effectiveBackendActive?.metadata?.endAt,
    useBackend,
  ]);

  if (useBackend) {
    if (backendLoading) {
      return (
        <div className="grid min-h-screen place-items-center p-4">
          <div className="text-sm text-muted-foreground">加载后端数据中...</div>
        </div>
      );
    }

    if (backendError) {
      return (
        <div className="grid min-h-screen place-items-center p-4">
          <EmptyState
            title={backendError.title}
            description={backendError.description}
            actionLabel="重试"
            onAction={() => setReloadToken((x) => x + 1)}
            className="w-full max-w-[560px]"
          />
        </div>
      );
    }

    const effectiveBackendRecordings =
      backendRecordings?.map((item) => (backendActive?.id === item.id ? backendActive : item)) ?? null;
    const effectiveRecordings =
      loadedA2Audio && effectiveBackendRecordings
        ? [loadedA2Audio, ...effectiveBackendRecordings.filter((item) => item.id !== loadedA2Audio.id)]
        : effectiveBackendRecordings;

    if (effectiveBackendActive && backendAdsb && effectiveRecordings) {
      const visibleRecordings =
        effectiveRecordings.length > 0
          ? effectiveRecordings
          : effectiveBackendActive.id === EMPTY_AUDIO.id
            ? []
            : [effectiveBackendActive];
      return (
        <AnnotationPage
          audioData={effectiveBackendActive}
          adsbData={backendAdsb}
          recordings={visibleRecordings}
          recordingMeta={{}}
          onSelectRecording={handleSelectRecording}
          onLoadRecording={handleLoadA2Recording}
          onRefreshRecordings={() => setReloadToken((x) => x + 1)}
        />
      );
    }

    return (
      <div className="grid min-h-screen place-items-center p-4">
        <EmptyState
          title="数据未就绪"
          description="后端未返回可用数据，请重试。"
          actionLabel="重试"
          onAction={() => setReloadToken((x) => x + 1)}
          className="w-full max-w-[560px]"
        />
      </div>
    );
  }

  return (
    loadedA2Audio ? (
      <AnnotationPage
        audioData={loadedA2Audio}
        adsbData={[]}
        recordings={[loadedA2Audio]}
        recordingMeta={{}}
        onSelectRecording={handleSelectRecording}
        onLoadRecording={handleLoadA2Recording}
        onRefreshRecordings={() => setReloadToken((x) => x + 1)}
      />
    ) : (
      <div className="grid min-h-screen place-items-center p-4">
        <EmptyState
          title="暂无可用录音"
          description="未启用后端数据源，且没有从 A-2 导入真实录音。请启动后端服务，或设置 NEXT_PUBLIC_USE_BACKEND=1 后刷新。"
          className="w-full max-w-[560px]"
        />
      </div>
    )
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-muted-foreground">正在加载页面...</div>}>
      <HomeContent />
    </Suspense>
  );
}
