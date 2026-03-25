"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadBlob } from "@/lib/exporters";
import { clearTimestampOverrides, exportTimestampOverrides } from "@/lib/local-annotation-store";
import {
  Activity,
  Map as MapIcon,
  Mic,
  Search,
  Settings,
  SlidersHorizontal,
  Download,
  LogOut,
  User,
  FileText,
} from "lucide-react";

export function EfbTopbar({
  title,
  subtitle,
  className,
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) {
  const { user, logout } = useAuth();
  return (
    <header className={cn("h-14 border-b border-border/70 efb-panel efb-glow", className)}>
      <div className="h-full px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight truncate">{title}</div>
            {subtitle ? (
              <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2 px-3 h-9 rounded-full border border-border/70 bg-background/30">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              className="bg-transparent outline-none text-sm w-72 placeholder:text-muted-foreground/70"
              placeholder="搜索航班 / 呼号 / 音频ID…"
            />
          </div>

          <Button variant="outline" size="icon" className="rounded-full bg-background/30">
            <MapIcon className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="rounded-full bg-background/30">
            <Mic className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="rounded-full bg-background/30">
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="rounded-full bg-background/30">
            <Settings className="h-4 w-4" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-full bg-background/30">
                <User className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="text-xs text-muted-foreground">当前用户</div>
                <div className="text-sm font-medium truncate">{user?.email ?? "未登录"}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  // 浏览器打印导出为 PDF（最稳妥，无额外依赖）
                  window.print();
                }}
              >
                <FileText className="h-4 w-4 mr-2" />
                导出审阅快照(PDF)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  // 通过 URL 上的 audioId 来定位缓存；没有就用 demo 的 id
                  const p = new URLSearchParams(window.location.search);
                  const audioId = p.get("audioId") || "demo-audio-001";
                  const payload = exportTimestampOverrides(audioId);
                  downloadBlob(
                    `alpha-local-overrides-${audioId}-${Date.now()}.json`,
                    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" })
                  );
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                导出本地缓存
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  const p = new URLSearchParams(window.location.search);
                  const audioId = p.get("audioId") || "demo-audio-001";
                  clearTimestampOverrides(audioId);
                  window.location.reload();
                }}
              >
                <SlidersHorizontal className="h-4 w-4 mr-2" />
                清空本地缓存
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent("alpha.export", { detail: { type: "json" } }));
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                导出 JSON
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent("alpha.export", { detail: { type: "csv" } }));
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                导出 CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  logout();
                  window.location.href = "/login";
                }}
              >
                <LogOut className="h-4 w-4 mr-2" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

