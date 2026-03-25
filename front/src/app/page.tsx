"use client";

// 为了让前端在没有后端的情况下也能预览完整 UI，
// 这里默认使用本地 mock 数据。后续接入后端时，
// 只需要把 demo 数据替换为调用 API 的结果即可。

import { AnnotationPage } from "@/components/annotation-page";
import { demoAdsbTrack, demoRecordings, demoRecordingMeta } from "@/mock/demo-data";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

export default function Home() {
  const router = useRouter();
  const params = useSearchParams();
  const audioId = params.get("audioId") ?? demoRecordings[0].id;

  const active = useMemo(
    () => demoRecordings.find((x) => x.id === audioId) ?? demoRecordings[0],
    [audioId]
  );

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
