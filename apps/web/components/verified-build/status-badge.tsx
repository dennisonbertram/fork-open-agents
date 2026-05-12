"use client";

import { cn } from "@/lib/utils";

const statusStyles: Record<string, string> = {
  accepted:
    "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  running: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  gated:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  pending:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approval_required:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  cancellation_requested:
    "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  cancelled: "border-muted-foreground/30 bg-muted text-muted-foreground",
  canceled: "border-muted-foreground/30 bg-muted text-muted-foreground",
  failed: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  completed:
    "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400",
  needs_review:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

function labelForStatus(status: string): string {
  return status.replaceAll("_", " ");
}

export function VerifiedBuildStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium capitalize leading-4",
        statusStyles[status] ??
          "border-border bg-muted/50 text-muted-foreground",
        className,
      )}
    >
      <span className="truncate">{labelForStatus(status)}</span>
    </span>
  );
}
