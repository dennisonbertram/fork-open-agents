"use client";

/**
 * node-error-badge.tsx — Red ring + error count overlay for the node card.
 *
 * Rendered by loop-nodes.tsx when the node has graph-validation errors.
 * The badge is absolutely positioned in the top-right corner of the node.
 * It clears live when errors are fixed (data flows from the store).
 */

import { cn } from "@/lib/utils";

type NodeErrorBadgeProps = {
  count: number;
  className?: string;
};

export function NodeErrorBadge({ count, className }: NodeErrorBadgeProps) {
  if (count === 0) return null;

  return (
    <div
      className={cn(
        "absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white shadow-sm ring-2 ring-background",
        className,
      )}
      aria-label={`${count} validation ${count === 1 ? "error" : "errors"}`}
    >
      {count > 9 ? "9+" : count}
    </div>
  );
}
