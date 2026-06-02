"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  annotationsExtApi,
  audioRecordsExtApi,
  deleteRecordingFromBackend,
  resolveBrowserAudioUrl,
} from "@/lib/backend-api";
import {
  formatDurationMs,
  type AdminAnnotation,
  type AdminAudio,
  type AdminUser,
} from "@/lib/admin-console-data";
import { AdminTranscriptViz } from "@/components/admin-console/admin-transcript-viz";
import {
  AdminBusyOverlay,
  AdminSectionHeader,
  useAdminConfirm,
} from "@/components/admin-console/admin-ux-components";
import { ROLE_LABELS, validateSegmentTimes, type AdminRole } from "@/components/admin-console/admin-usability";
import { admin } from "@/components/admin-console/admin-theme";
import { cn } from "@/lib/utils";

function annSignature(a: AdminAnnotation): string {
  return JSON.stringify({
    id: a.annotation_id,
    start: a.relative_start,
    end: a.relative_end,
    author: a.author_id,
    asr: a.asr_content,
    text: a.annotation_text,
  });
}

export function AdminRecordingWorkspace({
  audio,
  annotations: initialAnnotations,
  users,
  onChanged,
  onDeleted,
}: {
  audio: AdminAudio;
  annotations: AdminAnnotation[];
  users: AdminUser[];
  onChanged: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const { ask, dialog: confirmDialog } = useAdminConfirm();
  const audioRef = useRef<HTMLAudioElement>(null);

  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [selectedAnnId, setSelectedAnnId] = useState<number | null>(null);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editAudio, setEditAudio] = useState(false);
  const [showSourceUrl, setShowSourceUrl] = useState(false);
  const [fileName, setFileName] = useState(audio.file_name);
  const [status, setStatus] = useState(String(audio.status));
  const [audioDraft, setAudioDraft] = useState({ fileName: audio.file_name, status: String(audio.status) });

  useEffect(() => {
    setAnnotations(initialAnnotations);
    setFileName(audio.file_name);
    setStatus(String(audio.status));
    setAudioDraft({ fileName: audio.file_name, status: String(audio.status) });
    setSelectedAnnId(null);
    setSavedSignature(null);
    setEditAudio(false);
  }, [audio.audio_id, initialAnnotations, audio.file_name, audio.status]);

  const durationSec = Math.max(1, audio.duration_ms / 1000);
  const playUrl = resolveBrowserAudioUrl(audio.source_url);

  const selectedAnn = useMemo(
    () => annotations.find((a) => a.annotation_id === selectedAnnId) ?? null,
    [annotations, selectedAnnId]
  );

  const sorted = useMemo(
    () =>
      [...annotations].sort(
        (a, b) => (a.relative_start ?? 0) - (b.relative_start ?? 0)
      ),
    [annotations]
  );

  const isAnnDirty =
    selectedAnn != null && savedSignature != null && annSignature(selectedAnn) !== savedSignature;

  const audioEditDirty =
    editAudio &&
    (audioDraft.fileName.trim() !== audio.file_name || audioDraft.status !== String(audio.status));

  const segmentError = selectedAnn
    ? validateSegmentTimes(
        selectedAnn.relative_start ?? 0,
        selectedAnn.relative_end ?? 0,
        durationSec
      )
    : null;

  const selectAnnotation = useCallback(
    (id: number | null) => {
      if (id === selectedAnnId) return;
      if (isAnnDirty && selectedAnn) {
        ask({
          title: "有未保存的修改",
          description: `标注 #${selectedAnn.annotation_id} 的更改尚未保存，确定放弃吗？`,
          confirmLabel: "放弃修改",
          destructive: false,
          onConfirm: async () => {
            setAnnotations(initialAnnotations);
            setSelectedAnnId(id);
            setSavedSignature(null);
          },
        });
        return;
      }
      setSelectedAnnId(id);
      const ann = id != null ? initialAnnotations.find((a) => a.annotation_id === id) : null;
      setSavedSignature(ann ? annSignature(ann) : null);
      if (ann) {
        setAnnotations((prev) =>
          prev.map((a) => (a.annotation_id === id ? ann : a))
        );
      }
    },
    [ask, initialAnnotations, isAnnDirty, selectedAnn, selectedAnnId]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedAnnId != null) {
        selectAnnotation(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectAnnotation, selectedAnnId]);

  useEffect(() => {
    if (selectedAnnId == null) return;
    const ann = annotations.find((a) => a.annotation_id === selectedAnnId);
    if (ann && savedSignature == null) setSavedSignature(annSignature(ann));
  }, [annotations, selectedAnnId, savedSignature]);

  const cancelAudioEdit = () => {
    setEditAudio(false);
    setFileName(audio.file_name);
    setStatus(String(audio.status));
    setAudioDraft({ fileName: audio.file_name, status: String(audio.status) });
  };

  const saveAudio = async () => {
    const name = audioDraft.fileName.trim();
    if (!name) {
      toast({ title: "请填写文件名", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await audioRecordsExtApi.update(audio.audio_id, {
        file_name: name,
        status: Number(audioDraft.status) || 0,
      });
      toast({ title: "录音信息已保存" });
      setEditAudio(false);
      await onChanged();
    } catch (e) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : "请检查网络后重试",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const deleteAudio = () => {
    ask({
      title: `删除录音「${audio.file_name}」？`,
      description: `将同时删除该录音下的 ${annotations.length} 条标注，此操作不可撤销。`,
      confirmLabel: "删除录音",
      onConfirm: async () => {
        setBusy(true);
        try {
          await deleteRecordingFromBackend(String(audio.audio_id));
          toast({ title: "录音已删除" });
          await onDeleted();
        } catch (e) {
          toast({
            title: "删除失败",
            description: e instanceof Error ? e.message : "",
            variant: "destructive",
          });
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const saveAnnotation = async (ann: AdminAnnotation) => {
    const err = validateSegmentTimes(ann.relative_start ?? 0, ann.relative_end ?? 0, durationSec);
    if (err) {
      toast({ title: err, variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await annotationsExtApi.update(ann.annotation_id, {
        author_id: ann.author_id,
        relative_start: ann.relative_start ?? 0,
        relative_end: ann.relative_end ?? 0,
        asr_content: ann.asr_content ?? "",
        annotation_text: ann.annotation_text ?? "",
        is_annotated: ann.is_annotated ?? 0,
        label_type: ann.label_type ?? "segment",
      });
      toast({ title: "标注已保存" });
      setSavedSignature(annSignature(ann));
      await onChanged();
    } catch (e) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const deleteAnnotation = (id: number) => {
    ask({
      title: `删除标注 #${id}？`,
      description: "删除后无法恢复。",
      onConfirm: async () => {
        setBusy(true);
        try {
          await annotationsExtApi.deleteOne(id);
          toast({ title: "标注已删除" });
          if (selectedAnnId === id) {
            setSelectedAnnId(null);
            setSavedSignature(null);
          }
          await onChanged();
        } catch (e) {
          toast({
            title: "删除失败",
            description: e instanceof Error ? e.message : "",
            variant: "destructive",
          });
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const addAnnotation = async () => {
    const authorId = users[0]?.user_id ?? 1;
    setBusy(true);
    try {
      await annotationsExtApi.create({
        audio_id: audio.audio_id,
        author_id: authorId,
        relative_start: 0,
        relative_end: Math.min(10, durationSec),
        asr_content: "",
        annotation_text: "",
        label_type: "segment",
        is_annotated: 0,
      });
      toast({ title: "已新增标注段，请在下方编辑并保存" });
      await onChanged();
    } catch (e) {
      toast({
        title: "新增失败",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const patchSelected = useCallback(
    (patch: Partial<AdminAnnotation>) => {
      if (!selectedAnn) return;
      const next = { ...selectedAnn, ...patch };
      setAnnotations((prev) =>
        prev.map((a) => (a.annotation_id === next.annotation_id ? next : a))
      );
    },
    [selectedAnn]
  );

  return (
    <div className="relative p-4 space-y-4 max-h-[min(78vh,720px)] overflow-y-auto">
      {confirmDialog}
      {busy ? <AdminBusyOverlay /> : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={cn("text-lg", admin.title)}>{audio.file_name}</h2>
          <p className={cn("text-sm tabular-nums", admin.body)}>
            编号 {audio.audio_id} · 时长 {formatDurationMs(audio.duration_ms)} · 航迹 {audio.track_id}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className={admin.btnOutline}
            onClick={() => {
              if (editAudio) cancelAudioEdit();
              else {
                setEditAudio(true);
                setAudioDraft({ fileName, status });
              }
            }}
            aria-pressed={editAudio}
          >
            <Pencil className="h-3.5 w-3.5 mr-1" aria-hidden />
            {editAudio ? "关闭编辑" : "编辑信息"}
          </Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={deleteAudio}>
            <Trash2 className="h-3.5 w-3.5 mr-1" aria-hidden />
            删除录音
          </Button>
        </div>
      </div>

      {editAudio ? (
        <div className={cn(admin.panelInner, "p-3 space-y-3")}>
          <AdminSectionHeader title="编辑录音信息" description="仅修改显示名称与内部状态码，不影响音频文件本身。" />
          <div>
            <label className={admin.label} htmlFor="admin-audio-filename">
              文件名
            </label>
            <Input
              id="admin-audio-filename"
              value={audioDraft.fileName}
              onChange={(e) => setAudioDraft((d) => ({ ...d, fileName: e.target.value }))}
              className={cn(admin.input, !audioDraft.fileName.trim() && admin.inputError)}
            />
            {!audioDraft.fileName.trim() ? (
              <p className="text-xs text-red-400 mt-1">文件名不能为空</p>
            ) : null}
          </div>
          <div>
            <label className={admin.label} htmlFor="admin-audio-status">
              状态码
            </label>
            <Input
              id="admin-audio-status"
              value={audioDraft.status}
              onChange={(e) => setAudioDraft((d) => ({ ...d, status: e.target.value }))}
              className={admin.input}
            />
            <p className={admin.hint}>系统内部字段，通常保持默认即可。</p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className={admin.btnPrimary}
              disabled={busy || !audioDraft.fileName.trim() || !audioEditDirty}
              onClick={() => void saveAudio()}
            >
              保存
            </Button>
            <Button size="sm" variant="outline" className={admin.btnOutline} onClick={cancelAudioEdit}>
              取消
            </Button>
          </div>
        </div>
      ) : null}

      <div className={cn(admin.panelInner, "p-3 space-y-3")}>
        <AdminSectionHeader title="音频播放" description="点击时间轴片段可定位并播放对应位置。" />
        {playUrl ? (
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            className="w-full h-10"
            src={playUrl}
            onTimeUpdate={() => setPlayhead(audioRef.current?.currentTime ?? 0)}
          />
        ) : (
          <div className="rounded-lg border border-amber-600/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
            <p className="font-medium">暂时无法播放</p>
            <p className="text-xs mt-1 text-amber-200/80">
              请确认 A2 音频服务已启动，且录音地址可访问。
            </p>
          </div>
        )}
        {audio.source_url ? (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
            onClick={() => setShowSourceUrl((v) => !v)}
            aria-expanded={showSourceUrl}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showSourceUrl && "rotate-180")} />
            {showSourceUrl ? "隐藏" : "查看"}文件地址
          </button>
        ) : null}
        {showSourceUrl ? (
          <p className={cn("text-xs break-all font-mono", admin.muted)}>{audio.source_url}</p>
        ) : null}
      </div>

      <div className={cn(admin.panelInner, "p-3 space-y-3")}>
        <AdminSectionHeader
          title="转写时间轴"
          description={`共 ${sorted.length} 段 · 总长 ${durationSec.toFixed(0)} 秒`}
          action={
            <Button size="sm" className={admin.btnPrimary} disabled={busy} onClick={() => void addAnnotation()}>
              <Plus className="h-3.5 w-3.5 mr-1" aria-hidden />
              新增段
            </Button>
          }
        />
        <AdminTranscriptViz
          segments={sorted}
          durationSec={durationSec}
          currentSec={playhead}
          selectedId={selectedAnnId}
          onSelect={(id) => selectAnnotation(id)}
          onSeek={(t) => {
            if (audioRef.current) {
              audioRef.current.currentTime = t;
              void audioRef.current.play();
            }
          }}
        />
      </div>

      {selectedAnn ? (
        <div className={cn(admin.panelInner, "p-3 space-y-3")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AdminSectionHeader
              title={`编辑标注 #${selectedAnn.annotation_id}`}
              description="修改后请点击保存；按 Esc 可关闭编辑面板。"
            />
            <div className="flex items-center gap-2">
              {isAnnDirty ? <span className={admin.unsaved}>未保存</span> : null}
              <Button
                size="sm"
                variant="ghost"
                className={admin.btnGhost}
                onClick={() => selectAnnotation(null)}
                aria-label="关闭编辑"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={admin.label} htmlFor="ann-start">
                开始（秒）
              </label>
              <Input
                id="ann-start"
                type="number"
                step="0.1"
                min={0}
                max={durationSec}
                className={cn(admin.input, segmentError && admin.inputError)}
                value={selectedAnn.relative_start ?? 0}
                onChange={(e) => patchSelected({ relative_start: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className={admin.label} htmlFor="ann-end">
                结束（秒）
              </label>
              <Input
                id="ann-end"
                type="number"
                step="0.1"
                min={0}
                max={durationSec}
                className={cn(admin.input, segmentError && admin.inputError)}
                value={selectedAnn.relative_end ?? 0}
                onChange={(e) => patchSelected({ relative_end: Number(e.target.value) })}
              />
            </div>
          </div>
          {segmentError ? <p className="text-xs text-red-400">{segmentError}</p> : null}
          <div>
            <label className={admin.label} htmlFor="ann-author">
              标注作者
            </label>
            <select
              id="ann-author"
              className={cn("w-full h-9 rounded-md px-2 text-sm", admin.input)}
              value={String(selectedAnn.author_id)}
              onChange={(e) => patchSelected({ author_id: Number(e.target.value) })}
            >
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.username}（{ROLE_LABELS[u.role as AdminRole] ?? u.role}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={admin.label} htmlFor="ann-asr">
              机器转写（ASR）
            </label>
            <Textarea
              id="ann-asr"
              rows={2}
              className={admin.input}
              value={selectedAnn.asr_content ?? ""}
              onChange={(e) => patchSelected({ asr_content: e.target.value })}
            />
          </div>
          <div>
            <label className={admin.label} htmlFor="ann-text">
              人工标注文本
            </label>
            <Textarea
              id="ann-text"
              rows={2}
              className={admin.input}
              value={selectedAnn.annotation_text ?? ""}
              onChange={(e) => patchSelected({ annotation_text: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className={admin.btnPrimary}
              disabled={busy || !!segmentError || !isAnnDirty}
              onClick={() => void saveAnnotation(selectedAnn)}
            >
              保存标注
            </Button>
            <Button size="sm" variant="outline" className={admin.btnOutline} onClick={() => selectAnnotation(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => deleteAnnotation(selectedAnn.annotation_id)}
            >
              删除本段
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={admin.btnOutline}
              onClick={() => {
                if (audioRef.current && selectedAnn.relative_start != null) {
                  audioRef.current.currentTime = selectedAnn.relative_start;
                  void audioRef.current.play();
                }
              }}
            >
              <Play className="h-3.5 w-3.5 mr-1" aria-hidden />
              播放本段
            </Button>
          </div>
        </div>
      ) : (
        sorted.length > 0 && (
          <p className={cn("text-sm text-center py-2", admin.muted)}>
            点击时间轴或下方列表中的某一行以编辑标注
          </p>
        )
      )}

      <div className={cn(admin.panelInner, "overflow-hidden")}>
        <AdminSectionHeader title="标注列表" description="与上方时间轴一一对应" />
        <table className="w-full text-sm">
          <thead className={admin.tableHead}>
            <tr>
              <th className="p-2 text-left font-normal">编号</th>
              <th className="p-2 text-left font-normal">时段</th>
              <th className="p-2 text-left font-normal">作者</th>
              <th className="p-2 text-left font-normal">文本</th>
              <th className="p-2 w-16 font-normal" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className={cn("p-6 text-center text-sm", admin.muted)}>
                  暂无标注段，点击「新增段」开始添加
                </td>
              </tr>
            ) : (
              sorted.map((ann) => (
                <tr
                  key={ann.annotation_id}
                  className={cn(
                    "border-t border-slate-700 cursor-pointer hover:bg-slate-800/50",
                    selectedAnnId === ann.annotation_id && "bg-sky-950/50"
                  )}
                  onClick={() => selectAnnotation(ann.annotation_id)}
                >
                  <td className={cn("p-2 tabular-nums", admin.tableCell)}>{ann.annotation_id}</td>
                  <td className={cn("p-2 whitespace-nowrap tabular-nums", admin.tableCell)}>
                    {ann.relative_start?.toFixed(1)} – {ann.relative_end?.toFixed(1)} 秒
                  </td>
                  <td className={cn("p-2", admin.tableCell)}>{ann.author_id}</td>
                  <td className={cn("p-2 max-w-[240px] truncate", admin.tableCell)}>
                    {ann.annotation_text || ann.asr_content || "—"}
                  </td>
                  <td className="p-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-red-400 hover:bg-red-950"
                      aria-label={`删除标注 ${ann.annotation_id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAnnotation(ann.annotation_id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
