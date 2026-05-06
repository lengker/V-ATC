"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FallbackRenderArgs = {
  error: Error;
  reset: () => void;
};

export type ErrorBoundaryProps = {
  children: React.ReactNode;
  /** Optional human-friendly label shown in the fallback UI. */
  name?: string;
  /** Render-prop fallback (takes priority over `fallback`). */
  fallbackRender?: (args: FallbackRenderArgs) => React.ReactNode;
  /** Static fallback UI. */
  fallback?: React.ReactNode;
  /** Called when an error is caught. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** Called when the boundary is reset. */
  onReset?: () => void;
  /** When these keys change, the boundary auto-resets. */
  resetKeys?: unknown[];
  className?: string;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    const { resetKeys } = this.props;
    if (!resetKeys || resetKeys.length === 0) return;

    const prev = prevProps.resetKeys;
    if (!prev || prev.length !== resetKeys.length) return;

    for (let i = 0; i < resetKeys.length; i += 1) {
      if (!Object.is(prev[i], resetKeys[i])) {
        if (this.state.error) this.reset();
        break;
      }
    }
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { fallbackRender, fallback, name, className } = this.props;

    if (fallbackRender) {
      return <>{fallbackRender({ error, reset: this.reset })}</>;
    }

    if (fallback) {
      return <>{fallback}</>;
    }

    const isDev = process.env.NODE_ENV !== "production";

    return (
      <Card className={cn("rounded-2xl border-border/60 bg-muted/20 p-3", className)}>
        <div className="space-y-2">
          <div className="text-sm font-semibold text-foreground">
            {name ? `${name} 出现错误` : "组件出现错误"}
          </div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            已阻止错误扩散到整页。你可以尝试重试；若持续出现，请刷新页面。
          </div>

          {isDev ? (
            <pre className="max-h-40 overflow-auto rounded-xl border border-border/60 bg-background/30 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap">
              {String(error?.stack || error?.message || error)}
            </pre>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="button" size="sm" className="rounded-xl" onClick={this.reset}>
              重试
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
            >
              刷新
            </Button>
          </div>
        </div>
      </Card>
    );
  }
}
