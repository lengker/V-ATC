"use client";

import { AnnotationPage } from "@/components/annotation-page";
import { EMPTY_PLACEHOLDER_AUDIO, isEmptyPlaceholderAudio } from "@/lib/empty-workspace";
import { demoAdsbTrack, demoRecordings, demoRecordingMeta } from "@/mock/demo-data";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  adsbForRecording,
  deleteRecordingFromBackend,
  fetchAnnotationBundle,
  fetchLiveAdsbForMap,
  fetchPendingRecordingsForAsr,
  fetchRecordingByAudioId,
  isRecordingTimelineAligned,
  rebuildRecordingTimelineFromLive,
  refreshRecordingsFromA2,
  correctRecordingTimestampOnServer,
  audioDataFromUtcMergeLoad,
  downloadHistoricalRecordingAt,
  ensureRecordingCaptureUtc,
  fetchUtcRangeMergeLoad,
  queryRecordingsByUtcRange,
  triggerA1LiveCollectOnce,
  triggerAsrForRecording,
  type AnnotationBundle,
  type RefreshRecordingsResult,
} from "@/lib/backend-api";
import { mergeDetourLiveAdsb } from "@/lib/detour-aircraft";
import { getRecordingDisplayName } from "@/lib/recording-display";
import { RecordingsSyncProvider } from "@/context/recordings-sync-context";
import { AudioData, ADSBData } from "@/types";
import type { RecordingMeta } from "@/mock/demo-data";
import { useToast } from "@/hooks/use-toast";
import { exportBatchAnnotationPackages } from "@/lib/batch-export";
import { loadTimestampsWithLocalEdits } from "@/lib/local-annotation-store";
import { vhhhStatic } from "@/mock/vhhh-static";

/** 地图只读刷新；OpenSky 采集由 start-all 的 a1_live_collector 负责（勿与前端双开） */
const ADSB_MAP_POLL_MS = 10_000;
/** 前端兜底采集（仅当未跑 a1_live_collector 时可设为 30_000；默认 0=关闭） */
const ADSB_COLLECT_MS = 0;

type Workspace = {
  audio: AudioData;
  adsb: ADSBData[];
};

function pickAudio(recordings: AudioData[], id: string | null): AudioData | undefined {
  if (!recordings.length) return undefined;
  if (id) {
    const hit = recordings.find((r) => r.id === id);
    if (hit) return hit;
  }
  return recordings[0];
}

function timestampsSignature(ts: { id: string; startTime: number; endTime: number; text?: string }[]) {
  if (!ts.length) return "0";
  const head = ts[0];
  const tail = ts[ts.length - 1];
  return `${ts.length}:${head.id}:${head.startTime}:${tail.id}:${tail.endTime}`;
}

function isBackendRecordingId(id: string) {
  return /^\d+$/.test(id);
}

/** 本次点击要处理的一条：优先刚同步进来的，否则最早一条尚无转写的 */
function pickOneRecordingToUpdate(recordings: AudioData[], prevIds: Set<string>) {
  const newOnes = recordings.filter((r) => isBackendRecordingId(r.id) && !prevIds.has(r.id));
  if (newOnes.length > 0) {
    return [...newOnes].sort((a, b) => Number(b.id) - Number(a.id))[0];
  }
  const pending = recordings
    .filter((r) => isBackendRecordingId(r.id) && (r.timestamps?.length ?? 0) === 0)
    .sort((a, b) => Number(a.id) - Number(b.id));
  return pending[0];
}

