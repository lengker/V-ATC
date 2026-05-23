"use client";

import { useMemo, useRef, useState } from "react";
import { Download, Radio, Search, Square, Upload } from "lucide-react";
import { a2VoiceAPI, audioAPI, type A2VoiceRecord } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

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
  query: "\u67e5\u8be2",
  queryComplete: "\u67e5\u8be2\u5b8c\u6210",
  queryFailed: "\u67e5\u8be2\u5931\u8d25",
  queryRange: "\u67e5\u8be2\u8303\u56f4",
  realtime: "\u5b9e\u65f6\u4e0b\u8f7d",
  realtimeCreateFailed: "\u5b9e\u65f6\u4efb\u52a1\u521b\u5efa\u5931\u8d25",
  realtimeStarted: "\u5b9e\u65f6\u4e0b\u8f7d\u5df2\u542f\u52a8",
  realtimeStartFailed: "\u5b9e\u65f6\u4e0b\u8f7d\u542f\u52a8\u5931\u8d25",
  realtimeStopped: "\u5b9e\u65f6\u4e0b\u8f7d\u5df2\u505c\u6b62",
  realtimeStopFailed: "\u505c\u6b62\u5b9e\u65f6\u4e0b\u8f7d\u5931\u8d25",
  recordsHit: "\u6761\u8bed\u97f3\u7247\u6bb5",
  sourceUrl: "\u97f3\u9891/LiveATC URL",
  startTime: "\u5f00\u59cb\u65f6\u95f4",
  stopRealtime: "\u505c\u6b62\u5b9e\u65f6",
  title: "\u8bed\u97f3\u6570\u636e",
};

function toA2DateTime(value: string) {
  return value ? value.replace("T", " ") + ":00" : "";
}

function toLiveAtcDate(value: string) {
  return value.replaceAll("-", "");
}

function toDateTimeInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

export function A2VoicePanel({ onRefreshRecordings }: { onRefreshRecordings?: () => void }) {
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
  const busyActionRef = useRef<string | null>(null);
  const [records, setRecords] = useState<A2VoiceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [realtimeTaskId, setRealtimeTaskId] = useState<number | null>(null);

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

  const attachDownloadedRecord = async (record: A2VoiceRecord) => {
    setRecords((prev) => [record, ...prev.filter((item) => item.unique_id !== record.unique_id)]);
    setTotal((prev) => Math.max(prev + 1, 1));
    const alphaRes = await audioAPI.saveA2AudioMetadata(record);
    onRefreshRecordings?.();
    return alphaRes;
  };

  const queryVoice = () =>
    runAction("query", async () => {
      const res = await a2VoiceAPI.queryVoice(queryPayload);
      if (!res.success || !res.data) {
        toast({ title: TEXT.queryFailed, description: res.error, variant: "destructive" });
        return;
      }
      setRecords(res.data.items);
      setTotal(res.data.total);
      toast({ title: TEXT.queryComplete, description: `${res.data.total} ${TEXT.recordsHit}` });
    });

  const executeDownload = () =>
    runAction("download", async () => {
      const taskRes = await a2VoiceAPI.createDownloadTask({
        task_name: `${queryPayload.icaoCode}-${queryPayload.band}-${queryPayload.startTime}`,
        icao_code: queryPayload.icaoCode,
        band: queryPayload.band,
        start_time: queryPayload.startTime,
        end_time: queryPayload.endTime,
      });
      if (!taskRes.success || !taskRes.data) {
        toast({ title: TEXT.downloadCreateFailed, description: taskRes.error, variant: "destructive" });
        return;
      }

      const isLiveAtcArchive = sourceUrl.includes("liveatc.net/archive");
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
        return;
      }

      const record = isA2VoiceRecord(downloadRes.data)
        ? downloadRes.data
        : isA2VoiceRecord(downloadRes.data.record)
          ? downloadRes.data.record
          : null;
      if (!record) {
        toast({ title: TEXT.downloadComplete, description: TEXT.noRecordReturned });
        await queryVoice();
        return;
      }

      const alphaRes = await attachDownloadedRecord(record);
      toast({
        title: TEXT.downloadImported,
        description: alphaRes.success ? record.unique_id : `${record.unique_id}; ${TEXT.alphaSyncFailed}`,
      });
      await queryVoice();
    });

  const startRealtimeDownload = () =>
    runAction("realtime-start", async () => {
      const taskRes = await a2VoiceAPI.createRealtimeTask({
        task_name: `${queryPayload.icaoCode}-${queryPayload.band}-realtime`,
        icao_code: queryPayload.icaoCode,
        band: queryPayload.band,
        source_url: sourceUrl.trim(),
        segment_seconds: 30,
        stream_format: outputFormat,
      });
      if (!taskRes.success || !taskRes.data) {
        toast({ title: TEXT.realtimeCreateFailed, description: taskRes.error, variant: "destructive" });
        return;
      }

      const startRes = await a2VoiceAPI.startRealtimeReceive(taskRes.data.taskId);
      if (!startRes.success || !startRes.data) {
        toast({ title: TEXT.realtimeStartFailed, description: startRes.error, variant: "destructive" });
        return;
      }
      setRealtimeTaskId(taskRes.data.taskId);
      toast({ title: TEXT.realtimeStarted, description: `taskId: ${taskRes.data.taskId}` });
    });

  const stopRealtimeDownload = () =>
    runAction("realtime-stop", async () => {
      if (!realtimeTaskId) return;
      const res = await a2VoiceAPI.stopRealtimeReceive(realtimeTaskId);
      if (!res.success) {
        toast({ title: TEXT.realtimeStopFailed, description: res.error, variant: "destructive" });
        return;
      }
      setRealtimeTaskId(null);
      await queryVoice();
      onRefreshRecordings?.();
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
    <Card className="overflow-hidden rounded-2xl border-border/70 efb-panel efb-glow">
      <CardHeader className="border-b border-border/40 bg-gradient-to-br from-background/35 to-transparent px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight">{TEXT.title}</CardTitle>
          <span className="rounded-full bg-background/50 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/50">
            {total} {TEXT.countUnit}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 px-3 py-3">
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <Label className="text-xs">ICAO</Label>
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
            <Download className="h-3.5 w-3.5" /> {TEXT.downloadAndImport}
          </Button>
          <Button
            size="sm"
            className="h-8 px-2 text-xs"
            variant={realtimeTaskId ? "destructive" : "secondary"}
            onClick={realtimeTaskId ? stopRealtimeDownload : startRealtimeDownload}
            disabled={busyAction !== null || !sourceUrl.trim()}
          >
            {realtimeTaskId ? <Square className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
            {realtimeTaskId ? TEXT.stopRealtime : TEXT.realtime}
          </Button>
          <Button size="sm" className="h-8 px-2 text-xs" variant="outline" onClick={() => importInputRef.current?.click()} disabled={busyAction !== null}>
            <Upload className="h-3.5 w-3.5" /> {TEXT.fileImport}
          </Button>
        </div>

        {records.length > 0 && (
          <div className="max-h-36 space-y-1.5 overflow-auto pr-1 text-xs">
            {records.map((record) => (
              <div key={record.unique_id} className="rounded-xl border border-border/60 bg-background/20 p-2">
                <div className="truncate font-medium">{record.unique_id}</div>
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
