"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VoiceTimestamp } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Save, X, Play, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

const SPEAKER_PRESETS = ["Pilot", "ATC", "Dispatcher", "other"];
const SPEAKER_COLORS: Record<string, string> = {
  Pilot: "bg-blue-500",
  ATC: "bg-red-500",
  Dispatcher: "bg-green-500",
};

interface TextEditorProps {
  timestamp?: VoiceTimestamp;
  onSave?: (timestamp: VoiceTimestamp) => void;
  onCancel?: () => void;
  onPlay?: (startTime: number, endTime: number) => void;
}

const formSchema = z
  .object({
    text: z.string().trim().min(1, "请输入文本内容"),
    startTime: z
      .string()
      .trim()
      .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "开始时间必须是非负数字"),
    endTime: z
      .string()
      .trim()
      .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "结束时间必须是非负数字"),
    speaker: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    const s = Number(data.startTime);
    const e = Number(data.endTime);
    if (Number.isFinite(s) && Number.isFinite(e) && e <= s) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "结束时间必须大于开始时间",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

export function TextEditor({ timestamp, onSave, onCancel, onPlay }: TextEditorProps) {
  const [speakerDropdownOpen, setSpeakerDropdownOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const defaultValues = useMemo<FormValues>(
    () => ({
      text: timestamp?.text ?? "",
      startTime: (timestamp?.startTime ?? 0).toString(),
      endTime: (timestamp?.endTime ?? 0).toString(),
      speaker: timestamp?.speaker ?? "",
    }),
    [timestamp]
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isValid, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues,
  });

  useEffect(() => {
    reset(defaultValues);
    setSpeakerDropdownOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValues]);

  const text = watch("text");
  const startTime = watch("startTime");
  const endTime = watch("endTime");
  const speaker = watch("speaker") ?? "";

  const { ref: textFieldRef, ...textField } = register("text", {
    onChange: () => setTimeout(adjustTextareaHeight, 0),
  });

  const onSubmit = (values: FormValues) => {
    if (!timestamp) return;
    const updated: VoiceTimestamp = {
      ...timestamp,
      text: values.text,
      startTime: Number(values.startTime),
      endTime: Number(values.endTime),
      speaker: values.speaker?.trim() ? values.speaker.trim() : undefined,
    };
    onSave?.(updated);
  };

  // 时间微调函数
  const adjustTime = (
    currentTime: string,
    delta: number,
    isStartTime: boolean
  ) => {
    const current = parseFloat(currentTime) || 0;
    const newTime = Math.max(0, current + delta).toFixed(2);
    if (isStartTime) {
      setValue("startTime", newTime, { shouldValidate: true, shouldDirty: true });
    } else {
      setValue("endTime", newTime, { shouldValidate: true, shouldDirty: true });
    }
  };

  // 自动调整 Textarea 高度
  function adjustTextareaHeight() {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.max(
        80,
        textareaRef.current.scrollHeight
      ) + "px";
    }
  }

  // 字数统计
  const charCount = text.length;

  // 键盘快捷键处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!timestamp) return;
      
      // Ctrl/Cmd + Enter 保存
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void handleSubmit(onSubmit)();
      }
      // Esc 取消
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [timestamp, onCancel, handleSubmit]);

  // 初始化调整高度
  useEffect(() => {
    adjustTextareaHeight();
  }, []);

  if (!timestamp) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground text-center">
            选择一个时间戳进行编辑
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg border-primary/50">
      <CardHeader>
        <CardTitle>编辑标注</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 文本编辑区 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="text">文本内容</Label>
            <span className="text-xs text-muted-foreground">
              {charCount} 字符
            </span>
          </div>
          <div className="relative">
            <Textarea
              id="text"
              {...textField}
              ref={(el) => {
                textFieldRef(el);
                textareaRef.current = el;
              }}
              onInput={adjustTextareaHeight}
              placeholder="输入标注文本... (Ctrl+Enter 保存, Esc 取消)"
              className="resize-none min-h-[80px]"
            />
            {errors.text?.message ? (
              <div className="text-xs text-destructive mt-1">{errors.text.message}</div>
            ) : null}
            <div className="absolute bottom-2 right-2 text-xs text-muted-foreground pointer-events-none">
              {text.length > 0 && "💾 Ctrl+Enter"}
            </div>
          </div>
        </div>

        {/* 时间微调区 */}
        <div className="grid grid-cols-2 gap-4">
          {/* 开始时间 */}
          <div className="space-y-2">
            <Label htmlFor="startTime">开始时间 (秒)</Label>
            <div className="flex gap-1">
              <div className="flex-1 flex items-center gap-1">
                <Input
                  id="startTime"
                  type="number"
                  {...register("startTime")}
                  step="0.01"
                  className="flex-1"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjustTime(startTime, 0.1, true)}
                  title="增加 0.1s"
                  className="h-5 p-0 w-5"
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjustTime(startTime, -0.1, true)}
                  title="减少 0.1s"
                  className="h-5 p-0 w-5"
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
            </div>
            {errors.startTime?.message ? (
              <div className="text-xs text-destructive">{errors.startTime.message}</div>
            ) : null}
            <div className="flex gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => adjustTime(startTime, -1, true)}
                className="flex-1 py-1 h-auto text-xs"
              >
                -1s
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => adjustTime(startTime, 1, true)}
                className="flex-1 py-1 h-auto text-xs"
              >
                +1s
              </Button>
            </div>
          </div>

          {/* 结束时间 */}
          <div className="space-y-2">
            <Label htmlFor="endTime">结束时间 (秒)</Label>
            <div className="flex gap-1">
              <div className="flex-1 flex items-center gap-1">
                <Input
                  id="endTime"
                  type="number"
                  {...register("endTime")}
                  step="0.01"
                  className="flex-1"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjustTime(endTime, 0.1, false)}
                  title="增加 0.1s"
                  className="h-5 p-0 w-5"
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjustTime(endTime, -0.1, false)}
                  title="减少 0.1s"
                  className="h-5 p-0 w-5"
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
            </div>
            {errors.endTime?.message ? (
              <div className="text-xs text-destructive">{errors.endTime.message}</div>
            ) : null}
            <div className="flex gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => adjustTime(endTime, -1, false)}
                className="flex-1 py-1 h-auto text-xs"
              >
                -1s
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => adjustTime(endTime, 1, false)}
                className="flex-1 py-1 h-auto text-xs"
              >
                +1s
              </Button>
            </div>
          </div>
        </div>

        {/* 播放按钮 */}
        {onPlay && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() =>
              onPlay?.(parseFloat(startTime) || 0, parseFloat(endTime) || 0)
            }
          >
            <Play className="h-4 w-4 mr-2" />
            播放此段音频
          </Button>
        )}

        {/* 说话人选择 */}
        <div className="space-y-2">
          <Label>说话人 (可选)</Label>
          <div className="relative">
            <div
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm cursor-pointer hover:bg-accent"
              onClick={() => setSpeakerDropdownOpen(!speakerDropdownOpen)}
            >
              {speaker ? (
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      SPEAKER_COLORS[speaker] || "bg-gray-500"
                    )}
                  />
                  {speaker}
                </div>
              ) : (
                <span className="text-muted-foreground">
                  选择或输入说话人...
                </span>
              )}
            </div>

            {/* 下拉菜单 */}
            {speakerDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-input rounded-md shadow-md z-50">
                {/* 预设选项 */}
                {SPEAKER_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      setValue("speaker", preset, { shouldDirty: true });
                      setSpeakerDropdownOpen(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-accent border-b last:border-b-0 flex items-center gap-2 text-sm"
                  >
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        SPEAKER_COLORS[preset] || "bg-gray-500"
                      )}
                    />
                    {preset}
                  </button>
                ))}
                
                {/* 自定义输入 */}
                <div className="px-3 py-2 border-t">
                  <Input
                    type="text"
                    placeholder="输入自定义说话人..."
                    value={speaker}
                    onChange={(e) => setValue("speaker", e.target.value, { shouldDirty: true })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setSpeakerDropdownOpen(false);
                      }
                    }}
                    className="text-sm h-8"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            )}
          </div>
          
          {/* 说话人颜色提示 */}
          {speaker && SPEAKER_COLORS[speaker] && (
            <div className="text-xs text-muted-foreground">
              已应用 {speaker} 的配色
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 justify-end pt-2 border-t">
          <Button variant="outline" onClick={onCancel}>
            <X className="h-4 w-4 mr-2" />
            取消 (ESC)
          </Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={!isValid || isSubmitting}>
            <Save className="h-4 w-4 mr-2" />
            保存 (Ctrl+Enter)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
