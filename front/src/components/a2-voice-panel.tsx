"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Radio, Search, Square, Upload } from "lucide-react";
import { a1RouteAPI, a2VoiceAPI, audioAPI, type A2VoiceRecord } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { AudioData } from "@/types";
import { cn } from "@/lib/utils";

const TEXT = {
  alphaSyncFailed: "Alpha \u540c\u6b65\u5931\u8d25",
  archiveSlot: "\u5f52\u6863\u65f6\u6bb5",
  band: "\u9891\u6bb5",
  countUnit: "\u6761",
  download: "\u4e0b\u8f7d",
  downloadAndImport: "\u4e0b\u8f7d\u5bfc\u5165",
  downloadComplete: "\u4e0b\u8f7d\u5b8c\u6210",
  downloadCreateFailed: "\u4e0b\u8f7d\u4efb\u52a1\u521b\u5efa\u5931\u8d25",
  downloadFailed: "\u4e0b\u8f7d\u5931\u8d25",
  downloadImported: "\u4e0b\u8f7d\u5e76\u5bfc\u5165\u5b8c\u6210",
  endTime: "\u7ed3\u675f\u65f6\u95f4",
  fileImport: "\u5bfc\u5165",
  fileImportComplete: "\u97f3\u9891\u5bfc\u5165\u5b8c\u6210",
  fileImportCreateFailed: "\u5bfc\u5165\u4efb\u52a1\u521b\u5efa\u5931\u8d25",
  fileImportFailed: "\u97f3\u9891\u5bfc\u5165\u5931\u8d25",
  format: "\u683c\u5f0f",
  noRecordReturned: "\u540e\u7aef\u672a\u8fd4\u56de\u8bed\u97f3\u8bb0\u5f55\uff0c\u8bf7\u7a0d\u540e\u67e5\u8be2\u3002",
  openWaveform: "\u8f7d\u5165\u6ce2\u5f62",
  progressCreateTask: "\u521b\u5efa\u4e0b\u8f7d\u4efb\u52a1",
  progressDownload: "\u6b63\u5728\u4e0b\u8f7d\u97f3\u9891",
  progressImport: "\u6b63\u5728\u5bfc\u5165\u6ce2\u5f62",
  progressRefresh: "\u5237\u65b0\u5f55\u97f3\u5217\u8868",
  progressSync: "\u540c\u6b65 Alpha \u5143\u6570\u636e",
  query: "\u67e5\u8be2",
  queryComplete: "\u67e5\u8be2\u5b8c\u6210",
  queryFailed: "\u67e5\u8be2\u5931\u8d25",
  queryRange: "\u67e5\u8be2\u8303\u56f4",
  realtime: "\u5b9e\u65f6\u4e0b\u8f7d",
  realtimeCreateFailed: "\u5b9e\u65f6\u4efb\u52a1\u521b\u5efa\u5931\u8d25",
  realtimeProgressAdsb: "\u542f\u52a8 ADS-B \u822a\u8ff9",
  realtimeProgressCreate: "\u521b\u5efa\u5b9e\u65f6\u4efb\u52a1",
  realtimeProgressListening: "\u5b9e\u65f6\u4e0b\u8f7d\u8fd0\u884c\u4e2d",
  realtimeProgressStart: "\u542f\u52a8\u5b9e\u65f6\u63a5\u6536",
  realtimeProgressStop: "\u505c\u6b62\u5b9e\u65f6\u63a5\u6536",
  realtimeProgressStopAdsb: "\u505c\u6b62 ADS-B \u822a\u8ff9",
  realtimeProgressSync: "\u68c0\u67e5\u5b9e\u65f6\u65b0\u7247\u6bb5",
  realtimeStarting: "\u542f\u52a8\u4e2d",
  realtimeStarted: "\u5b9e\u65f6\u4e0b\u8f7d\u5df2\u542f\u52a8",
  realtimeStartFailed: "\u5b9e\u65f6\u4e0b\u8f7d\u542f\u52a8\u5931\u8d25",
  realtimeStopped: "\u5b9e\u65f6\u4e0b\u8f7d\u5df2\u505c\u6b62",
  realtimeStopping: "\u505c\u6b62\u4e2d",
  realtimeStopFailed: "\u505c\u6b62\u5b9e\u65f6\u4e0b\u8f7d\u5931\u8d25",
  adsbRealtimeStartFailed: "ADS-B \u5b9e\u65f6\u822a\u8ff9\u542f\u52a8\u5931\u8d25",
  adsbRealtimeStopFailed: "ADS-B \u5b9e\u65f6\u822a\u8ff9\u505c\u6b62\u5931\u8d25",
  recordsHit: "\u6761\u8bed\u97f3\u7247\u6bb5",
  sourceUrl: "\u97f3\u9891/LiveATC URL",
  startTime: "\u5f00\u59cb\u65f6\u95f4",
  stopRealtime: "\u505c\u6b62\u5b9e\u65f6",
  title: "\u8bed\u97f3\u6570\u636e",
};

