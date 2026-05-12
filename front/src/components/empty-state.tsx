"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  actionLabel = "重试",
  onAction,
  className,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <Card className={cn("rounded-3xl border-border/70 efb-panel efb-glow p-6", className)}>
      <div className="space-y-3">
        <div className="text-base font-semibold text-foreground">{title}</div>
        {description ? <div className="text-sm text-muted-foreground leading-relaxed">{description}</div> : null}
        {onAction ? (
          <div className="pt-1">
            <Button type="button" className="rounded-2xl" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
