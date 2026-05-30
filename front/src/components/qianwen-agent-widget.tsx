"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Bot, Send, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { AgentWorkspaceSnapshot } from "@/lib/agent-workspace-context";
import type { VoiceTimestamp } from "@/types";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary";

type AgentMode =
  | "rewrite_annotation"
  | "summarize_segment"
  | "summarize_transcript"
  | "custom";

type SegmentPatch = { id: string; text: string };

type AgentResponse = {
  ok: boolean;
  reply?: string;
  suggestedText?: string;
  segmentPatches?: SegmentPatch[];
  error?: string;
  debug?: unknown;
};

type ChatMsg = { id: string; role: "user" | "assistant"; content: string };

const MODE_PRESETS: Record<AgentMode, { label: string; placeholder: string }> = {
  rewrite_annotation: {
    label: "改写",
    placeholder: "请改正当前录音全部转写的语法和 ASR 错误，逐段输出可写入文本。",
  },
  summarize_segment: {
    label: "段总结",
    placeholder: "请总结当前选中时间戳及播放头附近通话要点。",
  },
  summarize_transcript: {
    label: "全文总结",
    placeholder: "请总结本条录音全部通话的主题与关键指令。",
  },
  custom: {
    label: "自定义",
    placeholder: "输入问题；若需改转写请写「帮我修改转写」等。",
  },
};

function wantsRewrite(command: string, mode: AgentMode): boolean {
  if (mode === "rewrite_annotation") return true;
  return /修改|改写|纠正|润色|语法|错别字|转写|没有错误|帮我改/.test(command);
}