type ProgressState = {
  label: string;
  value: number;
  detail?: string;
};

function toA2DateTime(value: string) {
  return value ? value.replace("T", " ") + ":00" : "";
}

function toLiveAtcDate(value: string) {
  return value.replaceAll("-", "");
}

function escapeXmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function resolveRealtimeStreamUrl(value: string) {
  const source = value.trim();
  try {
    const url = new URL(source);
    const mount = url.searchParams.get("m") || url.searchParams.get("mount");
    if (mount && url.hostname.includes("liveatc.net")) {
      return `http://d.liveatc.net/${mount}.mp3`;
    }
  } catch {
    return source;
  }
  return source;
}

function buildRealtimeAsxContent(sourceUrl: string) {
  const streamUrl = resolveRealtimeStreamUrl(sourceUrl);
  return `<asx version="3.0">
<entry>
 <ref href="${escapeXmlAttribute(streamUrl)}"/>
<abstract>VHHH App/Dep/Dir/Zone</abstract>
</entry>
</asx>
`;
}

function toDateTimeInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toA2UtcDateTime(date: Date) {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function defaultArchiveStartTime() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  date.setHours(0, 0, 0, 0);
  return toDateTimeInputValue(date);
}

function defaultArchiveEndTime() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  date.setHours(0, 30, 0, 0);
  return toDateTimeInputValue(date);
}

function isA2VoiceRecord(value: unknown): value is A2VoiceRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    "unique_id" in value &&
    "icao_code" in value &&
    "band" in value &&
    "start_at" in value &&
    "end_at" in value
  );
}

