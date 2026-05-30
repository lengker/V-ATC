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
  deleteRecordingFromBackend,
  fetchAnnotationBundle,
  fetchLiveAdsbForMap,
  fetchPendingRecordingsForAsr,
  fetchRecordingByAudioId,
  refreshRecordingsFromA2,
  stampRecordingCaptureNow,
  triggerA1LiveCollectOnce,
  triggerAsrForRecording,
  type RefreshRecordingsResult,
} from "@/lib/backend-api";
import { mergeDetourLiveAdsb } from "@/lib/detour-aircraft";
import { getRecordingDisplayName } from "@/lib/recording-display";
import { RecordingsSyncProvider } from "@/context/recordings-sync-context";
import { AudioData, ADSBData } from "@/types";
import type { RecordingMeta } from "@/mock/demo-data";
import { useToast } from "@/hooks/use-toast";

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
  const latestAdsbRef = useRef<ADSBData[]>(mergeDetourLiveAdsb(demoAdsbTrack));
  const [loading, setLoading] = useState(true);

  const [recordingsList, setRecordingsList] = useState<AudioData[]>(demoRecordings);
  const [recordingMeta, setRecordingMeta] =
    useState<Record<string, RecordingMeta>>(demoRecordingMeta);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncingRecordings, setSyncingRecordings] = useState(false);
  const [deletingRecordingId, setDeletingRecordingId] = useState<string | null>(null);
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

  useEffect(() => {
    recordingsListRef.current = recordingsList;
  }, [recordingsList]);

  const applyListOnly = useCallback(
    (
      remote: Awaited<ReturnType<typeof fetchAnnotationBundle>>,
      refresh: RefreshRecordingsResult | undefined,
      opts: { isInitial?: boolean; fromPoll?: boolean }
    ) => {
      const prevCount = recordingCountRef.current;
      const nextCount = remote.recordings.length;
      latestAdsbRef.current = remote.adsbData;

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
        return { audio: nextAudio, adsb: remote.adsbData };
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
    [toast]
  );

  const finishAsrForTarget = useCallback(
    async (
      target: AudioData,
      remote: Awaited<ReturnType<typeof fetchAnnotationBundle>>,
      opts?: { loadingMessage?: string }
    ) => {
      setSelectedAudioId(target.id);
      selectedAudioIdRef.current = target.id;
      setWorkspace({ audio: target, adsb: remote.adsbData });

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
        await stampRecordingCaptureNow(target.id, target.duration);
      } catch {
        /* 时间戳写入失败不阻塞转写结果 */
      }
      const nextRemote = await fetchAnnotationBundle({ noCache: true });
      const updated = nextRemote.recordings.find((r) => r.id === target.id);
      if (updated) {
        setRecordingsList(nextRemote.recordings);
        recordingsListRef.current = nextRemote.recordings;
        setRecordingMeta(nextRemote.recordingMeta);
        setWorkspace({ audio: updated, adsb: nextRemote.adsbData });
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
    [toast]
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
          latestAdsbRef.current = remote.adsbData;
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
        setWorkspace((prev) => ({ ...prev, adsb: live.adsbData }));
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
    setWorkspace({ audio: first, adsb: latestAdsbRef.current });
  }, [recordingsList, workspace.audio]);

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
          setWorkspace({ audio: nextAudio, adsb: latestAdsbRef.current });
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
      workspace.audio.id,
    ]
  );

  const handleSelectRecording = useCallback(
    (id: string) => {
      setSelectedAudioId(id);
      selectedAudioIdRef.current = id;
      const next = pickAudio(recordingsList, id);
      if (next) {
        setWorkspace({ audio: next, adsb: latestAdsbRef.current });
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
    [recordingsList, transcriptLoading?.audioId]
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

  const listSyncValue = useMemo(
    () => ({
      recordings: recordingsList,
      recordingMeta,
      updatedAt: lastSyncAt,
      syncing: syncingRecordings,
      pendingTranscriptCount,
      onUpdateOneRecording: () => void runUpdateOneRecording(),
      onTranscribeSelected: () => void runTranscribeSelected(),
      onDeleteRecording: (id: string) => void handleDeleteRecording(id),
      deletingRecordingId,
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
      runTranscribeSelected,
      handleDeleteRecording,
      deletingRecordingId,
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
