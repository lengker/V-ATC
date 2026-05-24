"use client";

import { AnnotationPage } from "@/components/annotation-page";
import { EmptyState } from "@/components/empty-state";
import { demoAdsbTrack, demoRecordings, demoRecordingMeta } from "@/mock/demo-data";
import { audioAPI, adsbAPI } from "@/lib/api";
import type { ADSBData, AudioData } from "@/types";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

function HomeContent() {
  const router = useRouter();
  const params = useSearchParams();
  const audioId = params.get("audioId") ?? demoRecordings[0].id;
  const useBackend = process.env.NEXT_PUBLIC_USE_BACKEND === "1";

  const [backendLoading, setBackendLoading] = useState(false);
  const [backendError, setBackendError] = useState<{ title: string; description?: string } | null>(null);
  const [backendRecordings, setBackendRecordings] = useState<AudioData[] | null>(null);
  const [backendActive, setBackendActive] = useState<AudioData | null>(null);
  const [backendAdsb, setBackendAdsb] = useState<ADSBData[] | null>(null);
  const [loadedA2Audio, setLoadedA2Audio] = useState<AudioData | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const active = useMemo(
    () =>
      loadedA2Audio?.id === audioId
        ? loadedA2Audio
        : demoRecordings.find((x) => x.id === audioId) ?? demoRecordings[0],
    [audioId, loadedA2Audio]
  );

  const demoRecordingsWithLoaded = useMemo(
    () =>
      loadedA2Audio
        ? [loadedA2Audio, ...demoRecordings.filter((item) => item.id !== loadedA2Audio.id)]
        : demoRecordings,
    [loadedA2Audio]
  );

  const handleLoadA2Recording = (audio: AudioData) => {
    setLoadedA2Audio(audio);
    router.replace(`/?audioId=${encodeURIComponent(audio.id)}`);
  };

  useEffect(() => {
    if (!useBackend) return;

    let cancelled = false;
    const run = async () => {
      setBackendLoading(true);
      setBackendError(null);

      const listRes = await audioAPI.getAudioList();
      if (cancelled) return;
      if (!listRes.success || !listRes.data || listRes.data.length === 0) {
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

      const recordings = listRes.data;
      setBackendRecordings(recordings);
      const chosenId = recordings.find((x) => x.id === audioId)?.id ?? recordings[0].id;

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

      const adsbRes = await adsbAPI.getADSBData(chosenId);
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

    const effectiveBackendActive =
      loadedA2Audio?.id === audioId ? loadedA2Audio : backendActive;
    const effectiveBackendRecordings =
      loadedA2Audio && backendRecordings
        ? [loadedA2Audio, ...backendRecordings.filter((item) => item.id !== loadedA2Audio.id)]
        : backendRecordings;

    if (effectiveBackendActive && backendAdsb && effectiveBackendRecordings) {
      return (
        <AnnotationPage
          audioData={effectiveBackendActive}
          adsbData={backendAdsb}
          recordings={effectiveBackendRecordings}
          recordingMeta={{}}
          onSelectRecording={(id) => router.replace(`/?audioId=${encodeURIComponent(id)}`)}
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
    <AnnotationPage
      audioData={active}
      adsbData={demoAdsbTrack}
      recordings={demoRecordingsWithLoaded}
      recordingMeta={demoRecordingMeta}
      onSelectRecording={(id) => router.replace(`/?audioId=${encodeURIComponent(id)}`)}
      onLoadRecording={handleLoadA2Recording}
      onRefreshRecordings={() => setReloadToken((x) => x + 1)}
    />
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading page...</div>}>
      <HomeContent />
    </Suspense>
  );
}
