"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import type { ListAgentLoopsResponse } from "@/app/api/agent-loops/types";
import type { AgentLoop } from "@/lib/db/schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      errorKind?: string;
      message?: string;
    };
    throw Object.assign(new Error(body.message ?? "Request failed"), {
      status: res.status,
      errorKind: body.errorKind,
    });
  }
  return res.json() as Promise<T>;
}

function formatDate(value: string | Date | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
        status === "active"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : status === "paused" || status === "draft"
            ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

// ── Loop card ─────────────────────────────────────────────────────────────────

function LoopCard({ loop }: { loop: AgentLoop }) {
  return (
    <Link
      href={`/loops/${loop.id}`}
      className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-4 hover:border-border/80 hover:bg-muted/20 transition-colors"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{loop.name}</p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {loop.repoOwner}/{loop.repoName}
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Updated {formatDate(loop.updatedAt)}
        </p>
      </div>
      <StatusPill status={loop.status} />
    </Link>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function LoopSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-20 rounded-md border border-border bg-muted/30"
        />
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({
  createEnabled,
  newHref,
}: {
  createEnabled: boolean;
  newHref: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border p-12 text-center">
      <p className="text-sm font-medium text-muted-foreground">No loops yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Create a loop to automate multi-step agent workflows.
      </p>
      {createEnabled && (
        <Link
          href={newHref}
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted/20"
        >
          <Plus className="h-4 w-4" />
          New loop
        </Link>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type LoopsListProps = {
  /** When false, hides "New loop" affordances (set server-side from isAgentLoopsEnabled). Defaults to true for backward compatibility. */
  createEnabled?: boolean;
  /** When set, scopes the list to a single repository (both must be provided). */
  repoOwner?: string;
  repoName?: string;
};

export function LoopsList({
  createEnabled = true,
  repoOwner,
  repoName,
}: LoopsListProps) {
  const listUrl =
    repoOwner && repoName
      ? `/api/agent-loops?repoOwner=${encodeURIComponent(repoOwner)}&repoName=${encodeURIComponent(repoName)}`
      : "/api/agent-loops";
  const { data, error, isLoading } = useSWR<ListAgentLoopsResponse>(
    listUrl,
    fetchJson,
  );

  if (isLoading && !data) {
    return <LoopSkeleton />;
  }

  if (error) {
    const isFeatureDisabled =
      (error as { errorKind?: string }).errorKind === "feature_disabled";

    if (isFeatureDisabled) {
      return (
        <div className="rounded-md border border-border bg-muted/20 p-6 text-center">
          <p className="text-sm font-medium">Loops feature is disabled</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ask your workspace administrator to enable the loops feature flag.
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-md border border-red-500/25 bg-red-500/10 p-4">
        <p className="text-sm text-red-700 dark:text-red-300">
          Failed to load loops. {(error as Error).message}
        </p>
      </div>
    );
  }

  const loops = data?.loops ?? [];
  const newHref =
    repoOwner && repoName
      ? `/loops/new?repoOwner=${encodeURIComponent(repoOwner)}&repoName=${encodeURIComponent(repoName)}`
      : "/loops/new";

  if (loops.length === 0) {
    return <EmptyState createEnabled={createEnabled} newHref={newHref} />;
  }

  // Repo-scoped view: flat list. Global view: group by repo so it reads as a
  // cross-repo overview, with each group header linking into that repo's loops.
  const isRepoScoped = Boolean(repoOwner && repoName);
  if (isRepoScoped) {
    return (
      <div className="space-y-3">
        {loops.map((loop) => (
          <LoopCard key={loop.id} loop={loop} />
        ))}
      </div>
    );
  }

  const groups = new Map<string, AgentLoop[]>();
  for (const loop of loops) {
    const key = `${loop.repoOwner}/${loop.repoName}`;
    const list = groups.get(key) ?? [];
    list.push(loop);
    groups.set(key, list);
  }

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([repoKey, repoLoops]) => {
        const first = repoLoops[0];
        return (
          <div key={repoKey} className="space-y-2">
            <Link
              href={`/repos/${first?.repoOwner}/${first?.repoName}/loops`}
              className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              {repoKey}
            </Link>
            <div className="space-y-3">
              {repoLoops.map((loop) => (
                <LoopCard key={loop.id} loop={loop} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
