"use client";

import { cn } from "@/lib/utils";
import {
  Map as MapIcon,
  MessageSquareText,
  Radio,
  Settings,
  Waves,
} from "lucide-react";

const items = [
  { key: "map", label: "地图", Icon: MapIcon },
  { key: "transcripts", label: "转写", Icon: MessageSquareText },
  { key: "radio", label: "电台", Icon: Radio },
  { key: "audio", label: "音频", Icon: Waves },
  { key: "settings", label: "设置", Icon: Settings },
] as const;

export function EfbBottomNav({
  active = "transcripts",
  onChange,
  className,
}: {
  active?: (typeof items)[number]["key"];
  onChange?: (key: (typeof items)[number]["key"]) => void;
  className?: string;
}) {
  return (
    <nav className={cn("h-14 border-t border-border/70 efb-panel efb-glow", className)}>
      <div className="h-full max-w-5xl mx-auto px-4 grid grid-cols-5 gap-2">
        {items.map(({ key, label, Icon }) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              onClick={() => onChange?.(key)}
              className={cn(
                "h-full flex flex-col items-center justify-center gap-1 text-xs transition-colors",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "")} />
              <span className="leading-none">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

