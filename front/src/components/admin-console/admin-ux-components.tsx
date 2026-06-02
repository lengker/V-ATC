"use client";

import { useCallback, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, ChevronDown, HelpCircle, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { admin } from "@/components/admin-console/admin-theme";
import { cn } from "@/lib/utils";

/** 01 · 系统状态：可操作的错误提示 */
export function AdminErrorBanner({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-500/80 bg-red-950/90 px-4 py-3 flex flex-wrap items-start justify-between gap-3"
    >
      <div className="flex gap-2 text-sm text-red-100">
        <AlertCircle className="h-5 w-5 shrink-0 text-red-400" aria-hidden />
        <div>
          <p className="font-medium">数据加载失败</p>
          <p className="mt-0.5 text-red-200/90">{message}</p>
          <p className="mt-1 text-xs text-red-300/80">请确认 A5 后端已启动，然后重试。</p>
        </div>
      </div>
      {onRetry ? (
        <Button
          size="sm"
          variant="outline"
          className="border-red-400/60 text-red-100 hover:bg-red-900"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          重试
        </Button>
      ) : null}
    </div>
  );
}

/** 01 · 首屏骨架屏 */
export function AdminPageSkeleton() {
  return (
    <div className="space-y-5 animate-pulse" aria-busy="true" aria-label="正在加载数据">
      <div className="h-16 rounded-xl bg-slate-800" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-slate-800" />
        ))}
      </div>
      <div className="h-10 w-72 rounded-lg bg-slate-800" />
      <div className="grid lg:grid-cols-[300px_1fr] gap-4 min-h-[420px]">
        <div className="rounded-xl bg-slate-800" />
        <div className="rounded-xl bg-slate-800" />
      </div>
    </div>
  );
}

/** 06 · 空状态：说明下一步 */
export function AdminEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-16 gap-2">
      <p className={cn("text-base font-medium", admin.body)}>{title}</p>
      {description ? <p className={cn("text-sm max-w-sm", admin.muted)}>{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** 08 · 区块标题 + 可选说明 */
export function AdminSectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
      <div>
        <h3 className={cn("text-sm font-semibold", admin.body)}>{title}</h3>
        {description ? <p className={cn("text-xs mt-0.5", admin.muted)}>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** 10 · 上下文帮助（可关闭） */
export function AdminContextHelp({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-600/60 bg-slate-800/40">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800/80 rounded-lg"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <HelpCircle className="h-4 w-4 text-sky-400" aria-hidden />
          操作说明
        </span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className={cn("px-3 pb-3 text-xs leading-relaxed space-y-1", admin.muted)}>{children}</div>
      ) : null}
    </div>
  );
}

/** 03 · 删除确认（替代原生 confirm） */
type ConfirmState = {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function useAdminConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback((opts: ConfirmState) => setState(opts), []);
  const close = useCallback(() => {
    if (!busy) setState(null);
  }, [busy]);

  const dialog = state ? (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-600 bg-slate-900 p-5 shadow-xl"
          aria-describedby="admin-confirm-desc"
        >
          <Dialog.Title className={cn("text-lg font-semibold", admin.title)}>{state.title}</Dialog.Title>
          <Dialog.Description id="admin-confirm-desc" className={cn("mt-2 text-sm", admin.body)}>
            {state.description}
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" variant="outline" className={admin.btnOutline} onClick={close} disabled={busy}>
              取消
            </Button>
            <Button
              size="sm"
              variant={state.destructive === false ? "default" : "destructive"}
              className={state.destructive === false ? admin.btnPrimary : undefined}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void Promise.resolve(state.onConfirm()).finally(() => {
                  setBusy(false);
                  setState(null);
                });
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {state.confirmLabel ?? "确认删除"}
            </Button>
          </div>
          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute top-3 right-3 text-slate-400 hover:text-white"
              aria-label="关闭"
              disabled={busy}
            >
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  ) : null;

  return { ask, dialog };
}

/** 01 · 全局忙碌指示 */
export function AdminBusyOverlay({ label }: { label?: string }) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-slate-950/50 backdrop-blur-[1px]"
      aria-live="polite"
      aria-busy="true"
    >
      <div className={cn("flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-slate-900 border border-slate-600", admin.body)}>
        <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
        {label ?? "处理中…"}
      </div>
    </div>
  );
}
