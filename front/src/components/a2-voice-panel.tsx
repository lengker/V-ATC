"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileDown, ListFilter, RefreshCw, Search, Upload } from "lucide-react";
import { a2VoiceAPI, audioAPI, type A2VoiceRecord } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

function toA2DateTime(value: string) {
  return value ? value.replace("T", " ") + ":00" : "";
}

function toLiveAtcDate(value: string) {
  return value.replaceAll("-", "");
}

function downloadFromUrl(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function A2VoicePanel({ onRefreshRecordings }: { onRefreshRecordings?: () => void }) {
  const { toast } = useToast();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [icaoCode, setIcaoCode] = useState("VHHH");
  const [band, setBand] = useState("app-dep-dir-zone");
  const [startTime, setStartTime] = useState("2026-05-07T00:00");
  const [endTime, setEndTime] = useState("2026-05-07T00:30");
  const [sourceUrl, setSourceUrl] = useState("https://www.liveatc.net/archive.php?m=vhhh5");
  const [liveAtcSlot, setLiveAtcSlot] = useState("0000-0030Z");
  const [outputFormat, setOutputFormat] = useState<"wav" | "mp3">("wav");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [records, setRecords] = useState<A2VoiceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [tasks, setTasks] = useState<Record<string, unknown>[]>([]);

  const queryPayload = useMemo(
    () => ({
      startTime: toA2DateTime(startTime),
      endTime: toA2DateTime(endTime),
      icaoCode: icaoCode.trim().toUpperCase(),
      band: band.trim(),
      pageNum: 1,
      pageSize: 20,
    }),
    [band, endTime, icaoCode, startTime]
  );

  const runAction = async (name: string, action: () => Promise<void>) => {
    setBusyAction(name);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  };

  const queryVoice = () =>
    runAction("query", async () => {
      const res = await a2VoiceAPI.queryVoice(queryPayload);
      if (!res.success || !res.data) {
        toast({ title: "语音查询失败", description: res.error, variant: "destructive" });
        return;
      }
      setRecords(res.data.items);
      setTotal(res.data.total);
      toast({ title: "语音查询完成", description: `命中 ${res.data.total} 条语音片段` });
    });

  const createTask = () =>
    runAction("create", async () => {
      const res = await a2VoiceAPI.createDownloadTask({
        task_name: `${queryPayload.icaoCode}-${queryPayload.band}-${queryPayload.startTime}`,
        icao_code: queryPayload.icaoCode,
        band: queryPayload.band,
        start_time: queryPayload.startTime,
        end_time: queryPayload.endTime,
      });
      if (!res.success || !res.data) {
        toast({ title: "下载任务创建失败", description: res.error, variant: "destructive" });
        return;
      }
      toast({ title: "下载任务已创建", description: `taskId: ${res.data.taskId}` });
      await listTasks();
    });

  const executeLiveAtc = () =>
    runAction("liveatc", async () => {
      const res = await a2VoiceAPI.executeLiveAtcDownload({
        source_url: sourceUrl.trim(),
        date: toLiveAtcDate(startTime.slice(0, 10)),
        time: liveAtcSlot.trim(),
        icao_code: queryPayload.icaoCode,
        band: queryPayload.band,
      });
      if (!res.success || !res.data) {
        toast({ title: "LiveATC 下载失败", description: res.error, variant: "destructive" });
        return;
      }
      toast({
        title: "LiveATC 下载完成",
        description: res.data.record?.unique_id ? `新增语音: ${res.data.record.unique_id}` : "已返回下载结果",
      });
      await queryVoice();
      onRefreshRecordings?.();
    });

  const listTasks = async () => {
    const res = await a2VoiceAPI.listDownloadTasks();
    if (res.success && res.data) {
      setTasks(res.data.slice(0, 5));
    }
  };

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
        toast({ title: "导入任务创建失败", description: taskRes.error, variant: "destructive" });
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
        toast({ title: "音频导入失败", description: importRes.error, variant: "destructive" });
        return;
      }

      setRecords((prev) => [importRes.data!, ...prev.filter((item) => item.unique_id !== importRes.data!.unique_id)]);
      setTotal((prev) => Math.max(prev + 1, 1));
      const alphaRes = await audioAPI.saveA2AudioMetadata(importRes.data);
      toast({
        title: "音频导入完成",
        description: alphaRes.success
          ? `新增语音: ${importRes.data.unique_id}`
          : `新增语音: ${importRes.data.unique_id}；Alpha 元数据同步失败`,
      });
      await queryVoice();
      onRefreshRecordings?.();
    });
  };

  const exportSlice = () => {
    downloadFromUrl(a2VoiceAPI.exportVoiceUrl({ ...queryPayload, icaoCode: queryPayload.icaoCode, band: queryPayload.band, outputFormat }));
  };

  return (
    <Card className="overflow-hidden rounded-2xl border-border/70 efb-panel efb-glow">
      <CardHeader className="border-b border-border/40 bg-gradient-to-br from-background/35 to-transparent px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight">语音数据</CardTitle>
          <span className="rounded-full bg-background/50 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/50">
            {total} 条
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
            <Label className="text-xs">频段</Label>
            <Input value={band} onChange={(e) => setBand(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">开始时间</Label>
            <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">结束时间</Label>
            <Input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>

        <div className="grid grid-cols-[1fr_92px] gap-1.5">
          <div className="space-y-1">
            <Label className="text-xs">LiveATC URL</Label>
            <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">时段</Label>
            <Input value={liveAtcSlot} onChange={(e) => setLiveAtcSlot(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>
        <div className="grid grid-cols-[1fr_92px] gap-1.5">
          <div className="space-y-1">
            <Label className="text-xs">切片范围</Label>
            <div className="h-8 rounded-md border border-border/60 bg-background/30 px-2 py-1.5 text-xs text-muted-foreground">
              {queryPayload.icaoCode} / {queryPayload.band}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">格式</Label>
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

        <div className="grid grid-cols-3 gap-1.5">
          <input
            ref={importInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void importAudio(file);
              }
            }}
          />
          <Button size="sm" className="h-8 px-2 text-xs" onClick={queryVoice} disabled={busyAction !== null}>
            <Search className="h-3.5 w-3.5" /> 查询
          </Button>
          <Button size="sm" className="h-8 px-2 text-xs" variant="secondary" onClick={createTask} disabled={busyAction !== null}>
            <Download className="h-3.5 w-3.5" /> 新任务
          </Button>
          <Button size="sm" className="h-8 px-2 text-xs" variant="secondary" onClick={executeLiveAtc} disabled={busyAction !== null}>
            <RefreshCw className="h-3.5 w-3.5" /> 下载
          </Button>
          <Button size="sm" className="h-8 px-2 text-xs" variant="outline" onClick={exportSlice}>
            <FileDown className="h-3.5 w-3.5" /> 导出
          </Button>
          <Button size="sm" className="h-8 px-2 text-xs" variant="outline" onClick={() => runAction("tasks", listTasks)} disabled={busyAction !== null}>
            <ListFilter className="h-3.5 w-3.5" /> 任务
          </Button>
          <Button size="sm" className="h-8 px-2 text-xs" variant="outline" onClick={() => importInputRef.current?.click()} disabled={busyAction !== null}>
            <Upload className="h-3.5 w-3.5" /> 导入
          </Button>
        </div>

        {(records.length > 0 || tasks.length > 0) && (
          <div className="max-h-36 space-y-1.5 overflow-auto pr-1 text-xs">
            {records.map((record) => (
              <div key={record.unique_id} className="rounded-xl border border-border/60 bg-background/20 p-2">
                <div className="truncate font-medium">{record.unique_id}</div>
                <div className="mt-1 text-muted-foreground">
                  {record.icao_code} / {record.band} / {record.start_at} - {record.end_at}
                </div>
                <button
                  type="button"
                  className="mt-1 text-primary hover:underline"
                  onClick={() => downloadFromUrl(a2VoiceAPI.fileUrl(record.unique_id))}
                >
                  下载原文件
                </button>
              </div>
            ))}
            {tasks.map((task, index) => (
              <div key={String(task.task_id ?? task.taskId ?? index)} className="rounded-xl border border-border/60 bg-background/20 p-2">
                <div className="truncate font-medium">taskId: {String(task.task_id ?? task.taskId ?? "-")}</div>
                <div className="mt-1 truncate text-muted-foreground">{String(task.task_name ?? task.taskName ?? "")}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
