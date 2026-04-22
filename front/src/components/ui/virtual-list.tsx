"use client";

import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { useVirtualizer } from "@tanstack/react-virtual";

import { cn } from "@/lib/utils";
import { ScrollBar } from "@/components/ui/scroll-area";

export type VirtualListProps<T> = {
  items: T[];
  /** Height should be controlled via className (e.g. h-[600px]) or parent layout. */
  className?: string;
  viewportClassName?: string;
  /** Extra class for the inner "total size" container. */
  contentClassName?: string;
  /** Optional wrapper class applied to each item wrapper. */
  itemWrapperClassName?: string;
  /** Spacing between items, in px (e.g. 8 for Tailwind's gap-2). */
  gapPx?: number;
  overscan?: number;
  /** A good estimate improves scroll feel before measurement kicks in. */
  estimateSizePx?: number | ((index: number) => number);
  getKey?: (item: T, index: number) => React.Key;
  renderItem: (item: T, index: number) => React.ReactNode;
  empty?: React.ReactNode;
};

function resolveEstimate(
  estimate: VirtualListProps<unknown>["estimateSizePx"]
): (index: number) => number {
  if (typeof estimate === "function") return estimate;
  if (typeof estimate === "number" && Number.isFinite(estimate) && estimate > 0) {
    return () => estimate;
  }
  return () => 72;
}

export function VirtualList<T>({
  items,
  className,
  viewportClassName,
  contentClassName,
  itemWrapperClassName,
  gapPx = 0,
  overscan = 8,
  estimateSizePx,
  getKey,
  renderItem,
  empty,
}: VirtualListProps<T>) {
  const viewportRef = React.useRef<React.ElementRef<typeof ScrollAreaPrimitive.Viewport> | null>(null);
  const estimate = React.useMemo(() => resolveEstimate(estimateSizePx), [estimateSizePx]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => estimate(index) + gapPx,
    overscan,
    getItemKey: (index) => {
      const item = items[index];
      return getKey ? getKey(item, index) : index;
    },
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)}>
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn("h-full w-full rounded-[inherit]", viewportClassName)}
      >
        {items.length === 0 ? (
          empty ?? null
        ) : (
          <div
            className={contentClassName}
            style={{
              height: rowVirtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {virtualItems.map((v) => {
              const item = items[v.index];
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={rowVirtualizer.measureElement}
                  className={itemWrapperClassName}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${v.start}px)`,
                    paddingBottom: gapPx,
                  }}
                >
                  {renderItem(item, v.index)}
                </div>
              );
            })}
          </div>
        )}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