function HomeContent() {
  const params = useSearchParams();
  const { toast } = useToast();
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const selectedAudioIdRef = useRef<string | null>(null);
  const latestAdsbRef = useRef<ADSBData[]>([]);
  const [mapLiveAdsb, setMapLiveAdsb] = useState<ADSBData[]>([]);
  const adsbByRecordingRef = useRef<Record<string, ADSBData[]>>({});
  const [loading, setLoading] = useState(true);

  const [recordingsList, setRecordingsList] = useState<AudioData[]>(demoRecordings);
  const [recordingMeta, setRecordingMeta] =
    useState<Record<string, RecordingMeta>>(demoRecordingMeta);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncingRecordings, setSyncingRecordings] = useState(false);
  const [deletingRecordingId, setDeletingRecordingId] = useState<string | null>(null);
  const [batchExporting, setBatchExporting] = useState(false);
  const [batchExportProgress, setBatchExportProgress] = useState<{
    current: number;
    total: number;
    audioId?: string;
  } | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState<{
    audioId: string;
    message: string;
  } | null>(null);
  const [liveAdsbStatus, setLiveAdsbStatus] = useState<{
    aircraft: number;
    error?: string;
    updatedAt?: number;
    /** 库内最新航迹点是否超过 2 分钟未更新 */
    stale?: boolean;
    lastDataAt?: number;
  } | null>(null);

  const [workspace, setWorkspace] = useState<Workspace>({
    audio: EMPTY_PLACEHOLDER_AUDIO,
    adsb: [],
  });

  const recordingCountRef = useRef<number | null>(null);
  const recordingsListRef = useRef(recordingsList);
  const refreshBusyRef = useRef(false);
  const mapCollectBusyRef = useRef(false);
  const mapRefreshBusyRef = useRef(false);
  const lastMapCollectAtRef = useRef(0);
  const [adsbMapRevision, setAdsbMapRevision] = useState(0);

  const resolveWorkspaceAdsb = useCallback((audio: AudioData) => {
    return adsbForRecording(audio, adsbByRecordingRef.current, latestAdsbRef.current);
  }, []);

  const applyBundleToRefs = useCallback((remote: AnnotationBundle) => {
    adsbByRecordingRef.current = remote.adsbByRecordingId;
    latestAdsbRef.current = remote.adsbData;
    const liveLayer = remote.adsbData.filter((p) => p.live === true || p.timestamp > 1_000_000_000);
    if (liveLayer.length > 0) setMapLiveAdsb(liveLayer);
  }, []);

  useEffect(() => {
    recordingsListRef.current = recordingsList;
  }, [recordingsList]);

  const applyListOnly = useCallback(
    (
      remote: AnnotationBundle,
      refresh: RefreshRecordingsResult | undefined,
      opts: { isInitial?: boolean; fromPoll?: boolean }
    ) => {
      const prevCount = recordingCountRef.current;
      const nextCount = remote.recordings.length;
      applyBundleToRefs(remote);

      const applyList = () => {
        setRecordingsList(remote.recordings);
        setRecordingMeta(remote.recordingMeta);
        recordingCountRef.current = nextCount;
        setLastSyncAt(Date.now());
      };
      if (opts.fromPoll) startTransition(applyList);
      else applyList();

      const nextAudio = pickAudio(remote.recordings, selectedAudioIdRef.current);
      if (!nextAudio) return;

      setWorkspace((prev) => {
        if (
          opts.fromPoll &&
          prev.audio &&
          prev.audio.id === nextAudio.id &&
          prev.audio.url === nextAudio.url
        ) {
          const prevSig = timestampsSignature(prev.audio.timestamps ?? []);
          const nextSig = timestampsSignature(nextAudio.timestamps ?? []);
          if (prevSig !== nextSig) {
            return {
              audio: {
                ...prev.audio,
                timestamps: nextAudio.timestamps,
                duration: nextAudio.duration,
              },
              adsb: prev.adsb,
            };
          }
          return prev;
        }
        return { audio: nextAudio, adsb: adsbForRecording(nextAudio, remote.adsbByRecordingId, remote.adsbData) };
      });

      if (prevCount != null && nextCount > prevCount && opts.fromPoll) {
        toast({
          title: "录音列表已更新",
          description: `新增 ${nextCount - prevCount} 条（A5 共 ${nextCount} 条，A2 库 ${refresh?.a2_total ?? "?"} 条）`,
        });
      }
      if (opts.isInitial && refresh?.a5_total != null) {
        toast({
          title: "录音列表已同步",
          description: `A5 共 ${refresh.a5_total} 条；A2 库 ${refresh.a2_total ?? "?"} 条`,
        });
      }
    },
    [applyBundleToRefs, toast]
  );

  const finishAsrForTarget = useCallback(
    async (
      target: AudioData,
      remote: AnnotationBundle,
      opts?: { loadingMessage?: string }
    ) => {
      setSelectedAudioId(target.id);
      selectedAudioIdRef.current = target.id;
      applyBundleToRefs(remote);
      setWorkspace({ audio: target, adsb: adsbForRecording(target, remote.adsbByRecordingId, remote.adsbData) });

      if ((target.timestamps?.length ?? 0) > 0) {
        setTranscriptLoading(null);
        toast({
          title: "已有转写",
          description: `录音 #${target.id} 共 ${target.timestamps.length} 段，切换其它录音可对它们单独转写`,
        });
        return remote;
      }

      setTranscriptLoading({
        audioId: target.id,
        message: opts?.loadingMessage ?? `正在识别录音 #${target.id}…`,
      });

      const asr = await triggerAsrForRecording(target.id);
      try {
        await ensureRecordingCaptureUtc(target.id, target.duration, target.metadata?.fileName);
      } catch {
        /* 时间戳写入失败不阻塞转写结果 */
      }
      const nextRemote = await fetchAnnotationBundle({ noCache: true });
      const updated = nextRemote.recordings.find((r) => r.id === target.id);
      if (updated) {
        setRecordingsList(nextRemote.recordings);
        recordingsListRef.current = nextRemote.recordings;
        setRecordingMeta(nextRemote.recordingMeta);
        applyBundleToRefs(nextRemote);
        setWorkspace({
          audio: updated,
          adsb: adsbForRecording(updated, nextRemote.adsbByRecordingId, nextRemote.adsbData),
        });
        setLastSyncAt(Date.now());
        const n = updated.timestamps.length;
        setTranscriptLoading(null);
        const detail = Array.isArray(asr.details) ? asr.details[0] : null;
        const errMsg =
          detail && typeof detail === "object" && "error" in detail
            ? String((detail as { error?: string }).error)
            : "";
        toast({
          title: n > 0 ? "转写完成" : "仍无语音片段",
          description:
            n > 0
              ? `录音 #${target.id}：${n} 段。列表里仍有 ${nextRemote.recordings.filter((r) => isBackendRecordingId(r.id) && (r.timestamps?.length ?? 0) === 0).length} 条待转写`
              : errMsg === "file_not_found"
                ? "A2 音频未落盘，请确认 :8001/media 可访问"
                : errMsg === "asr_env_missing"
                  ? "请在 联调 目录执行 .\\setup_asr_venv.ps1"
                  : "请确认 ffmpeg / ASR 环境后重试",
          variant: n > 0 ? "default" : "destructive",
        });
      } else {
        setTranscriptLoading(null);
      }
      return nextRemote;
    },
    [applyBundleToRefs, toast]
  );

  const runTranscribeSelected = useCallback(async () => {
    if (refreshBusyRef.current || loading) return;
    const sid = selectedAudioIdRef.current;
    if (!sid || !isBackendRecordingId(sid)) {
      toast({
        title: "无法转写",
        description: "请先在左侧列表选中一条已同步到 A5 的录音（数字编号）",
        variant: "destructive",
      });
      return;
    }

    refreshBusyRef.current = true;
    setSyncingRecordings(true);
    try {
      let remote = await fetchAnnotationBundle({ noCache: true });
      const target = remote.recordings.find((r) => r.id === sid);
      if (!target) {
        toast({ title: "未找到该录音", description: `audio_id=${sid}`, variant: "destructive" });
        return;
      }
      await finishAsrForTarget(target, remote, {
        loadingMessage: `正在识别当前录音 #${sid}…`,
      });
    } catch (error) {
      setTranscriptLoading(null);
      toast({
        title: "转写失败",
        description: error instanceof Error ? error.message : "unknown",
        variant: "destructive",
      });
    } finally {
      refreshBusyRef.current = false;
      setSyncingRecordings(false);
    }
  }, [finishAsrForTarget, loading, toast]);

  const runUpdateOneRecording = useCallback(async () => {
    if (refreshBusyRef.current || loading) return;
    refreshBusyRef.current = true;
    setSyncingRecordings(true);

    const prevIds = new Set(recordingsListRef.current.map((r) => r.id));

    try {
      const refresh = await refreshRecordingsFromA2({ download: true, a3Limit: 0 });
      let pending = await fetchPendingRecordingsForAsr();
      if (!pending.length && refresh.pending_audio_ids?.length) {
        const loaded = await Promise.all(
          refresh.pending_audio_ids.map((id) => fetchRecordingByAudioId(String(id)))
        );
        pending = loaded.filter((r): r is AudioData => r != null);
      }
      let remote = await fetchAnnotationBundle({ noCache: true });
      if (!remote.recordings.length && !pending.length) {
        setRecordingsList([]);
        setRecordingMeta(remote.recordingMeta);
        applyBundleToRefs(remote);
        setWorkspace({ audio: EMPTY_PLACEHOLDER_AUDIO, adsb: remote.adsbData });
        const blocked = refresh.blocked ?? 0;
        toast({
          title: "同步后仍无录音",
          description:
            blocked > 0
              ? `A2 有 ${blocked} 条在阻止名单内；已解除 ${refresh.unblock?.removed ?? 0} 条。请重启 A5(:8000) 后重试。`
              : `A2 库 ${refresh?.a2_total ?? "?"} 条，本次写入 A5 ${refresh?.synced ?? 0} 条。请确认 A2 :8001 有 mp3。`,
          variant: "destructive",
        });
        return;
      }

      applyListOnly(remote, refresh, { fromPoll: true });

      const sid = selectedAudioIdRef.current;
      const selectedPending =
        sid &&
        pending.find(
          (r) => r.id === sid && isBackendRecordingId(r.id) && (r.timestamps?.length ?? 0) === 0
        );
      let target = selectedPending ?? pickOneRecordingToUpdate(pending, prevIds);
      if (!target && pending.length > 0) {
        target = [...pending].sort((a, b) => Number(a.id) - Number(b.id))[0];
      }
      if (!target) {
        const blocked = refresh.blocked ?? 0;
        toast({
          title: "没有待更新录音",
          description:
            blocked > 0
              ? `A2 有 ${blocked} 条被阻止名单拦截。请重启 A5 后端后再点「实时更新」。`
              : (refresh?.synced ?? 0) > 0
                ? `A2 已同步 ${refresh.synced} 条，但转写目标未找到。请重启 A5(:8000) 使新逻辑生效。`
                : "A2 暂无新 mp3，或列表中的录音均已转写",
        });
        return;
      }

      await finishAsrForTarget(target, remote, {
        loadingMessage: selectedPending
          ? `正在识别当前选中的录音 #${target.id}…`
          : `正在从 A2 同步并识别录音 #${target.id}…`,
      });
    } catch (error) {
      setTranscriptLoading(null);
      toast({
        title: "更新失败",
        description: error instanceof Error ? error.message : "unknown",
        variant: "destructive",
      });
    } finally {
      refreshBusyRef.current = false;
      setSyncingRecordings(false);
    }
  }, [applyListOnly, finishAsrForTarget, loading, toast]);

  const runDownloadHistorical = useCallback(
    async (utcIso: string, options: { a3Asr: boolean }) => {
      if (refreshBusyRef.current || loading) return;
      refreshBusyRef.current = true;
      setSyncingRecordings(true);
      try {
        const result = await downloadHistoricalRecordingAt(utcIso, { a3Asr: options.a3Asr });
        const ok = result.ok === true || result.ok === 1;
        if (!ok) {
          const a2Err =
            typeof result.a2 === "object" && result.a2 && "error" in result.a2
              ? String((result.a2 as { error?: string }).error)
              : "";
          const rawErr = String(result.error || a2Err || "").trim();
          const detail = result.cookie_required && !/selenium|seleniumbase/i.test(rawErr)
            ? "未配置 LiveATC Cookie。在 PowerShell 执行：cd 联调 → .\\setup_a2_liveatc_cookie.ps1 → 重启 A2 后再试。"
            : rawErr ||
              "请确认 A2(:8001) 已启动；若用浏览器下载需安装 seleniumbase 并重启 A2。时段选 1～6 小时前。";
          toast({
            title: "历史下载失败",
            description: detail,
            variant: "destructive",
          });
          return;
        }

        const remote = await fetchAnnotationBundle({ noCache: true });
        applyListOnly(remote, undefined, { fromPoll: true });

        const audioId = result.audio_id != null ? String(result.audio_id) : null;
        const fileName = result.file_name || (result.a2 as { file_name?: string })?.file_name;
        let target =
          audioId != null
            ? remote.recordings.find((r) => r.id === audioId) ??
              (await fetchRecordingByAudioId(audioId))
            : fileName
              ? remote.recordings.find(
                  (r) =>
                    String(r.metadata?.fileName || "") === String(fileName) ||
                    getRecordingDisplayName(r) === fileName
                )
              : null;

        if (target && options.a3Asr && (target.timestamps?.length ?? 0) === 0) {
          await finishAsrForTarget(target, remote, {
            loadingMessage: `正在转写历史录音 #${target.id}…`,
          });
        } else if (target) {
          setSelectedAudioId(target.id);
          setWorkspace((prev) => ({
            audio: target!,
            adsb: adsbForRecording(target!, remote.adsbByRecordingId, remote.adsbData),
          }));
        }

        if (!audioId && !target) {
          toast({
            title: "下载完成，列表未更新",
            description:
              String(result.sync_warning || "").trim() ||
              "请确认 A5(:8000) 已启动，并在录音列表点「同步」；管理台需手动点刷新。",
            variant: "destructive",
          });
          return;
        }

        toast({
          title: result.already_exists ? "该时段录音已存在" : "历史录音已下载",
          description: [
            fileName,
            result.slot_utc ? `档位 ${String(result.slot_utc).replace(".000Z", "Z")}` : null,
            audioId ? `已同步 #${audioId}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      } catch (error) {
        toast({
          title: "历史下载失败",
          description: error instanceof Error ? error.message : "unknown",
          variant: "destructive",
        });
      } finally {
        refreshBusyRef.current = false;
        setSyncingRecordings(false);
      }
    },
    [applyListOnly, finishAsrForTarget, loading, toast]
  );

  // 首次进入：只加载 A5 当前列表，不自动拉 A2
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const remote = await fetchAnnotationBundle({ noCache: true });
        if (!active) return;
        if (!remote.recordings.length) {
          setRecordingsList([]);
          setRecordingMeta(remote.recordingMeta);
          recordingCountRef.current = 0;
          applyBundleToRefs(remote);
          setWorkspace({ audio: EMPTY_PLACEHOLDER_AUDIO, adsb: remote.adsbData });
          setLiveAdsbStatus({
            aircraft: remote.liveAircraftCount,
            error:
              remote.liveAircraftCount === 0
                ? "暂无实时航迹"
                : undefined,
          });
          return;
        }
        applyListOnly(remote, undefined, { isInitial: true });
      } catch (error) {
        if (!active) return;
        const reason = error instanceof Error ? error.message : "unknown";
        setRecordingsList(demoRecordings);
        setRecordingMeta(demoRecordingMeta);
        setWorkspace({ audio: demoRecordings[0], adsb: mergeDetourLiveAdsb(demoAdsbTrack) });
        toast({
          title: "已切回演示数据",
          description: `无法连接后端（${reason}）。请确认 A5 :8000 已启动。`,
          variant: "destructive",
        });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyListOnly, toast]);

  // A1 实时航迹：定时从 A5 刷新地图（采集器 a1_live_collector.py 同步 A1→A5）
  useEffect(() => {
    if (loading) return;
    let active = true;

    const refreshMapAdsb = async () => {
      if (mapRefreshBusyRef.current) return;
      mapRefreshBusyRef.current = true;

      const now = Date.now();
      const shouldCollect =
        ADSB_COLLECT_MS > 0 &&
        now - lastMapCollectAtRef.current >= ADSB_COLLECT_MS &&
        !mapCollectBusyRef.current;

      try {
        if (shouldCollect) {
          mapCollectBusyRef.current = true;
          lastMapCollectAtRef.current = now;
          try {
            const out = await triggerA1LiveCollectOnce();
            if (out && typeof out === "object" && out.ok === 0) {
              const raw = String(out.error || "OpenSky 采集失败");
              const err = /too many requests/i.test(raw)
                ? "OpenSky 请求过频，请稍候或只保留一个采集进程（a1_live_collector）"
                : raw;
              setLiveAdsbStatus((prev) => ({
                aircraft: prev?.aircraft ?? 0,
                updatedAt: prev?.updatedAt,
                error: err,
              }));
            }
          } catch (e) {
            const raw = e instanceof Error ? e.message : "采集接口不可用";
            const msg =
              raw.includes("404") || raw.includes("Not Found")
                ? "请重启 A5 后端以启用 /sync/a1-live-once"
                : /too many requests/i.test(raw)
                  ? "OpenSky 请求过频，请稍候或减少采集频率"
                  : raw;
            setLiveAdsbStatus((prev) => ({
              aircraft: prev?.aircraft ?? 0,
              updatedAt: prev?.updatedAt,
              error: msg,
            }));
          } finally {
            mapCollectBusyRef.current = false;
          }
        }

        const live = await fetchLiveAdsbForMap();
        if (!active) return;
        latestAdsbRef.current = live.adsbData;
        setMapLiveAdsb(live.adsbData);
        const recordings = recordingsListRef.current;
        for (const rec of recordings) {
          if (!isRecordingTimelineAligned(rec)) continue;
          const rebuilt = rebuildRecordingTimelineFromLive(rec, live.adsbData);
          if (rebuilt.length > 0) {
            adsbByRecordingRef.current[rec.id] = rebuilt;
          }
        }
        setWorkspace((prev) => {
          const nextAdsb = isRecordingTimelineAligned(prev.audio)
            ? adsbForRecording(prev.audio, adsbByRecordingRef.current, live.adsbData)
            : live.adsbData;
          if (prev.adsb === nextAdsb) return prev;
          return { ...prev, adsb: nextAdsb };
        });
        setAdsbMapRevision((r) => r + 1);
        const nowSec = Date.now() / 1000;
        const stale =
          live.latestLiveAt != null && nowSec - live.latestLiveAt > 120;
        const dataAgeSec =
          live.latestLiveAt != null ? Date.now() / 1000 - live.latestLiveAt : null;
        setLiveAdsbStatus((prev) => ({
          aircraft: live.liveAircraftCount,
          updatedAt: Date.now(),
          lastDataAt: live.latestLiveAt != null ? live.latestLiveAt * 1000 : undefined,
          stale,
          activeWithinMinutes: live.activeWithinMinutes,
          error: stale
            ? `航迹已冻结（库内最新数据 ${dataAgeSec != null ? Math.round(dataAgeSec / 60) : "?"} 分钟前）。请只保留一个 a1_live_collector 窗口`
            : live.liveAircraftCount === 0
              ? prev?.error || "近 25 分钟无 ADS-B 回波（或 OpenSky 未采集）"
              : undefined,
        }));
      } catch {
        // 后端未就绪时保持当前航迹
      } finally {
        mapRefreshBusyRef.current = false;
      }
    };

    void refreshMapAdsb();
    const timer = setInterval(refreshMapAdsb, ADSB_MAP_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [loading]);

  useEffect(() => {
    if (!recordingsList.length || !isEmptyPlaceholderAudio(workspace.audio)) return;
    const first = recordingsList[0];
    if (!first) return;
    setSelectedAudioId(first.id);
    selectedAudioIdRef.current = first.id;
    setWorkspace({ audio: first, adsb: resolveWorkspaceAdsb(first) });
  }, [recordingsList, resolveWorkspaceAdsb, workspace.audio]);

  useEffect(() => {
    if (!recordingsList.length) return;
    setSelectedAudioId((prev) => {
      if (prev && recordingsList.some((r) => r.id === prev)) return prev;
      const fromUrl = params.get("audioId");
      if (fromUrl && recordingsList.some((r) => r.id === fromUrl)) return fromUrl;
      return recordingsList[0]?.id ?? null;
    });
  }, [recordingsList, params]);

  useEffect(() => {
    selectedAudioIdRef.current = selectedAudioId;
  }, [selectedAudioId]);

  const clearRecordingLocalCache = useCallback((audioId: string) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem(`alpha.timestamps.full.${audioId}`);
      const starredRaw = localStorage.getItem("alpha.recordings.starred");
      if (starredRaw) {
        const starred = new Set(JSON.parse(starredRaw) as string[]);
        if (starred.delete(audioId)) {
          localStorage.setItem("alpha.recordings.starred", JSON.stringify(Array.from(starred)));
        }
      }
      const recentRaw = localStorage.getItem("alpha.recordings.recent");
      if (recentRaw) {
        const recent = JSON.parse(recentRaw) as Record<string, number>;
        if (audioId in recent) {
          delete recent[audioId];
          localStorage.setItem("alpha.recordings.recent", JSON.stringify(recent));
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const handleDeleteRecording = useCallback(
    async (id: string) => {
      if (!/^\d+$/.test(id)) {
        toast({
          title: "无法删除",
          description: "仅可删除已同步到 A5 的录音",
          variant: "destructive",
        });
        return;
      }
      const target = recordingsList.find((r) => r.id === id);
      const label = target ? getRecordingDisplayName(target) : `#${id}`;
      if (
        !window.confirm(`确定删除录音「${label}」(#${id})？\n将从 A5 移除该录音及转写，且不可恢复。`)
      ) {
        return;
      }

      setDeletingRecordingId(id);
      try {
        await deleteRecordingFromBackend(id);
        clearRecordingLocalCache(id);

        const nextList = recordingsList.filter((r) => r.id !== id);
        setRecordingsList(nextList);
        recordingsListRef.current = nextList;
        recordingCountRef.current = nextList.length;
        setLastSyncAt(Date.now());

        if (transcriptLoading?.audioId === id) {
          setTranscriptLoading(null);
        }

        if (workspace.audio.id === id) {
          const nextAudio = nextList[0] ?? EMPTY_PLACEHOLDER_AUDIO;
          const nextId = nextList[0]?.id ?? "";
          setSelectedAudioId(nextId || null);
          selectedAudioIdRef.current = nextId || null;
          setWorkspace({ audio: nextAudio, adsb: resolveWorkspaceAdsb(nextAudio) });
          try {
            if (nextId) {
              window.history.replaceState(window.history.state, "", `/?audioId=${encodeURIComponent(nextId)}`);
            } else {
              window.history.replaceState(window.history.state, "", "/");
            }
          } catch {
            // ignore
          }
        }

        toast({ title: "已删除", description: `录音 ${label} 已从 A5 移除` });
      } catch (error) {
        toast({
          title: "删除失败",
          description: error instanceof Error ? error.message : "unknown",
          variant: "destructive",
        });
      } finally {
        setDeletingRecordingId(null);
      }
    },
    [
      recordingsList,
      toast,
      clearRecordingLocalCache,
      transcriptLoading?.audioId,
      resolveWorkspaceAdsb,
      workspace.audio.id,
    ]
  );

  const handleCorrectTimestamp = useCallback(async () => {
    const sid = selectedAudioIdRef.current;
    if (!sid || !isBackendRecordingId(sid)) {
      toast({
        title: "无法修正时间",
        description: "请先选中一条已同步到 A5 的录音",
        variant: "destructive",
      });
      return;
    }
    if (refreshBusyRef.current) return;
    refreshBusyRef.current = true;
    setSyncingRecordings(true);
    try {
      const target =
        recordingsListRef.current.find((r) => r.id === sid) ??
        (await fetchRecordingByAudioId(sid));
      if (!target) {
        toast({ title: "未找到录音", variant: "destructive" });
        return;
      }

      const shiftAnnotations = (target.timestamps?.length ?? 0) > 0;
      const result = await correctRecordingTimestampOnServer(sid, {
        apply: true,
        shiftAnnotations,
      });

      const startUtc = result.start_time_utc;
      const endUtc = result.end_time_utc;
      const patchMeta = (r: AudioData): AudioData =>
        r.id === sid
          ? {
              ...r,
              metadata: {
                ...r.metadata,
                startTimeUtc: startUtc,
                endTimeUtc: endUtc,
              },
            }
          : r;

      setRecordingsList((prev) => prev.map(patchMeta));
      recordingsListRef.current = recordingsListRef.current.map(patchMeta);

      const patched = patchMeta(target);
      setWorkspace((prev) => ({
        audio: prev.audio.id === sid ? patched : prev.audio,
        adsb: prev.audio.id === sid ? resolveWorkspaceAdsb(patched) : prev.adsb,
      }));
      setLastSyncAt(Date.now());

      const methodLabel =
        result.method === "filename"
          ? "文件名档位"
          : result.method === "unchanged"
            ? "已与库内一致"
            : "航迹融合";
      toast({
        title: result.method === "unchanged" ? "时间戳已较准" : "UTC 时间戳已修正",
        description: `${methodLabel} · 置信 ${(result.confidence * 100).toFixed(0)}% · ${result.details}`,
      });
    } catch (error) {
      toast({
        title: "时间戳修正失败",
        description: error instanceof Error ? error.message : "unknown",
        variant: "destructive",
      });
    } finally {
      refreshBusyRef.current = false;
      setSyncingRecordings(false);
    }
  }, [resolveWorkspaceAdsb, toast]);

  const handleMergeUtcRangeLoad = useCallback(
    async (opts: {
      startUtc: string;
      endUtc: string;
      strategy: "concat" | "single_longest";
      runAsrOnMissing: boolean;
    }) => {
      if (refreshBusyRef.current) return;
      refreshBusyRef.current = true;
      setSyncingRecordings(true);
      try {
        if (opts.runAsrOnMissing) {
          const q = await queryRecordingsByUtcRange(opts.startUtc, opts.endUtc);
          for (const row of q.rows) {
            const id = String(row.audio_id);
            const existing = recordingsListRef.current.find((r) => r.id === id);
            const hasTs = (existing?.timestamps?.length ?? 0) > 0;
            if (!isBackendRecordingId(id) || hasTs) continue;
            setTranscriptLoading({
              audioId: id,
              message: `正在转写 #${id}（合并前）…`,
            });
            await triggerAsrForRecording(id);
          }
          setTranscriptLoading(null);
        }

        const payload = await fetchUtcRangeMergeLoad(
          opts.startUtc,
          opts.endUtc,
          opts.strategy
        );
        if (payload.count === 0) {
          toast({ title: "本时段无录音", variant: "destructive" });
          return;
        }

        const merged = audioDataFromUtcMergeLoad(payload);
        if (!merged.url) {
          toast({
            title: "已合并转写，但无音频文件",
            description: "请安装 ffmpeg 并加入 PATH，或改用「单条最长重叠」策略",
            variant: "destructive",
          });
        }

        const remote = await fetchAnnotationBundle({ noCache: true });
        applyBundleToRefs(remote);

        setRecordingsList((prev) => {
          const rest = prev.filter((r) => r.id !== merged.id);
          return [merged, ...rest];
        });
        recordingsListRef.current = [merged, ...recordingsListRef.current.filter((r) => r.id !== merged.id)];
        setRecordingMeta((prev) => ({
          ...prev,
          [merged.id]: { channel: "Radio", mine: false },
        }));
        setSelectedAudioId(merged.id);
        selectedAudioIdRef.current = merged.id;
        setWorkspace({
          audio: merged,
          adsb: adsbForRecording(merged, remote.adsbByRecordingId, remote.adsbData),
        });
        setLastSyncAt(Date.now());
        setTranscriptLoading(null);

        toast({
          title: "已加载合并录音",
          description: [
            `${payload.count} 段`,
            `${merged.timestamps.length} 条转写`,
            merged.url ? "波形可播放" : "仅文本",
          ].join(" · "),
        });
      } catch (error) {
        toast({
          title: "合并加载失败",
          description: error instanceof Error ? error.message : "unknown",
          variant: "destructive",
        });
      } finally {
        refreshBusyRef.current = false;
        setSyncingRecordings(false);
      }
    },
    [applyBundleToRefs, toast]
  );

  const handleSelectRecording = useCallback(
    (id: string) => {
      setSelectedAudioId(id);
      selectedAudioIdRef.current = id;
      const next = pickAudio(recordingsList, id);
      if (next) {
        const aligned = resolveWorkspaceAdsb(next);
        setWorkspace({ audio: next, adsb: aligned });
        if (isRecordingTimelineAligned(next) && aligned.length === 0) {
          toast({
            title: "该时段无航迹",
            description: "已按录音 UTC 时间窗过滤，库内无匹配 ADS-B 点",
            variant: "destructive",
          });
        }
        if (transcriptLoading?.audioId === id) {
          // 保留「立即更新」触发的加载态
        } else {
          setTranscriptLoading(null);
        }
      }
      try {
        window.history.replaceState(window.history.state, "", `/?audioId=${encodeURIComponent(id)}`);
      } catch {
        // ignore
      }
    },
    [recordingsList, resolveWorkspaceAdsb, toast, transcriptLoading?.audioId]
  );

  // 已有片段则结束加载态
  useEffect(() => {
    const audio = workspace.audio;
    if (!audio?.id || (audio.timestamps?.length ?? 0) === 0) return;
    setTranscriptLoading((prev) => (prev?.audioId === audio.id ? null : prev));
  }, [workspace.audio.id, workspace.audio.timestamps?.length]);

  const pendingTranscriptCount = useMemo(
    () =>
      recordingsList.filter(
        (r) => isBackendRecordingId(r.id) && (r.timestamps?.length ?? 0) === 0
      ).length,
    [recordingsList]
  );

  const handleBatchExport = useCallback(
    async (ids: string[]) => {
      const unique = [...new Set(ids.filter(Boolean))];
      if (unique.length === 0) {
        toast({ title: "未选择录音", description: "请先勾选要导出的录音", variant: "destructive" });
        return;
      }
      setBatchExporting(true);
      setBatchExportProgress({ current: 0, total: unique.length });
      try {
        const payloads = unique
          .map((id) => {
            const rec = recordingsListRef.current.find((r) => r.id === id);
            if (!rec) return null;
            const timestamps = loadTimestampsWithLocalEdits(id, rec.timestamps ?? []);
            const adsb = adsbForRecording(
              rec,
              adsbByRecordingRef.current,
              latestAdsbRef.current
            );
            return {
              audio: { ...rec, timestamps },
              timestamps,
              adsb,
              staticLayers: vhhhStatic,
              exportedAt: new Date().toISOString(),
            };
          })
          .filter((p): p is NonNullable<typeof p> => p != null);

        if (payloads.length === 0) {
          toast({ title: "导出失败", description: "找不到所选录音", variant: "destructive" });
          return;
        }

        const result = await exportBatchAnnotationPackages(payloads, {
          includeAudio: true,
          includeAdsb: true,
          delayMs: 400,
          onProgress: (p) => {
            setBatchExportProgress({
              current: p.index,
              total: p.total,
              audioId: p.audioId,
            });
          },
        });

        toast({
          title: "批量导出完成",
          description: `已处理 ${result.exported}/${result.total} 条；manifest 与合并 CSV 已下载${
            result.errors.length ? `；${result.errors.length} 项告警` : ""
          }`,
          variant: result.exported > 0 ? "default" : "destructive",
        });
      } catch (e) {
        toast({
          title: "批量导出失败",
          description: e instanceof Error ? e.message : "未知错误",
          variant: "destructive",
        });
      } finally {
        setBatchExporting(false);
        setBatchExportProgress(null);
      }
    },
    [toast]
  );

  useEffect(() => {
    const onBatch = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { ids?: string[]; all?: boolean } | undefined;
      if (detail?.ids?.length) {
        void handleBatchExport(detail.ids);
        return;
      }
      if (detail?.all) {
        void handleBatchExport(recordingsListRef.current.map((r) => r.id));
      }
    };
    window.addEventListener("alpha.batch-export", onBatch as EventListener);
    return () => window.removeEventListener("alpha.batch-export", onBatch as EventListener);
  }, [handleBatchExport]);

  const listSyncValue = useMemo(
    () => ({
      recordings: recordingsList,
      recordingMeta,
      updatedAt: lastSyncAt,
      syncing: syncingRecordings,
      pendingTranscriptCount,
      onUpdateOneRecording: () => void runUpdateOneRecording(),
      onDownloadHistorical: runDownloadHistorical,
      onMergeUtcRangeLoad: handleMergeUtcRangeLoad,
      onCorrectTimestamp: () => void handleCorrectTimestamp(),
      onTranscribeSelected: () => void runTranscribeSelected(),
      onDeleteRecording: (id: string) => void handleDeleteRecording(id),
      deletingRecordingId,
      onBatchExport: handleBatchExport,
      batchExporting,
      batchExportProgress,
      transcriptLoading,
      liveAdsbStatus,
    }),
    [
      recordingsList,
      recordingMeta,
      lastSyncAt,
      syncingRecordings,
      pendingTranscriptCount,
      runUpdateOneRecording,
      runDownloadHistorical,
      handleMergeUtcRangeLoad,
      handleCorrectTimestamp,
      runTranscribeSelected,
      handleDeleteRecording,
      deletingRecordingId,
      handleBatchExport,
      batchExporting,
      batchExportProgress,
      transcriptLoading,
      liveAdsbStatus,
    ]
  );

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">
        正在加载录音列表…
      </div>
    );
  }

  return (
    <RecordingsSyncProvider value={listSyncValue}>
      <AnnotationPage
        key={workspace.audio.id || "__empty__"}
        audioData={workspace.audio}
        adsbData={workspace.adsb}
        mapLiveAdsb={mapLiveAdsb}
        adsbMapRevision={adsbMapRevision}
        onSelectRecording={handleSelectRecording}
      />
    </RecordingsSyncProvider>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">
          Loading page...
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
