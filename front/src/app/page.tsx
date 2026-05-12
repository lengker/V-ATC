"use client";

// 为了让前端在没有后端的情况下也能预览完整 UI，
// 这里默认使用本地 mock 数据。后续接入后端时，
// 只需要把 demo 数据替换为调用 API 的结果即可。

import { AnnotationPage } from "@/components/annotation-page";
import { demoAdsbTrack, demoRecordings, demoRecordingMeta } from "@/mock/demo-data";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { fetchAnnotationBundle } from "@/lib/backend-api";
import { AudioData, ADSBData } from "@/types";
import type { RecordingMeta } from "@/mock/demo-data";
import { useToast } from "@/hooks/use-toast";

type HomeDataBundle = {
  recordings: AudioData[];
  adsbData: ADSBData[];
  recordingMeta: Record<string, RecordingMeta>;
};

function HomeContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [bundle, setBundle] = useState<HomeDataBundle>({
    recordings: demoRecordings,
    adsbData: demoAdsbTrack,
    recordingMeta: demoRecordingMeta,
  });

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const remote = await fetchAnnotationBundle();
        if (!active) return;
        if (!remote.recordings.length) {
          throw new Error("后端暂无 audio_records 数据");
        }
        setBundle(remote);
      } catch (error) {
        if (!active) return;
        const reason = error instanceof Error ? error.message : "unknown";
        toast({
          title: "已切回演示数据",
          description: `后端联调数据拉取失败：${reason}`,
          variant: "destructive",
        });
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [toast]);

  const audioId = params.get("audioId") ?? bundle.recordings[0]?.id ?? "";
  const recordings = bundle.recordings.length ? bundle.recordings : demoRecordings;

  const active = useMemo(
    () => recordings.find((x) => x.id === audioId) ?? recordings[0],
    [audioId, recordings]
  );

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading data...</div>;
  }

  if (!active) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">No recording data</div>;
  }

  return (
    <AnnotationPage
      audioData={active}
      adsbData={bundle.adsbData}
      recordings={recordings}
      recordingMeta={bundle.recordingMeta}
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
