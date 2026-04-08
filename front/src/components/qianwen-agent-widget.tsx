"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { VoiceTimestamp } from "@/types";
import { cn } from "@/lib/utils";

type AgentMode = "rewrite_annotation" | "summarize_segment" | "custom";

type AgentResponse = {
  ok: boolean;
  reply?: string;
  suggestedText?: string;
  error?: string;
  debug?: any;
};

type ChatMsg = { id: string; role: "user" | "assistant"; content: string };

export function QianwenAgentWidget({
  audioId,
  currentTime,
  selectedAircraft,
  selectedTimestamp,
  onApplySuggestedText,
  className,
}: {
  audioId: string;
  currentTime: number;
  selectedAircraft?: string;
  selectedTimestamp: VoiceTimestamp | null;
  onApplySuggestedText: (text: string) => void;
  className?: string;
}) {
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AgentMode>("rewrite_annotation");
  const [input, setInput] = useState("请把当前时间戳内容改写成更像真实 ATC 逐字稿，并给出 suggestedText（只输出 transcript 文本）。");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localApiKey, setLocalApiKey] = useState<string>("");
  const [lastDebug, setLastDebug] = useState<any>(null);

  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [suggestedText, setSuggestedText] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("alpha.qianwen.apiKey");
      if (raw) setLocalApiKey(raw);
    } catch {
      // ignore
    }
  }, []);

  const context = useMemo(() => {
    const ts = selectedTimestamp;
    const tsText = ts ? ts.text : "";
    const tsRange = ts ? `${ts.startTime.toFixed(1)}-${ts.endTime.toFixed(1)}s` : "N/A";
    const ac = selectedAircraft ?? "N/A";
    return {
      tsRange,
      tsText,
      ac,
    };
  }, [selectedAircraft, selectedTimestamp]);

  const submit = useCallback(async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    setSuggestedText(null);
    setLastDebug(null);

    const userMsg: ChatMsg = {
      id: `${Date.now()}-u`,
      role: "user",
      content: input.trim(),
    };
    setChat((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/qianwen/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(localApiKey.trim() ? { "x-qianwen-api-key": localApiKey.trim() } : {}),
        },
        body: JSON.stringify({
          mode,
          userCommand: input.trim(),
          audio: { id: audioId },
          currentTime,
          selectedAircraft,
          selectedTimestamp,
          transcriptText: selectedTimestamp?.text ?? "",
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
            ? ` (debug: headerPresent=${String(data.debug.headerPresent)} headerLength=${String(data.debug.headerLength)} envFileExists=${String(data.debug.envFileExists)})`
            : "";
        const msg = (data.error || `Agent request failed (${res.status})`) + debugTail;
        setError(msg);
        toast({ title: "智能体调用失败", description: msg, variant: "destructive" });
        return;
      }

      const assistantMsg: ChatMsg = {
        id: `${Date.now()}-a`,
        role: "assistant",
        content: data.reply || "",
      };
      setChat((prev) => [...prev, assistantMsg]);
      if (data.suggestedText) setSuggestedText(data.suggestedText);

      if (data.reply) toast({ title: "已生成建议", description: "可选择应用 suggestedText" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      toast({ title: "智能体异常", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [audioId, input, currentTime, mode, onApplySuggestedText, selectedAircraft, selectedTimestamp, toast]);

  const apply = useCallback(() => {
    if (!suggestedText) return;
    if (!selectedTimestamp) {
      toast({ title: "未选择时间戳", description: "请先在左侧点一个时间戳再应用建议。", variant: "destructive" });
      return;
    }
    onApplySuggestedText(suggestedText);
    setOpen(false);
  }, [onApplySuggestedText, selectedTimestamp, suggestedText, toast]);

  return (
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
        <DialogPrimitive.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <DialogPrimitive.Content
          className="fixed right-3 top-20 z-50 w-[420px] max-w-[calc(100vw-24px)] rounded-3xl border border-border/70 bg-background shadow-2xl"
          aria-describedby="qianwen-agent-desc"
        >
          <DialogPrimitive.Title className="sr-only">千问智能体（A-4）</DialogPrimitive.Title>
          <DialogPrimitive.Description id="qianwen-agent-desc" className="sr-only">
            千问智能体对话窗口，用于生成 ATC 转写建议，可返回 suggestedText 并一键应用到当前时间戳。
          </DialogPrimitive.Description>
          <div className="p-4 border-b border-border/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <div className="space-y-0.5">
                <div className="text-sm font-semibold">千问智能体（A-4）</div>
                <div className="text-xs text-muted-foreground">
                  TS {context.tsRange} · AC {context.ac}
                </div>
              </div>
            </div>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon" className="rounded-xl">
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
            {chat.length === 0 ? (
              <div className="text-xs text-muted-foreground leading-relaxed">
                点击发送后，智能体会基于你当前选中的时间戳文本给出建议。若返回了 <code className="text-primary">suggestedText</code>，你可以一键应用到当前时间戳。
              </div>
            ) : null}

            {chat.map((m) => (
              <div key={m.id} className={cn("rounded-2xl border p-3", m.role === "user" ? "bg-background/40 border-border/70" : "bg-background/20 border-border/60")}>
                <div className="text-[11px] text-muted-foreground mb-1">{m.role === "user" ? "你" : "智能体"}</div>
                <div className="text-sm whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}

            {suggestedText ? (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
                <div className="text-xs text-primary font-semibold mb-2">suggestedText（可应用）</div>
                <div className="text-sm whitespace-pre-wrap">{suggestedText}</div>
                <div className="mt-3">
                  <Button type="button" onClick={apply} className="w-full rounded-2xl">
                    应用到当前时间戳
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-red-700 text-sm">
                {error}
              </div>
            ) : null}

            {lastDebug ? (
              <div className="rounded-2xl border border-border/60 bg-background/20 px-3 py-2 text-xs text-muted-foreground">
                debug: {JSON.stringify(lastDebug)}
              </div>
            ) : null}

            {error?.includes("Missing QIANWEN_API_KEY") ? (
              <div className="rounded-2xl border border-border/60 bg-background/30 p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  你的服务端环境变量目前读取不到 Key（中文路径/编码问题常见）。你可以在这里临时填入 Key（仅保存在浏览器本地，不会提交到仓库）。
                </div>
                <Input
                  value={localApiKey}
                  onChange={(e) => setLocalApiKey(e.target.value)}
                  placeholder="粘贴 QIANWEN_API_KEY（sk-...）"
                  className="rounded-2xl"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-2xl"
                    onClick={() => {
                      try {
                        localStorage.setItem("alpha.qianwen.apiKey", localApiKey.trim());
                        toast({ title: "已保存", description: "Key 已保存到浏览器本地（localStorage）。" });
                      } catch {
                        toast({ title: "保存失败", description: "无法写入 localStorage。", variant: "destructive" });
                      }
                    }}
                    disabled={!localApiKey.trim()}
                  >
                    保存到本地
                  </Button>
                  <Button
                    type="button"
                    className="rounded-2xl"
                    onClick={submit}
                    disabled={loading || !input.trim()}
                  >
                    重新发送
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="p-4 border-t border-border/60 space-y-2">
            <div className="flex items-center gap-2">
              {(["rewrite_annotation", "summarize_segment", "custom"] as const).map((k) => {
                const label = k === "rewrite_annotation" ? "改写" : k === "summarize_segment" ? "总结" : "自定义";
                const active = mode === k;
                return (
                  <Button
                    key={k}
                    type="button"
                    variant={active ? "default" : "outline"}
                    size="sm"
                    className="h-8 rounded-2xl"
                    onClick={() => setMode(k)}
                    disabled={loading}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>

            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              className="bg-background/40 border-border/60 focus:border-primary rounded-2xl"
              placeholder="输入给智能体的命令..."
              disabled={loading}
            />

            <div className="flex items-center gap-2">
              <div className="text-[11px] text-muted-foreground flex-1">
                提示：先在左侧选择时间戳，智能体建议会更精准。
              </div>
              <Button type="button" onClick={submit} disabled={loading || !input.trim()} className="rounded-2xl" aria-label="Send to agent">
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
                    生成中
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    发送
                  </span>
                )}
                <Send className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

