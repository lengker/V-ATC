"use client";

// 为了让前端在没有后端的情况下也能预览完整 UI，
// 这里默认使用本地 mock 数据。后续接入后端时，
// 只需要把 demo 数据替换为调用 API 的结果即可。

import { AnnotationPage } from "@/components/annotation-page";
import { demoAdsbTrack, demoRecordings, demoRecordingMeta } from "@/mock/demo-data";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { audioAPI, adsbAPI } from "@/lib/api";
import type { AudioData, ADSBData } from "@/types";
import { EmptyState } from "@/components/empty-state";

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
  const [reloadToken, setReloadToken] = useState(0);

  const active = useMemo(
    () => demoRecordings.find((x) => x.id === audioId) ?? demoRecordings[0],
    [audioId]
  );

  useEffect(() => {
    if (!useBackend) return;

    let cancelled = false;
    const run = async () => {
      setBackendLoading(true);
      setBackendError(null);

      const listRes = await audioAPI.getAudioList();
      if (cancelled) return;
      if (!listRes.success || !listRes.data || listRes.data.length === 0) {
        const status = listRes.status;
        const title = status === 404 ? "后端接口不存在（404）" : status === 500 ? "后端服务异常（500）" : "无法加载音频列表";
        setBackendError({ title, description: listRes.error || "请检查后端是否启动，以及 NEXT_PUBLIC_API_BASE_URL 配置。" });
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
        const status = audioRes.status;
        const title = status === 404 ? "音频资源不存在（404）" : status === 500 ? "后端服务异常（500）" : "无法加载音频详情";
        setBackendError({ title, description: audioRes.error || "请稍后重试。" });
        setBackendActive(null);
        setBackendAdsb(null);
        setBackendLoading(false);
        return;
      }

      const audio = audioRes.data;
      const hasAsrText = Array.isArray(audio.timestamps) && audio.timestamps.some((t) => (t.text ?? "").trim().length > 0);
      if (!hasAsrText) {
        setBackendError({
          title: "ASR 文本缺失",
          description: "当前音频未返回有效转写文本（timestamps 为空或 text 为空）。请确认后端已完成 ASR 处理后再重试。",
        });
        setBackendActive(null);
        setBackendAdsb(null);
        setBackendLoading(false);
        return;
      }

      const adsbRes = await adsbAPI.getADSBData(chosenId);
      if (cancelled) return;
      if (!adsbRes.success || !adsbRes.data) {
        const status = adsbRes.status;
        const title = status === 404 ? "ADSB 数据不存在（404）" : status === 500 ? "后端服务异常（500）" : "无法加载 ADSB 数据";
        setBackendError({ title, description: adsbRes.error || "请稍后重试。" });
        setBackendActive(null);
        setBackendAdsb(null);
        setBackendLoading(false);
        return;
      }

      setBackendActive(audio);
      setBackendAdsb(adsbRes.data);
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
        <div className="min-h-screen grid place-items-center p-4">
          <div className="text-sm text-muted-foreground">加载后端数据中...</div>
        </div>
      );
    }

    if (backendError) {
      return (
        <div className="min-h-screen p-4 grid place-items-center">
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

    if (backendActive && backendAdsb && backendRecordings) {
      return (
        <AnnotationPage
          audioData={backendActive}
          adsbData={backendAdsb}
          recordings={backendRecordings}
          recordingMeta={{}}
          onSelectRecording={(id) => router.replace(`/?audioId=${encodeURIComponent(id)}`)}
        />
      );
    }

    return (
      <div className="min-h-screen p-4 grid place-items-center">
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
      recordings={demoRecordings}
      recordingMeta={demoRecordingMeta}
      onSelectRecording={(id) => router.replace(`/?audioId=${encodeURIComponent(id)}`)}
    />
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading page...</div>}>
      <HomeContent />
    </Suspense>
  );
}
