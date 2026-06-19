"use client";

import { cn } from "@/lib/utils";
import type { AgentLoop, AgentLoopRun } from "@/lib/db/schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(value: Date | string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

// ── Status pill ───────────────────────────────────────────────────────────────

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
        status === "active" || status === "succeeded" || status === "completed"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : status === "failed" || status === "cancelled"
            ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
            : status === "running" || status === "queued"
              ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

// ── Loop card ─────────────────────────────────────────────────────────────────

type LoopCardProps = {
  loop: AgentLoop;
  lastRun?: Pick<AgentLoopRun, "id" | "status" | "createdAt"> | null;
};

export function LoopCard({ loop, lastRun }: LoopCardProps) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{loop.name}</p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {loop.repoOwner}/{loop.repoName}
          </p>
        </div>
        <StatusPill status={loop.status} />
      </div>
      {lastRun && (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Last run:</span>
          <StatusPill status={lastRun.status} />
          <span>{formatDate(lastRun.createdAt)}</span>
        </div>
      )}
    </div>
  );
}