export function QianwenAgentWidget({
  audioId,
  currentTime,
  selectedAircraft,
  selectedTimestamp,
  workspace,
  onApplySuggestedText,
  onApplySegmentPatches,
  className,
}: {
  audioId: string;
  currentTime: number;
  selectedAircraft?: string;
  selectedTimestamp: VoiceTimestamp | null;
  workspace: AgentWorkspaceSnapshot;
  onApplySuggestedText: (text: string, opts?: { applyToAll?: boolean }) => void;
  onApplySegmentPatches: (patches: SegmentPatch[]) => void | Promise<void>;
  className?: string;
}) {
  const { toast } = useToast();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AgentMode>("rewrite_annotation");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localApiKey, setLocalApiKey] = useState("");
  const [lastDebug, setLastDebug] = useState<unknown>(null);

  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [suggestedText, setSuggestedText] = useState<string | null>(null);
  const [segmentPatches, setSegmentPatches] = useState<SegmentPatch[] | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("alpha.qianwen.apiKey");
      if (raw) setLocalApiKey(raw);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat, open, suggestedText, segmentPatches, error]);

  useEffect(() => {
    if (open && !input.trim()) {
      setInput(MODE_PRESETS[mode].placeholder);
    }
  }, [open, mode, input]);

  const context = useMemo(() => {
    const ts = selectedTimestamp;
    const tsRange = ts ? `${ts.startTime.toFixed(1)}-${ts.endTime.toFixed(1)}s` : "N/A";
    const ac = selectedAircraft ?? "N/A";
    const recCount = workspace.recordings.length;
    const segCount = workspace.activeRecording.transcriptStats.segmentCount;
    const atPlayhead = workspace.activeRecording.transcript.find((t) => t.isAtPlayhead);
    const applyHint = ts
      ? `将写入已选段 ${tsRange}`
      : atPlayhead
        ? `将写入播放头段 ${atPlayhead.startTime.toFixed(1)}-${atPlayhead.endTime.toFixed(1)}s`
        : segCount > 0
          ? `可写入全部 ${segCount} 段`
          : "暂无片段可写";
    return { tsRange, ac, recCount, segCount, applyHint };
  }, [selectedAircraft, selectedTimestamp, workspace]);

  const applyMode = useCallback((next: AgentMode) => {
    setMode(next);
    setInput(MODE_PRESETS[next].placeholder);
  }, []);

  const clearChat = useCallback(() => {
    setChat([]);
    setSuggestedText(null);
    setSegmentPatches(null);
    setError(null);
    setLastDebug(null);
  }, []);

  const applyPatches = useCallback(
    async (patches: SegmentPatch[]) => {
      await onApplySegmentPatches(patches);
      setOpen(false);
    },
    [onApplySegmentPatches]
  );

  const applySingle = useCallback(
    (text: string) => {
      onApplySuggestedText(text, {
        applyToAll: mode === "summarize_transcript",
      });
      setOpen(false);
    },
    [mode, onApplySuggestedText]
  );

  const submit = useCallback(async () => {
    const command = input.trim();
    if (!command) return;
    setLoading(true);
    setError(null);
    setSuggestedText(null);
    setSegmentPatches(null);
    setLastDebug(null);

    const userMsg: ChatMsg = {
      id: `${Date.now()}-u`,
      role: "user",
      content: command,
    };
    setChat((prev) => [...prev, userMsg]);
    setInput("");

    try {
      const res = await fetch("/api/qianwen/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(localApiKey.trim() ? { "x-qianwen-api-key": localApiKey.trim() } : {}),
        },
        body: JSON.stringify({
          mode,
          userCommand: command,
          audio: { id: audioId },
          currentTime,
          selectedAircraft,
          selectedTimestamp,
          transcriptText: selectedTimestamp?.text ?? "",
          workspace,
        }),
      });

      const data: AgentResponse = await res.json().catch(() => ({
        ok: false,
        error: "Invalid JSON response",
      }));

      if (!res.ok || !data.ok) {
        setLastDebug(data.debug ?? null);
        const debugTail =
          data?.debug && typeof data.debug === "object"
            ? ` (debug: headerPresent=${String((data.debug as { headerPresent?: boolean }).headerPresent)})`
            : "";
        const msg = (data.error || `Agent request failed (${res.status})`) + debugTail;
        setError(msg);
        toast({ title: "智能体调用失败", description: msg, variant: "destructive" });
        return;
      }

      setChat((prev) => [
        ...prev,
        {
          id: `${Date.now()}-a`,
          role: "assistant",
          content: data.reply || "（无文字回复）",
        },
      ]);

      const rewrite = wantsRewrite(command, mode);

      if (data.segmentPatches?.length) {
        setSegmentPatches(data.segmentPatches);
        if (rewrite) {
          await applyPatches(data.segmentPatches);
          toast({ title: "已自动写入转写", description: `已更新 ${data.segmentPatches.length} 段。` });
        } else {
          toast({ title: "已生成逐段改写", description: "点击下方按钮写入转写。" });
        }
        return;
      }

      if (data.suggestedText) {
        setSuggestedText(data.suggestedText);
        if (rewrite) {
          applySingle(data.suggestedText);
          toast({ title: "已自动写入转写", description: "已应用 suggestedText。" });
        } else {
          toast({ title: "已生成建议", description: "点击下方「应用建议到转写」。" });
        }
        return;
      }

      if (rewrite) {
        toast({
          title: "未返回可写入文本",
          description: "模型只做了分析。请再发一次，或切换到「改写」模式。",
          variant: "destructive",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      toast({ title: "智能体异常", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [
    applyPatches,
    applySingle,
    audioId,
    currentTime,
    input,
    localApiKey,
    mode,
    selectedAircraft,
    selectedTimestamp,
    toast,
    workspace,
  ]);

  return (
    <ErrorBoundary name="千问智能体（A-4）">
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className={cn("rounded-2xl h-10 w-10 shadow-lg", className)}
            aria-label="Open Qianwen agent"
          >
            <Bot className="h-5 w-5 text-primary" />
          </Button>
        </DialogPrimitive.Trigger>

        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
          <DialogPrimitive.Content
            className={cn(
              "fixed right-3 top-16 z-50 flex w-[420px] max-w-[calc(100vw-24px)] flex-col",
              "max-h-[min(85vh,720px)] h-[min(85vh,720px)] overflow-hidden",
              "rounded-3xl border border-border/70 bg-background shadow-2xl"
            )}
            aria-describedby="qianwen-agent-desc"
          >
            <DialogPrimitive.Title className="sr-only">千问智能体（A-4）</DialogPrimitive.Title>
            <DialogPrimitive.Description id="qianwen-agent-desc" className="sr-only">
              千问智能体对话窗口
            </DialogPrimitive.Description>

            {/* 顶栏固定 */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <Bot className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">千问智能体（A-4）</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {context.recCount} 条录音 · {context.segCount} 段 · TS {context.tsRange}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-xl"
                  title="清空对话"
                  onClick={clearChat}
                  disabled={loading || chat.length === 0}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <DialogPrimitive.Close asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-xl">
                    <X className="h-4 w-4" />
                  </Button>
                </DialogPrimitive.Close>
              </div>
            </div>

            {/* 中间：仅对话区滚动 */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2">
              {chat.length === 0 ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  已接入当前页面转写与地图数据。说「帮我修改转写」会<strong>自动写入</strong>语音剪辑区。
                </p>
              ) : null}

              {chat.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "rounded-2xl border p-2.5",
                    m.role === "user"
                      ? "border-border/70 bg-background/40"
                      : "border-border/60 bg-background/20"
                  )}
                >
                  <div className="mb-1 text-[10px] text-muted-foreground">
                    {m.role === "user" ? "你" : "智能体"}
                  </div>
                  <div className="max-h-[min(40vh,280px)] overflow-y-auto text-sm whitespace-pre-wrap">
                    {m.content}
                  </div>
                </div>
              ))}

              {error ? (
                <div className="rounded-2xl border border-red-300/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                  {error}
                </div>
              ) : null}

              {lastDebug ? (
                <div className="rounded-2xl border border-border/60 bg-background/20 px-2 py-1 text-[10px] text-muted-foreground">
                  debug: {JSON.stringify(lastDebug)}
                </div>
              ) : null}

              <div ref={chatEndRef} />
            </div>

            {/* 建议区：固定在输入框上方 */}
            {(suggestedText || segmentPatches?.length) ? (
              <div className="shrink-0 space-y-2 border-t border-border/60 bg-primary/5 px-3 py-2">
                {segmentPatches?.length ? (
                  <>
                    <div className="text-xs font-semibold text-primary">
                      逐段改写（{segmentPatches.length} 段）
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 w-full rounded-2xl"
                      onClick={() => void applyPatches(segmentPatches)}
                    >
                      应用全部到转写
                    </Button>
                  </>
                ) : null}
                {suggestedText ? (
                  <>
                    <div className="max-h-24 overflow-y-auto text-xs whitespace-pre-wrap text-foreground/90">
                      {suggestedText}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{context.applyHint}</p>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 w-full rounded-2xl"
                      onClick={() => applySingle(suggestedText)}
                    >
                      应用建议到转写
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}

            {/* 底栏：模式 + 输入 + 发送，始终可见 */}
            <div className="shrink-0 space-y-2 border-t border-border/60 bg-background p-3">
              <div className="flex flex-wrap gap-1.5">
                {(
                  ["rewrite_annotation", "summarize_segment", "summarize_transcript", "custom"] as const
                ).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    variant={mode === k ? "default" : "outline"}
                    size="sm"
                    className="h-7 rounded-2xl px-2 text-[11px]"
                    onClick={() => applyMode(k)}
                    disabled={loading}
                  >
                    {MODE_PRESETS[k].label}
                  </Button>
                ))}
              </div>

              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={2}
                className="min-h-[56px] resize-none rounded-2xl border-border/60 bg-background/40 text-sm"
                placeholder={MODE_PRESETS[mode].placeholder}
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />

              <div className="flex items-center gap-2">
                <p className="flex-1 text-[10px] leading-snug text-muted-foreground">
                  Enter 发送 · Shift+Enter 换行 · 改写会自动写入
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void submit()}
                  disabled={loading || !input.trim()}
                  className="shrink-0 rounded-2xl"
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                      生成中
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5" />
                      发送
                      <Send className="h-3.5 w-3.5" />
                    </span>
                  )}
                </Button>
              </div>

              {error?.includes("Missing QIANWEN_API_KEY") ? (
                <div className="space-y-2 rounded-2xl border border-border/60 bg-background/30 p-2">
                  <Input
                    value={localApiKey}
                    onChange={(e) => setLocalApiKey(e.target.value)}
                    placeholder="粘贴 QIANWEN_API_KEY"
                    className="h-8 rounded-xl text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-full rounded-xl"
                    onClick={() => {
                      try {
                        localStorage.setItem("alpha.qianwen.apiKey", localApiKey.trim());
                        toast({ title: "已保存 Key" });
                      } catch {
                        toast({ title: "保存失败", variant: "destructive" });
                      }
                    }}
                  >
                    保存到本地
                  </Button>
                </div>
              ) : null}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ErrorBoundary>
  );
}
