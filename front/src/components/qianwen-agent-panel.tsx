"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { VoiceTimestamp } from "@/types";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Wand2, Sparkles, CheckCircle2 } from "lucide-react";

type AgentMode = "rewrite_annotation" | "summarize_segment" | "custom";

type AgentResponse = {
  ok: boolean;
  reply?: string;
  suggestedText?: string;
  confidence?: number;
  keywords?: string[];
  notes?: string;
  error?: string;
};

export function QianwenAgentPanel({
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

  const selectedTranscript = selectedTimestamp?.text ?? "";
  const hasSelected = Boolean(selectedTimestamp);

  const [mode, setMode] = useState<AgentMode>("rewrite_annotation");
  const [command, setCommand] = useState(
    "请把当前时间戳的内容改写成更像真实 ATC 逐字稿的格式，并给出 suggestedText（只输出 transcript 文本，不要加入时间、说话人标签）。"
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reply, setReply] = useState<string>("");
  const [suggestedText, setSuggestedText] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | undefined>(undefined);
  const [keywords, setKeywords] = useState<string[] | undefined>(undefined);

  const contextSummary = useMemo(() => {
    const timeStr = `${currentTime.toFixed(1)}s`;
    const aircraft = selectedAircraft ? selectedAircraft : "N/A";
    return `Audio=${audioId} · Time=${timeStr} · Aircraft=${aircraft}`;
  }, [audioId, currentTime, selectedAircraft]);

  const quickCommands = useMemo(
    () => [
      {
        label: "生成标注建议",
        mode: "rewrite_annotation" as AgentMode,
        command:
          "请把当前时间戳的内容改写成更像真实 ATC 逐字稿的格式；如果需要修正口误/漏字，请给出 suggestedText（只输出 transcript 文本）。并给出 reply（简短解释）。",
      },
      {
        label: "总结当前时间段",
        mode: "summarize_segment" as AgentMode,
        command:
          "请总结当前时间戳文本的要点（reply），并给出是否值得进一步标注的建议；如果能给出更好的 suggestedText（更清晰、更标准的逐字稿），也请提供。",
      },
      {
        label: "ATC 逐字稿规范化",
        mode: "rewrite_annotation" as AgentMode,
        command:
          "把当前文本规范化：纠正语序、补全明显缺失的词（如果原文语义不确定就不要编造）；输出 suggestedText 为最终建议逐字稿。",
      },
    ],
    []
  );

  const submit = useCallback(async () => {
    if (!command.trim()) {
      setError("请输入命令内容");
      return;
    }
    if (!audioId) {
      setError("缺少 audioId");
      return;
    }

    setError(null);
    setLoading(true);
    setReply("");
    setSuggestedText(null);
    setConfidence(undefined);
    setKeywords(undefined);

    try {
      const res = await fetch("/api/qianwen/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          userCommand: command,
          audio: { id: audioId },
          currentTime,
          selectedAircraft,
          selectedTimestamp,
          transcriptText: selectedTranscript,
        }),
      });

      const data: AgentResponse = await res.json().catch(() => ({
        ok: false,
        error: "Invalid JSON response",
      }));

      if (!res.ok || !data.ok) {
        const msg = data.error || `Agent request failed (${res.status})`;
        setError(msg);
        toast({ title: "智能体调用失败", description: msg, variant: "destructive" });
        return;
      }

      setReply(data.reply ?? "");
      setSuggestedText(data.suggestedText ?? null);
      setConfidence(data.confidence);
      setKeywords(data.keywords);

      toast({ title: "智能体已生成", description: "已更新建议结果" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      toast({ title: "智能体异常", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [audioId, command, currentTime, mode, selectedAircraft, selectedTimestamp, selectedTranscript, toast]);

  const apply = useCallback(() => {
    if (!suggestedText) return;
    if (!hasSelected || !selectedTimestamp) {
      toast({
        title: "未选择时间戳",
        description: "请先在左侧选择一个时间戳再应用建议。",
        variant: "destructive",
      });
      return;
    }
    onApplySuggestedText(suggestedText);
  }, [hasSelected, onApplySuggestedText, selectedTimestamp, suggestedText, toast]);

  return (
    <Card className={cn("rounded-3xl border-border/70 efb-panel efb-glow h-full", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              千问智能体（A-4）
            </CardTitle>
            <div className="text-xs text-muted-foreground">{contextSummary}</div>
          </div>
          <div className="text-xs text-muted-foreground">
            {selectedTimestamp ? (
              <>
                TS: {selectedTimestamp.startTime.toFixed(1)}-{selectedTimestamp.endTime.toFixed(1)}s
              </>
            ) : (
              "未选中"
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {quickCommands.map((q) => (
            <Button
              key={q.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setMode(q.mode);
                setCommand(q.command);
              }}
              className="h-8 text-[11px] col-span-1"
              disabled={loading}
            >
              {q.label}
            </Button>
          ))}
        </div>

        <Textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          rows={3}
          className="bg-background/40 border-border/60 focus:border-primary"
          placeholder="输入你的智能体命令..."
        />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={submit}
            disabled={loading || !command.trim()}
            className="flex-1 rounded-2xl"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                生成中...
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                生成建议
              </>
            )}
          </Button>
          <div className="w-[86px]">
            <div className="text-[11px] text-muted-foreground mb-1">应用建议</div>
            <Button
              type="button"
              variant="secondary"
              disabled={!suggestedText || loading}
              onClick={apply}
              className="w-full h-10 rounded-2xl"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              应用
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-red-700 text-sm">
            {error}
          </div>
        ) : null}

        <div className="space-y-2 pt-1">
          <div className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
            <span>智能体回复</span>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/20 p-3 min-h-[80px] whitespace-pre-wrap text-sm text-foreground">
            {reply ? reply : <span className="text-muted-foreground">等待生成...</span>}
          </div>

          {suggestedText ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">suggestedText（可应用）</div>
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 min-h-[60px] whitespace-pre-wrap text-sm text-foreground">
                {suggestedText}
              </div>
              {typeof confidence === "number" ? (
                <div className="text-xs text-muted-foreground">
                  confidence: {Math.round(confidence * 100)}%
                </div>
              ) : null}
              {keywords?.length ? (
                <div className="text-xs text-muted-foreground">
                  keywords: {keywords.join(", ")}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {!hasSelected ? (
          <div className="text-xs text-muted-foreground">
            提示：先在左侧点一个时间戳，智能体会基于该片段文本给出更贴近标注的 suggestedText。
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

