"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Database,
  FileAudio,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { deleteTableItem } from "@/lib/backend-api";
import { AdminRecordingWorkspace } from "@/components/admin-console/admin-recording-workspace";
import { AdminStatCard } from "@/components/admin-console/admin-stat-card";
import {
  AdminContextHelp,
  AdminEmptyState,
  AdminErrorBanner,
  AdminPageSkeleton,
  useAdminConfirm,
} from "@/components/admin-console/admin-ux-components";
import {
  fetchAdminSnapshot,
  formatDurationMs,
  patchUserRole,
  type AdminAnnotation,
  type AdminAudio,
  type AdminSnapshot,
  type AdminUser,
} from "@/lib/admin-console-data";
import {
  formatRelativeTime,
  listFilterSummary,
  ROLE_LABELS,
  TAB_ITEMS,
  type AdminRole,
} from "@/components/admin-console/admin-usability";
import { admin } from "@/components/admin-console/admin-theme";

type TabKey = (typeof TAB_ITEMS)[number]["key"];

export function AdminConsolePage() {
  const { toast } = useToast();
  const { ask, dialog: confirmDialog } = useAdminConfirm();
  const audioSearchRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [tab, setTab] = useState<TabKey>("recordings");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(null);
  const [audioQuery, setAudioQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [annQuery, setAnnQuery] = useState("");
  const [roleBusy, setRoleBusy] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent;
    if (silent) setRefreshing(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await fetchAdminSnapshot();
      setSnapshot(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法连接服务器");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && tab === "recordings" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        audioSearchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  const filteredAudios = useMemo(() => {
    if (!snapshot) return [];
    const q = audioQuery.trim().toLowerCase();
    if (!q) return snapshot.audios;
    return snapshot.audios.filter(
      (a) =>
        a.file_name.toLowerCase().includes(q) ||
        String(a.audio_id).includes(q)
    );
  }, [snapshot, audioQuery]);

  const filteredUsers = useMemo(() => {
    if (!snapshot) return [];
    const q = userQuery.trim().toLowerCase();
    if (!q) return snapshot.users;
    return snapshot.users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.email?.toLowerCase().includes(q) ?? false) ||
        String(u.user_id).includes(q)
    );
  }, [snapshot, userQuery]);

  const filteredAnnotations = useMemo(() => {
    if (!snapshot) return [];
    const q = annQuery.trim().toLowerCase();
    if (!q) return snapshot.annotations;
    return snapshot.annotations.filter((ann) => {
      const audio = snapshot.audioById.get(ann.audio_id);
      const text = (ann.annotation_text || ann.asr_content || "").toLowerCase();
      const author = snapshot.users.find((u) => u.user_id === ann.author_id)?.username ?? "";
      return (
        String(ann.annotation_id).includes(q) ||
        String(ann.audio_id).includes(q) ||
        text.includes(q) ||
        author.toLowerCase().includes(q) ||
        (audio?.file_name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [snapshot, annQuery]);

  const selectedAudio = useMemo(() => {
    if (!snapshot || selectedAudioId == null) return null;
    return snapshot.audioById.get(selectedAudioId) ?? null;
  }, [snapshot, selectedAudioId]);

  const annotationsForAudio = useMemo(() => {
    if (!snapshot || selectedAudioId == null) return [];
    return snapshot.annotations.filter((a) => a.audio_id === selectedAudioId);
  }, [snapshot, selectedAudioId]);

  const handleRoleChange = async (user: AdminUser, role: AdminRole) => {
    if (user.role === role) return;
    setRoleBusy(true);
    try {
      const updated = await patchUserRole(user.user_id, role);
      setSnapshot((prev) => {
        if (!prev) return prev;
        const users = prev.users.map((u) => (u.user_id === updated.user_id ? updated : u));
        const bundlesByUserId = new Map(prev.bundlesByUserId);
        const b = bundlesByUserId.get(updated.user_id);
        if (b) bundlesByUserId.set(updated.user_id, { ...b, user: updated });
        return { ...prev, users, bundlesByUserId };
      });
      toast({ title: `已将 ${user.username} 设为${ROLE_LABELS[role]}` });
    } catch (e) {
      toast({
        title: "角色修改失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setRoleBusy(false);
    }
  };

  const deleteUser = (user: AdminUser) => {
    ask({
      title: `删除用户「${user.username}」？`,
      description: "此操作不可撤销。该用户的标注记录仍会保留，但账号将无法登录。",
      confirmLabel: "删除用户",
      onConfirm: async () => {
        await deleteTableItem("users", user.user_id);
        toast({ title: "用户已删除" });
        if (selectedUserId === user.user_id) setSelectedUserId(null);
        await load({ silent: true });
      },
    });
  };

  const activeTabHint = TAB_ITEMS.find((t) => t.key === tab)?.hint;

  return (
    <div className={admin.page}>
      {confirmDialog}
      <div className="mx-auto max-w-[1500px] px-4 py-5 space-y-5">
        <header className={cn(admin.hero, "flex flex-wrap items-center justify-between gap-4")}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-sky-600 flex items-center justify-center" aria-hidden>
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className={admin.heroTitle}>Alpha 后台管理</h1>
              <p className={cn("text-sm", admin.muted)}>
                地空通话数据维护
                {lastUpdated ? (
                  <span className="ml-2 tabular-nums">· 更新于 {formatRelativeTime(lastUpdated)}</span>
                ) : null}
                {refreshing ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-sky-400">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    刷新中
                  </span>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className={admin.btnOutline} asChild>
              <Link href="/">
                <ArrowLeft className="h-4 w-4 mr-1" aria-hidden />
                返回前台
              </Link>
            </Button>
            <Button
              size="sm"
              className={admin.btnPrimary}
              onClick={() => void load({ silent: !!snapshot })}
              disabled={loading || refreshing}
              aria-busy={refreshing}
            >
              {loading || refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              <span className="ml-1">刷新数据</span>
            </Button>
          </div>
        </header>

        {error && !snapshot ? (
          <AdminErrorBanner message={error} onRetry={() => void load()} retrying={loading} />
        ) : null}

        {loading && !snapshot ? <AdminPageSkeleton /> : null}

        {snapshot ? (
          <>
            {error ? (
              <AdminErrorBanner message={error} onRetry={() => void load({ silent: true })} retrying={refreshing} />
            ) : null}

            <section aria-label="数据概览">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <AdminStatCard icon={<Users className="h-4 w-4" />} label="注册用户" value={snapshot.users.length} />
                <AdminStatCard icon={<FileAudio className="h-4 w-4" />} label="录音文件" value={snapshot.audios.length} />
                <AdminStatCard icon={<Activity className="h-4 w-4" />} label="转写标注" value={snapshot.annotations.length} />
                <AdminStatCard icon={<Database className="h-4 w-4" />} label="ADS-B 航迹" value={snapshot.trackCount} />
              </div>
            </section>

            <nav aria-label="管理模块" className="space-y-2">
              <div className="flex flex-wrap gap-2" role="tablist">
                {TAB_ITEMS.map(({ key, label }) => {
                  const count =
                    key === "recordings"
                      ? snapshot.audios.length
                      : key === "users"
                        ? snapshot.users.length
                        : snapshot.annotations.length;
                  return (
                    <Button
                      key={key}
                      role="tab"
                      aria-selected={tab === key}
                      size="sm"
                      variant={tab === key ? "default" : "outline"}
                      className={cn("rounded-lg gap-1.5", tab === key ? admin.tabActive : admin.tabIdle)}
                      onClick={() => setTab(key)}
                    >
                      {label}
                      <span className={admin.badge}>{count}</span>
                    </Button>
                  );
                })}
              </div>
              {activeTabHint ? <p className={cn("text-xs", admin.muted)}>{activeTabHint}</p> : null}
            </nav>

            {tab === "recordings" ? (
              <div
                role="tabpanel"
                className="grid lg:grid-cols-[minmax(280px,340px)_1fr] gap-4 min-h-[520px]"
              >
                <aside className={cn(admin.panel, "flex flex-col overflow-hidden")}>
                  <div className="p-3 border-b border-slate-600 space-y-2">
                    <label className={admin.label} htmlFor="admin-audio-search">
                      搜索录音
                    </label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
                      <Input
                        id="admin-audio-search"
                        ref={audioSearchRef}
                        value={audioQuery}
                        onChange={(e) => setAudioQuery(e.target.value)}
                        placeholder="文件名或编号"
                        className={cn(admin.input, "pl-8")}
                      />
                      {audioQuery ? (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                          onClick={() => setAudioQuery("")}
                          aria-label="清除搜索"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                    <p className={admin.hint}>
                      {listFilterSummary(snapshot.audios.length, filteredAudios.length, audioQuery)}
                      {!audioQuery ? " · 按 / 聚焦搜索" : ""}
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-[min(70vh,600px)]">
                    {filteredAudios.length === 0 ? (
                      <AdminEmptyState
                        title="没有匹配的录音"
                        description="试试更短的关键词，或清除搜索查看全部列表。"
                        action={
                          audioQuery ? (
                            <Button size="sm" variant="outline" className={admin.btnOutline} onClick={() => setAudioQuery("")}>
                              清除搜索
                            </Button>
                          ) : undefined
                        }
                      />
                    ) : (
                      filteredAudios.map((a) => (
                        <button
                          key={a.audio_id}
                          type="button"
                          aria-current={selectedAudioId === a.audio_id ? "true" : undefined}
                          onClick={() => setSelectedAudioId(a.audio_id)}
                          className={cn(
                            "w-full text-left rounded-lg px-3 py-2 transition-colors",
                            selectedAudioId === a.audio_id ? admin.listActive : admin.listIdle
                          )}
                        >
                          <div className={cn("text-sm font-medium truncate", admin.body)}>{a.file_name}</div>
                          <div className={cn("text-xs tabular-nums", admin.muted)}>
                            编号 {a.audio_id} · {formatDurationMs(a.duration_ms)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </aside>
                <main className={cn(admin.panel, "min-h-[480px]")}>
                  {selectedAudio ? (
                    <AdminRecordingWorkspace
                      key={selectedAudio.audio_id}
                      audio={selectedAudio}
                      annotations={annotationsForAudio}
                      users={snapshot.users}
                      onChanged={() => load({ silent: true })}
                      onDeleted={async () => {
                        setSelectedAudioId(null);
                        await load({ silent: true });
                      }}
                    />
                  ) : (
                    <AdminEmptyState
                      title="请从左侧选择一条录音"
                      description="选中后可播放音频、查看转写时间轴，并编辑或新增标注段。"
                    />
                  )}
                </main>
              </div>
            ) : null}

            {tab === "users" ? (
              <div role="tabpanel" className="grid lg:grid-cols-[280px_1fr] gap-4">
                <aside className={cn(admin.panel, "p-3 space-y-2 flex flex-col")}>
                  <label className={admin.label} htmlFor="admin-user-search">
                    搜索用户
                  </label>
                  <Input
                    id="admin-user-search"
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="用户名、邮箱或编号"
                    className={admin.input}
                  />
                  <p className={admin.hint}>{listFilterSummary(snapshot.users.length, filteredUsers.length, userQuery)}</p>
                  <div className="flex-1 overflow-y-auto space-y-1 max-h-[min(70vh,560px)]">
                    {filteredUsers.map((u) => (
                      <button
                        key={u.user_id}
                        type="button"
                        aria-current={selectedUserId === u.user_id ? "true" : undefined}
                        onClick={() => setSelectedUserId(u.user_id)}
                        className={cn(
                          "w-full text-left rounded-lg px-3 py-2",
                          selectedUserId === u.user_id ? admin.listActive : admin.listIdle
                        )}
                      >
                        <div className={cn("text-sm font-medium", admin.body)}>{u.username}</div>
                        <div className={cn("text-xs", admin.muted)}>
                          {ROLE_LABELS[u.role as AdminRole] ?? u.role} · 编号 {u.user_id}
                        </div>
                      </button>
                    ))}
                  </div>
                </aside>
                <main className={cn(admin.panel, "p-4")}>
                  {selectedUserId != null ? (
                    (() => {
                      const u = snapshot.users.find((x) => x.user_id === selectedUserId);
                      if (!u) return null;
                      const b = snapshot.bundlesByUserId.get(u.user_id);
                      return (
                        <div className="space-y-4">
                          <div className="flex flex-wrap justify-between gap-3">
                            <div>
                              <h2 className={admin.title}>{u.username}</h2>
                              <p className={admin.body}>
                                编号 {u.user_id}
                                {u.email ? ` · ${u.email}` : ""}
                              </p>
                            </div>
                            <Button size="sm" variant="destructive" onClick={() => deleteUser(u)}>
                              <Trash2 className="h-3.5 w-3.5 mr-1" aria-hidden />
                              删除用户
                            </Button>
                          </div>
                          <div>
                            <p className={admin.label}>账号角色</p>
                            <div className="flex flex-wrap gap-2 items-center">
                              {(["viewer", "annotator", "admin"] as const).map((r) => (
                                <Button
                                  key={r}
                                  size="sm"
                                  variant={u.role === r ? "default" : "outline"}
                                  className={u.role === r ? admin.btnPrimary : admin.btnOutline}
                                  disabled={roleBusy}
                                  aria-pressed={u.role === r}
                                  onClick={() => void handleRoleChange(u, r)}
                                >
                                  {ROLE_LABELS[r]}
                                </Button>
                              ))}
                            </div>
                            <p className={admin.hint}>管理员可进入本后台；标注员可在前台编辑转写。</p>
                          </div>
                          <div className={cn("text-sm", admin.body)}>
                            已提交 <strong>{b?.annotationCount ?? 0}</strong> 条标注，涉及{" "}
                            <strong>{b?.audios.length ?? 0}</strong> 条录音
                          </div>
                          {b?.audios.length ? (
                            <SimpleAudioList
                              rows={b.audios}
                              onPick={(id) => {
                                setSelectedAudioId(id);
                                setTab("recordings");
                              }}
                            />
                          ) : (
                            <p className={cn("text-sm", admin.muted)}>该用户尚未关联任何录音标注。</p>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <AdminEmptyState
                      title="请从左侧选择用户"
                      description="可查看并修改角色，或跳转到其参与标注的录音。"
                    />
                  )}
                </main>
              </div>
            ) : null}

            {tab === "annotations" ? (
              <div role="tabpanel" className={cn(admin.panel, "p-3 space-y-3")}>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[200px]">
                    <label className={admin.label} htmlFor="admin-ann-search">
                      搜索标注
                    </label>
                    <Input
                      id="admin-ann-search"
                      value={annQuery}
                      onChange={(e) => setAnnQuery(e.target.value)}
                      placeholder="文本、录音编号、标注编号或作者"
                      className={admin.input}
                    />
                  </div>
                  <p className={cn("text-xs pb-2", admin.muted)}>
                    {listFilterSummary(snapshot.annotations.length, filteredAnnotations.length, annQuery)}
                  </p>
                </div>
                <AnnotationsCrudTable
                  rows={filteredAnnotations}
                  audioById={snapshot.audioById}
                  users={snapshot.users}
                  onRefresh={() => load({ silent: true })}
                  onOpenAudio={(id) => {
                    setSelectedAudioId(id);
                    setTab("recordings");
                  }}
                  askConfirm={ask}
                />
              </div>
            ) : null}

            <AdminContextHelp>
              <p>
                <strong>录音管理：</strong>左侧选录音 → 播放并点选时间轴片段 → 编辑后点「保存标注」。
              </p>
              <p>
                <strong>用户：</strong>修改角色后立即生效；删除用户不会删除其历史标注。
              </p>
              <p>
                <strong>快捷：</strong>在「录音管理」页按 <kbd className="px-1 rounded bg-slate-700">/</kbd>{" "}
                可快速搜索。
              </p>
            </AdminContextHelp>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SimpleAudioList({
  rows,
  onPick,
}: {
  rows: AdminAudio[];
  onPick: (audioId: number) => void;
}) {
  return (
    <div className="overflow-x-auto max-h-64 rounded-lg border border-slate-600">
      <table className="w-full text-sm">
        <thead className={admin.tableHead}>
          <tr>
            <th className="p-2 text-left font-normal">编号</th>
            <th className="p-2 text-left font-normal">文件名</th>
            <th className="p-2 w-24" />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.audio_id} className="border-t border-slate-700">
              <td className={cn("p-2 tabular-nums", admin.tableCell)}>{a.audio_id}</td>
              <td className={cn("p-2 truncate max-w-[200px]", admin.tableCell)}>{a.file_name}</td>
              <td className="p-2">
                <Button size="sm" className={cn("h-7 text-xs", admin.btnOutline)} onClick={() => onPick(a.audio_id)}>
                  查看录音
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnnotationsCrudTable({
  rows,
  audioById,
  users,
  onRefresh,
  onOpenAudio,
  askConfirm,
}: {
  rows: AdminAnnotation[];
  audioById: Map<number, AdminAudio>;
  users: AdminUser[];
  onRefresh: () => void | Promise<void>;
  onOpenAudio: (id: number) => void;
  askConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel?: string;
    onConfirm: () => void | Promise<void>;
  }) => void;
}) {
  const { toast } = useToast();
  const usersById = new Map(users.map((u) => [u.user_id, u]));

  const deleteAnn = (id: number) => {
    askConfirm({
      title: `删除标注 #${id}？`,
      description: "删除后无法恢复，请确认该段转写不再需要。",
      onConfirm: async () => {
        const { annotationsExtApi } = await import("@/lib/backend-api");
        await annotationsExtApi.deleteOne(id);
        toast({ title: "标注已删除" });
        await onRefresh();
      },
    });
  };

  if (rows.length === 0) {
    return (
      <AdminEmptyState title="暂无标注记录" description="切换关键词，或到「录音管理」中为录音新增标注段。" />
    );
  }

  return (
    <div className="overflow-auto max-h-[min(70vh,640px)] rounded-lg border border-slate-600">
      <table className="w-full text-sm">
        <thead className={cn("sticky top-0 z-10", admin.tableHead)}>
          <tr>
            <th className="p-2 text-left font-normal">编号</th>
            <th className="p-2 text-left font-normal">所属录音</th>
            <th className="p-2 text-left font-normal">作者</th>
            <th className="p-2 text-left font-normal">时段</th>
            <th className="p-2 text-left font-normal">文本摘要</th>
            <th className="p-2 w-32 font-normal">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((ann) => {
            const audio = audioById.get(ann.audio_id);
            const preview = (ann.annotation_text || ann.asr_content || "").slice(0, 48);
            return (
              <tr key={ann.annotation_id} className="border-t border-slate-700 hover:bg-slate-800/60">
                <td className={cn("p-2 tabular-nums", admin.tableCell)}>{ann.annotation_id}</td>
                <td className={cn("p-2", admin.tableCell)}>
                  <span className="tabular-nums">{ann.audio_id}</span>
                  {audio ? (
                    <span className={cn("block text-xs truncate max-w-[160px]", admin.muted)}>
                      {audio.file_name}
                    </span>
                  ) : null}
                </td>
                <td className={cn("p-2", admin.tableCell)}>
                  {usersById.get(ann.author_id)?.username ?? `用户 ${ann.author_id}`}
                </td>
                <td className={cn("p-2 whitespace-nowrap tabular-nums", admin.tableCell)}>
                  {ann.relative_start?.toFixed(1)} – {ann.relative_end?.toFixed(1)} 秒
                </td>
                <td className={cn("p-2 max-w-[220px] truncate", admin.tableCell)}>{preview || "—"}</td>
                <td className="p-2">
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      className={cn("h-7 text-xs", admin.btnOutline)}
                      onClick={() => onOpenAudio(ann.audio_id)}
                    >
                      打开录音
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-red-400 hover:text-red-300 hover:bg-red-950"
                      aria-label={`删除标注 ${ann.annotation_id}`}
                      onClick={() => deleteAnn(ann.annotation_id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
