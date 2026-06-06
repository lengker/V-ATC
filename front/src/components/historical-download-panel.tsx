"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
function floorUtcSlot(d: Date): Date {
  const m = d.getUTCMinutes();
  const floored = m - (m % 30);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), floored, 0)
  );
}

function defaultUtcFields(): { date: string; time: string } {
  const slot = floorUtcSlot(new Date());
  const iso = slot.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function shiftUtcHours(hours: number): { date: string; time: string } {
  const slot = floorUtcSlot(new Date(Date.now() - hours * 3600 * 1000));
  const iso = slot.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function toUtcIso(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

export function HistoricalDownloadPanel({
  busy,
  onDownload,
}: {
  busy?: boolean;
  onDownload: (utcIso: string, options: { a3Asr: boolean }) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(defaultUtcFields);
  const [a3Asr, setA3Asr] = useState(true);

  const slotLabel = useMemo(() => {
    try {
      return toUtcIso(fields.date, fields.time).replace(".000Z", "Z");
    } catch {
      return "";
    }
  }, [fields]);

  const presets = [
    { label: "1 小时前", hours: 1 },
    { label: "6 小时前", hours: 6 },
    { label: "24 小时前", hours: 24 },
  ] as const;

  return (
    <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-background/40"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" />
          下载历史录音（LiveATC 归档）
        </span>
        <span className="text-[10px]">{open ? "收起" : "展开"}</span>
      </button>

      {open ? (
        <div className="mt-2 space-y-2 px-1 pb-1">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground mb-0.5 block">UTC 日期</label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={fields.date}
                onChange={(e) => setFields((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-0.5 block">UTC 时刻</label>
              <Input
                type="time"
                step={1800}
                className="h-8 text-xs"
                value={fields.time}
                onChange={(e) => setFields((f) => ({ ...f, time: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            对齐档位：<span className="text-foreground">{slotLabel || "—"}</span>
          </p>
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <Button
                key={p.hours}
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 rounded-full px-2 text-[10px]"
                disabled={busy}
                onClick={() => setFields(shiftUtcHours(p.hours))}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={a3Asr}
              onChange={(e) => setA3Asr(e.target.checked)}
              className="rounded border-border"
            />
            下载后自动 ASR 转写
          </label>
          <Button
            type="button"
            size="sm"
            className="w-full h-8 gap-1.5 rounded-full text-xs"
            disabled={busy || !fields.date || !fields.time}
            onClick={() => void onDownload(toUtcIso(fields.date, fields.time), { a3Asr })}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {busy ? "下载中…" : "下载并同步"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