export function A2VoicePanel({
  onRefreshRecordings,
  onSelectRecording,
  onLoadRecording,
  className,
}: {
  onRefreshRecordings?: () => void;
  onSelectRecording?: (id: string) => void;
  onLoadRecording?: (audio: AudioData) => void;
  className?: string;
}) {
  const { toast } = useToast();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [icaoCode, setIcaoCode] = useState("VHHH");
  const [band, setBand] = useState("string");
  const [startTime, setStartTime] = useState(defaultArchiveStartTime);
  const [endTime, setEndTime] = useState(defaultArchiveEndTime);
  const [sourceUrl, setSourceUrl] = useState("https://www.liveatc.net/archive.php?m=vhhh5");
  const [liveAtcSlot, setLiveAtcSlot] = useState("0000-0030");
  const [outputFormat, setOutputFormat] = useState<"wav" | "mp3">("wav");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<ProgressState | null>(null);
  const busyActionRef = useRef<string | null>(null);
  const [records, setRecords] = useState<A2VoiceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [realtimeTaskId, setRealtimeTaskId] = useState<number | null>(null);
  const [adsbRealtimeTaskId, setAdsbRealtimeTaskId] = useState<string | null>(null);
  const realtimeStartedAtRef = useRef<Date | null>(null);
  const loadedRealtimeRecordIdsRef = useRef<Set<string>>(new Set());

  const recordToAudioData = (record: A2VoiceRecord): AudioData => {
    const startMs = Date.parse(record.start_at);
    const endMs = Date.parse(record.end_at);
    const duration =
      Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, Math.round((endMs - startMs) / 1000))
        : 0;

    return {
      id: record.unique_id,
      url: a2VoiceAPI.playableFileUrl(record.unique_id),
      duration,
      timestamps: [],
      metadata: {
        icao: record.icao_code,
        date: record.original_time ?? record.start_at,
        startAt: record.start_at,
        endAt: record.end_at,
        frequency: record.band,
        fileName: record.file_name ?? undefined,
        asrUrl: a2VoiceAPI.fileUrl(record.unique_id),
      },
    };
  };

  const queryPayload = useMemo(
    () => ({
      icaoCode: icaoCode.trim().toUpperCase(),
      band: band.trim(),
      startTime: toA2DateTime(startTime),
      endTime: toA2DateTime(endTime),
      pageNum: 1,
      pageSize: 20,
    }),
    [band, endTime, icaoCode, startTime]
  );

  const refreshVoiceRecords = useCallback(async (showToast = true) => {
    const res = await a2VoiceAPI.queryVoice(queryPayload);
    if (!res.success || !res.data) {
      toast({ title: TEXT.queryFailed, description: res.error, variant: "destructive" });
      return false;
    }
    setRecords(res.data.items);
    setTotal(res.data.total);
    if (showToast) {
      toast({ title: TEXT.queryComplete, description: `${res.data.total} ${TEXT.recordsHit}` });
    }
    return true;
  }, [queryPayload, toast]);

  const runAction = async (action: string, fn: () => Promise<void>) => {
    if (busyActionRef.current !== null) return;
    busyActionRef.current = action;
    setBusyAction(action);
    try {
      await fn();
    } finally {
      busyActionRef.current = null;
      setBusyAction(null);
    }
  };

  const attachDownloadedRecord = useCallback(async (record: A2VoiceRecord) => {
    onLoadRecording?.(recordToAudioData(record));
    setRecords((prev) => {
      const next = [record, ...prev.filter((item) => item.unique_id !== record.unique_id)];
      setTotal((current) => Math.max(current, next.length));
      return next;
    });
    const alphaRes = await audioAPI.saveA2AudioMetadata(record);
    onRefreshRecordings?.();
    onSelectRecording?.(record.unique_id);
    return alphaRes;
  }, [onLoadRecording, onRefreshRecordings, onSelectRecording]);

  const syncRealtimeRecords = useCallback(async (showToast = false) => {
    const startedAt = realtimeStartedAtRef.current;
    if (!startedAt) return;

    setDownloadProgress({
      label: TEXT.realtimeProgressSync,
      value: 94,
      detail: "\u6bcf 15 \u79d2\u81ea\u52a8\u68c0\u67e5\u4e00\u6b21",
    });
    const windowStart = new Date(startedAt.getTime() - 30_000);
    const windowEnd = new Date(Date.now() + 60_000);
    const res = await a2VoiceAPI.queryVoice({
      icaoCode: queryPayload.icaoCode,
      band: queryPayload.band,
      startTime: toA2UtcDateTime(windowStart),
      endTime: toA2UtcDateTime(windowEnd),
      pageNum: 1,
      pageSize: 200,
    });
    if (!res.success || !res.data) {
      setDownloadProgress({
        label: TEXT.realtimeProgressListening,
        value: 90,
        detail: res.error ?? "\u7b49\u5f85\u4e0b\u4e00\u6b21\u81ea\u52a8\u68c0\u67e5",
      });
      return;
    }

    const realtimeItems = res.data.items.filter((record) => record.data_type === "S");
    setRecords(realtimeItems);
    setTotal(realtimeItems.length);

    const newRecords = realtimeItems.filter((record) => !loadedRealtimeRecordIdsRef.current.has(record.unique_id));
    if (newRecords.length === 0) {
      setDownloadProgress({
        label: TEXT.realtimeProgressListening,
        value: 90,
        detail: `${realtimeItems.length} ${TEXT.recordsHit}; \u7b49\u5f85\u65b0\u7247\u6bb5`,
      });
      return;
    }

    newRecords.forEach((record) => loadedRealtimeRecordIdsRef.current.add(record.unique_id));
    let latestAlphaSuccess = true;
    for (const record of newRecords) {
      const alphaRes = await attachDownloadedRecord(record);
      latestAlphaSuccess = alphaRes.success;
    }
    const latest = newRecords[newRecords.length - 1];
    if (showToast) {
      toast({
        title: TEXT.downloadImported,
        description: latestAlphaSuccess ? latest.unique_id : `${latest.unique_id}; ${TEXT.alphaSyncFailed}`,
      });
    }
    setDownloadProgress({
      label: TEXT.realtimeProgressListening,
      value: 90,
      detail: `${newRecords.length} \u6761\u65b0\u7247\u6bb5\uff1a${latest.unique_id}`,
    });
  }, [attachDownloadedRecord, queryPayload.band, queryPayload.icaoCode, toast]);

  useEffect(() => {
    if (!realtimeTaskId) return;
    const intervalId = window.setInterval(() => {
      void syncRealtimeRecords();
    }, 15000);
    void syncRealtimeRecords();
    return () => window.clearInterval(intervalId);
  }, [realtimeTaskId, syncRealtimeRecords]);

  const openRecordInWaveform = (record: A2VoiceRecord) =>
    runAction(`open-${record.unique_id}`, async () => {
      const alphaRes = await attachDownloadedRecord(record);
      toast({
        title: TEXT.openWaveform,
        description: alphaRes.success ? record.unique_id : `${record.unique_id}; ${TEXT.alphaSyncFailed}`,
      });
    });

  const queryVoice = () =>
    runAction("query", async () => {
      await refreshVoiceRecords(true);
    });

  const createAndStartRealtimeFromAsx = async () => {
    setDownloadProgress({ label: TEXT.realtimeProgressCreate, value: 15, detail: queryPayload.icaoCode });
    const taskRes = await a2VoiceAPI.createRealtimeTaskFromAsx({
      taskName: `${queryPayload.icaoCode}-${queryPayload.band}-realtime`,
      icaoCode: queryPayload.icaoCode,
      band: queryPayload.band,
      asxContent: buildRealtimeAsxContent(sourceUrl),
      filename: `${queryPayload.icaoCode.toLowerCase()}.asx`,
      segmentSeconds: 60,
      preferredRef: 0,
    });
    if (!taskRes.success || !taskRes.data) {
      toast({ title: TEXT.realtimeCreateFailed, description: taskRes.error, variant: "destructive" });
      setDownloadProgress(null);
      return;
    }

    setDownloadProgress({
      label: TEXT.realtimeProgressStart,
      value: 45,
      detail: `A2 taskId: ${taskRes.data.taskId}`,
    });
    const startRes = await a2VoiceAPI.startRealtimeReceive(taskRes.data.taskId);
    if (!startRes.success || !startRes.data) {
      toast({ title: TEXT.realtimeStartFailed, description: startRes.error, variant: "destructive" });
      setDownloadProgress(null);
      return;
    }
    setRealtimeTaskId(taskRes.data.taskId);
    realtimeStartedAtRef.current = new Date();
    loadedRealtimeRecordIdsRef.current = new Set();

    const adsbTaskId = `front-${queryPayload.icaoCode.toLowerCase()}-${queryPayload.band.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}-${taskRes.data.taskId}`;
    setDownloadProgress({
      label: TEXT.realtimeProgressAdsb,
      value: 72,
      detail: adsbTaskId,
    });
    const adsbRes = await a1RouteAPI.startRouteCrawlTask({
      taskId: adsbTaskId,
      provider: "airplanes-live",
      preset: queryPayload.icaoCode.toLowerCase() === "vhhh" ? "vhhh" : "hongkong",
      limit: 1000,
      intervalSeconds: 30,
      maxRoutePoints: 5000,
    });
    if (adsbRes.success && adsbRes.data) {
      setAdsbRealtimeTaskId(adsbRes.data.task_id);
      setDownloadProgress({
        label: TEXT.realtimeProgressListening,
        value: 90,
        detail: `A2 taskId: ${taskRes.data.taskId}; A1 taskId: ${adsbRes.data.task_id}`,
      });
      toast({
        title: TEXT.realtimeStarted,
        description: `A2 taskId: ${taskRes.data.taskId}; A1 taskId: ${adsbRes.data.task_id}`,
      });
      return;
    }

    setAdsbRealtimeTaskId(null);
    setDownloadProgress({
      label: TEXT.realtimeProgressListening,
      value: 90,
      detail: `A2 taskId: ${taskRes.data.taskId}; ADS-B \u542f\u52a8\u5931\u8d25`,
    });
    toast({
      title: TEXT.adsbRealtimeStartFailed,
      description: adsbRes.error ?? `A2 taskId: ${taskRes.data.taskId}`,
      variant: "destructive",
    });
  };

  const executeDownload = () =>
    runAction("download", async () => {
      setDownloadProgress({ label: TEXT.progressCreateTask, value: 8 });
      const taskRes = await a2VoiceAPI.createDownloadTask({
        task_name: `${queryPayload.icaoCode}-${queryPayload.band}-${queryPayload.startTime}`,
        icao_code: queryPayload.icaoCode,
        band: queryPayload.band,
        start_time: queryPayload.startTime,
        end_time: queryPayload.endTime,
      });
      if (!taskRes.success || !taskRes.data) {
        toast({ title: TEXT.downloadCreateFailed, description: taskRes.error, variant: "destructive" });
        setDownloadProgress(null);
        return;
      }

      const isLiveAtcArchive = sourceUrl.includes("liveatc.net/archive");
      setDownloadProgress({
        label: TEXT.progressDownload,
        value: 28,
        detail: isLiveAtcArchive ? liveAtcSlot.trim() : queryPayload.startTime,
      });
      const downloadRes = isLiveAtcArchive
        ? await a2VoiceAPI.executeLiveAtcDownload({
            source_url: sourceUrl.trim(),
            date: toLiveAtcDate(startTime.slice(0, 10)),
            time: liveAtcSlot.trim().endsWith("Z") ? liveAtcSlot.trim() : `${liveAtcSlot.trim()}Z`,
            icao_code: queryPayload.icaoCode,
            band: queryPayload.band,
          })
        : await a2VoiceAPI.executeDownloadTask({
            task_id: taskRes.data.taskId,
            source_url: sourceUrl.trim(),
            icao_code: queryPayload.icaoCode,
            band: queryPayload.band,
            start_time: queryPayload.startTime,
            end_time: queryPayload.endTime,
            original_time: queryPayload.startTime,
          });

      if (!downloadRes.success || !downloadRes.data) {
        toast({ title: TEXT.downloadFailed, description: downloadRes.error, variant: "destructive" });
        setDownloadProgress(null);
        return;
      }

      setDownloadProgress({ label: TEXT.progressImport, value: 68 });
      const record = isA2VoiceRecord(downloadRes.data)
        ? downloadRes.data
        : isA2VoiceRecord(downloadRes.data.record)
          ? downloadRes.data.record
          : null;
      if (!record) {
        toast({ title: TEXT.downloadComplete, description: TEXT.noRecordReturned });
        setDownloadProgress({ label: TEXT.progressRefresh, value: 88 });
        await refreshVoiceRecords(false);
        setDownloadProgress(null);
        return;
      }

      setDownloadProgress({ label: TEXT.progressSync, value: 82, detail: record.unique_id });
      const alphaRes = await attachDownloadedRecord(record);
      toast({
        title: TEXT.downloadImported,
        description: alphaRes.success ? record.unique_id : `${record.unique_id}; ${TEXT.alphaSyncFailed}`,
      });
      setDownloadProgress({ label: TEXT.progressRefresh, value: 94, detail: record.unique_id });
      await refreshVoiceRecords(false);
      setDownloadProgress({ label: TEXT.downloadImported, value: 100, detail: record.unique_id });
      window.setTimeout(() => setDownloadProgress(null), 800);
    });

  const startRealtimeDownload = () =>
    runAction("realtime-start", async () => {
      await createAndStartRealtimeFromAsx();
    });

  const stopRealtimeDownload = () =>
    runAction("realtime-stop", async () => {
      if (!realtimeTaskId) return;
      setDownloadProgress({
        label: TEXT.realtimeProgressStop,
        value: 35,
        detail: `A2 taskId: ${realtimeTaskId}`,
      });
      const res = await a2VoiceAPI.stopRealtimeReceive(realtimeTaskId);
      if (!res.success) {
        toast({ title: TEXT.realtimeStopFailed, description: res.error, variant: "destructive" });
        setDownloadProgress({
          label: TEXT.realtimeProgressListening,
          value: 90,
          detail: res.error,
        });
      }
      if (adsbRealtimeTaskId) {
        setDownloadProgress({
          label: TEXT.realtimeProgressStopAdsb,
          value: 62,
          detail: adsbRealtimeTaskId,
        });
        const adsbRes = await a1RouteAPI.stopRouteCrawlTask(adsbRealtimeTaskId);
        if (!adsbRes.success) {
          toast({ title: TEXT.adsbRealtimeStopFailed, description: adsbRes.error, variant: "destructive" });
        }
        setAdsbRealtimeTaskId(null);
      }
      if (!res.success) return;
      setDownloadProgress({ label: TEXT.realtimeProgressSync, value: 84 });
      await syncRealtimeRecords(true);
      setRealtimeTaskId(null);
      onRefreshRecordings?.();
      setDownloadProgress({ label: TEXT.realtimeStopped, value: 100 });
      window.setTimeout(() => setDownloadProgress(null), 800);
      toast({ title: TEXT.realtimeStopped });
    });

  const importAudio = async (file: File) => {
    await runAction("import", async () => {
      const taskRes = await a2VoiceAPI.createDownloadTask({
        task_name: `${queryPayload.icaoCode}-${queryPayload.band}-${file.name}`,
        icao_code: queryPayload.icaoCode,
        band: queryPayload.band,
        start_time: queryPayload.startTime,
        end_time: queryPayload.endTime,
      });
      if (!taskRes.success || !taskRes.data) {
        toast({ title: TEXT.fileImportCreateFailed, description: taskRes.error, variant: "destructive" });
        return;
      }

      const importRes = await a2VoiceAPI.importHistoryFile({
        file,
        taskId: taskRes.data.taskId,
        icaoCode: queryPayload.icaoCode,
        band: queryPayload.band,
        startAt: queryPayload.startTime,
        endAt: queryPayload.endTime,
        originalTime: queryPayload.startTime,
      });
      if (!importRes.success || !importRes.data) {
        toast({ title: TEXT.fileImportFailed, description: importRes.error, variant: "destructive" });
        return;
      }

      const alphaRes = await attachDownloadedRecord(importRes.data);
      toast({
        title: TEXT.fileImportComplete,
        description: alphaRes.success ? importRes.data.unique_id : `${importRes.data.unique_id}; ${TEXT.alphaSyncFailed}`,
      });
      await queryVoice();
    });
  };

  return (
    <Card className={cn("flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-border/70 efb-panel efb-glow", className)}>
      <CardHeader className="shrink-0 border-b border-border/40 bg-gradient-to-br from-background/35 to-transparent px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight">{TEXT.title}</CardTitle>
          <span className="rounded-full bg-background/50 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/50">
            {total} {TEXT.countUnit}
          </span>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <Label className="text-xs">机场四字码</Label>
            <Input value={icaoCode} onChange={(e) => setIcaoCode(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{TEXT.band}</Label>
            <Input value={band} onChange={(e) => setBand(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{TEXT.startTime}</Label>
            <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{TEXT.endTime}</Label>
            <Input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>

        <div className="grid grid-cols-[1fr_92px] gap-1.5">
          <div className="space-y-1">
            <Label className="text-xs">{TEXT.sourceUrl}</Label>
            <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{TEXT.archiveSlot}</Label>
            <Input value={liveAtcSlot} onChange={(e) => setLiveAtcSlot(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>

        <div className="grid grid-cols-[1fr_92px] gap-1.5">
          <div className="space-y-1">
            <Label className="text-xs">{TEXT.queryRange}</Label>
            <div className="h-8 rounded-md border border-border/60 bg-background/30 px-2 py-1.5 text-xs text-muted-foreground">
              {queryPayload.icaoCode} / {queryPayload.band}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{TEXT.format}</Label>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as "wav" | "mp3")}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="wav">wav</option>
              <option value="mp3">mp3</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          <input
            ref={importInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.string"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importAudio(file);
            }}
          />
          <Button size="sm" className="h-8 px-2 text-xs" onClick={queryVoice} disabled={busyAction !== null}>
            <Search className="h-3.5 w-3.5" /> {TEXT.query}
          </Button>
          <Button size="sm" className="h-8 px-2 text-xs" variant="secondary" onClick={executeDownload} disabled={busyAction !== null || !sourceUrl.trim()}>
            {busyAction === "download" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {busyAction === "download" ? TEXT.progressDownload : TEXT.downloadAndImport}
          </Button>
          <Button
            size="sm"
            className="h-8 px-2 text-xs"
            variant={realtimeTaskId ? "destructive" : "secondary"}
            onClick={realtimeTaskId ? stopRealtimeDownload : startRealtimeDownload}
            disabled={busyAction !== null || !sourceUrl.trim()}
          >
            {busyAction === "realtime-start" || busyAction === "realtime-stop" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : realtimeTaskId ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <Radio className="h-3.5 w-3.5" />
            )}
            {busyAction === "realtime-start"
              ? TEXT.realtimeStarting
              : busyAction === "realtime-stop"
                ? TEXT.realtimeStopping
                : realtimeTaskId
                  ? TEXT.stopRealtime
                  : TEXT.realtime}
          </Button>
          <Button size="sm" className="h-8 px-2 text-xs" variant="outline" onClick={() => importInputRef.current?.click()} disabled={busyAction !== null}>
            <Upload className="h-3.5 w-3.5" /> {TEXT.fileImport}
          </Button>
        </div>

        {downloadProgress && (
          <div className="rounded-lg border border-border/60 bg-background/25 px-2.5 py-2 text-xs">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                {downloadProgress.value < 100 && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
                <span className="truncate font-medium">{downloadProgress.label}</span>
              </div>
              <span className="shrink-0 font-mono text-muted-foreground">{downloadProgress.value}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${downloadProgress.value}%` }}
              />
            </div>
            {downloadProgress.detail && (
              <div className="mt-1.5 truncate text-[11px] text-muted-foreground">{downloadProgress.detail}</div>
            )}
          </div>
        )}

        {records.length > 0 && (
          <div className="max-h-28 space-y-1.5 overflow-auto pr-1 text-xs">
            {records.map((record) => (
              <div key={record.unique_id} className="rounded-xl border border-border/60 bg-background/20 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate font-medium">{record.unique_id}</div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => openRecordInWaveform(record)}
                    disabled={busyAction !== null}
                  >
                    {TEXT.openWaveform}
                  </Button>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {record.icao_code} / {record.band} / {record.start_at} - {record.end_at}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
