"use client";

import { useState } from "react";
import { VoiceTimestamp } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Save, X } from "lucide-react";

interface TextEditorProps {
  timestamp?: VoiceTimestamp;
  onSave?: (timestamp: VoiceTimestamp) => void;
  onCancel?: () => void;
}

export function TextEditor({ timestamp, onSave, onCancel }: TextEditorProps) {
  const [text, setText] = useState(timestamp?.text || "");
  const [startTime, setStartTime] = useState(
    timestamp?.startTime.toString() || "0"
  );
  const [endTime, setEndTime] = useState(
    timestamp?.endTime.toString() || "0"
  );
  const [speaker, setSpeaker] = useState(timestamp?.speaker || "");

  const handleSave = () => {
    if (!timestamp) return;

    const updated: VoiceTimestamp = {
      ...timestamp,
      text,
      startTime: parseFloat(startTime),
      endTime: parseFloat(endTime),
      speaker: speaker || undefined,
    };

    onSave?.(updated);
  };

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
    <Card>
      <CardHeader>
        <CardTitle>编辑标注</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="text">文本内容</Label>
          <Textarea
            id="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="输入标注文本..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="startTime">开始时间 (秒)</Label>
            <Input
              id="startTime"
              type="number"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              step="0.1"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endTime">结束时间 (秒)</Label>
            <Input
              id="endTime"
              type="number"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              step="0.1"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="speaker">说话人 (可选)</Label>
          <Input
            id="speaker"
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
            placeholder="例如: ATC, Pilot"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onCancel}>
            <X className="h-4 w-4 mr-2" />
            取消
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
