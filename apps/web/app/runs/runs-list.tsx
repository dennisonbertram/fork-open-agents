"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GitHubRepositoryCombobox } from "@/components/github-repository-combobox";
import { Button } from "@/components/ui/button";
import { formatRunTimestamp } from "@/lib/date/format-run-timestamp";
import { cn } from "@/lib/utils";
import type { RunsListResponse } from "@/lib/runs/list";
import type { NormalizedAutomationRun } from "@/lib/runs/types";
import { fetchRunsWithTimeout, useRunsList } from "./use-runs-list";

const views = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "attention", label: "Needs attention" },
  { id: "completed", label: "Completed" },
] as const;

function hrefWith(
  current: string,
  changes: Record<string, string | null>,
): string {
  const params = new URLSearchParams(current);
  params.delete("cursor");
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const search = params.toString();
  return search ? `/runs?${search}` : "/runs";
}

function formatTimestamp(value: string): string {
  return formatRunTimestamp(value);
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function RunDimensions({ run }: { run: NormalizedAutomationRun }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="rounded border border-border bg-muted/30 px-1.5 py-0.5 font-medium">
        {titleCase(run.state)}
      </span>
      {run.outcome ? (
        <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
          {titleCase(run.outcome)}
        </span>
      ) : null}
      {run.health !== "ok" ? (
        <span
          className={cn(
            "rounded border px-1.5 py-0.5 font-medium",
            run.health === "needs_attention"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
          )}
        >
          {titleCase(run.health)}
        </span>
      ) : null}
    </div>
  );
}

function RunRow({
  run,
  searchParams,
}: {
  run: NormalizedAutomationRun;
  searchParams: string;
}) {
  const repoHref = run.repository
    ? hrefWith(searchParams, {
        repoOwner: run.repository.owner,
        repoName: run.repository.name,
      })
    : null;
  const automationHref = run.automation
    ? hrefWith(searchParams, {
        automationSource: run.automation.source,
        automationId: run.automation.sourceId,
      })
    : null;
  const triggerHref =
    run.trigger.source !== "unknown" || run.trigger.kind || run.trigger.id
      ? hrefWith(searchParams, {
          triggerSource:
            run.trigger.source === "unknown" ? null : run.trigger.source,
          triggerKind: run.trigger.kind,
          triggerId: run.trigger.id,
        })
      : null;
  const progress =
    run.progress.completedSteps === null
      ? null
      : run.progress.totalSteps === null
        ? `${run.progress.completedSteps} steps recorded`
        : `${run.progress.completedSteps} of ${run.progress.totalSteps} steps`;

  return (
    <article className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {run.source === "background_agent"
                ? "Background agent · Single-step"
                : "Agent loop · Multi-step"}
            </span>
            {automationHref ? (
              <Link
                href={automationHref}
                className="truncate text-sm font-semibold hover:underline"
              >
                {run.automationName}
              </Link>
            ) : (
              <span className="truncate text-sm font-semibold">
                {run.automationName}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {repoHref && run.repository ? (
              <Link href={repoHref} className="font-mono hover:text-foreground">
                {run.repository.owner}/{run.repository.name}
              </Link>
            ) : null}
            {triggerHref && run.trigger.kind ? (
              <Link
                href={triggerHref}
                className="font-mono hover:text-foreground"
              >
                {run.trigger.kind}
              </Link>
            ) : (
              <span className="font-mono">{run.trigger.source}</span>
            )}
            {progress ? <span className="tabular-nums">{progress}</span> : null}
          </div>
        </div>
        <RunDimensions run={run} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
          <span>Created {formatTimestamp(run.timestamps.createdAt)}</span>
          <span>Updated {formatTimestamp(run.timestamps.updatedAt)}</span>
          {run.timestamps.startedAt ? (
            <span>Started {formatTimestamp(run.timestamps.startedAt)}</span>
          ) : null}
          {run.timestamps.finishedAt ? (
            <span>Finished {formatTimestamp(run.timestamps.finishedAt)}</span>
          ) : null}
        </span>
        <Link
          href={run.detailUrl}
          className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
        >
          View evidence
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function LoadingState() {
  return (
    <div aria-label="Loading runs" className="space-y-3">
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          className="h-28 animate-pulse rounded-md border border-border bg-muted/30"
        />
      ))}
      <span className="sr-only">Loading runs</span>
    </div>
  );
}

export function RunsList({ searchParams }: { searchParams: string }) {
  const { data, error, isLoading, pollingPaused } = useRunsList(searchParams);
  const errorData = (error as { data?: RunsListResponse } | undefined)?.data;
  const response = data ?? errorData;
  const [extraPages, setExtraPages] = useState<RunsListResponse[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const items = useMemo(() => {
    const byId = new Map<string, NormalizedAutomationRun>();
    for (const item of [
      ...(response?.items ?? []),
      ...extraPages.flatMap((page) => page.items),
    ]) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return [...byId.values()];
  }, [extraPages, response?.items]);
  const lastPage = extraPages.at(-1);
  const nextCursor = lastPage ? lastPage.nextCursor : response?.nextCursor;
  const hasPartialFailure = response?.sourceStatus.some(
    (source) => source.status !== "ok",
  );
  const currentView = new URLSearchParams(searchParams).get("view") ?? "all";
  const currentParams = new URLSearchParams(searchParams);
  const [repoOwner, setRepoOwner] = useState(
    currentParams.get("repoOwner") ?? "",
  );
  const [repoName, setRepoName] = useState(currentParams.get("repoName") ?? "");
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    setRepoOwner(params.get("repoOwner") ?? "");
    setRepoName(params.get("repoName") ?? "");
  }, [searchParams]);
  const isFiltered = [...currentParams.entries()].some(
    ([key, value]) => value && !(key === "view" && value === "all"),
  );

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setPageError(null);
    try {
      const params = new URLSearchParams(searchParams);
      params.set("cursor", nextCursor);
      const page = await fetchRunsWithTimeout(`/api/runs?${params.toString()}`);
      setExtraPages((current) => [...current, page]);
    } catch {
      setPageError("Could not load more runs. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-5">
      <nav aria-label="Run status filters" className="flex flex-wrap gap-1">
        {views.map((view) => (
          <Link
            key={view.id}
            href={hrefWith(searchParams, { view: view.id })}
            aria-current={currentView === view.id ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              currentView === view.id
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {view.label}
          </Link>
        ))}
      </nav>

      <form
        action="/runs"
        className="grid gap-3 rounded-md border border-border p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <input type="hidden" name="view" value={currentView} />
        {["automationSource", "automationId", "triggerKind", "triggerId"].map(
          (name) => {
            const value = currentParams.get(name);
            return value ? (
              <input key={name} type="hidden" name={name} value={value} />
            ) : null;
          },
        )}
        <label className="space-y-1 text-xs font-medium sm:col-span-2">
          Repository
          <GitHubRepositoryCombobox
            value={{ owner: repoOwner, name: repoName }}
            allowFreeform
            onChange={(next) => {
              setRepoOwner(next.owner);
              setRepoName(next.name);
            }}
            placeholder="Search connected repositories"
          />
          <input type="hidden" name="repoOwner" value={repoOwner} />
          <input type="hidden" name="repoName" value={repoName} />
        </label>
        <label className="space-y-1 text-xs font-medium">
          Trigger source
          <select
            name="triggerSource"
            defaultValue={currentParams.get("triggerSource") ?? ""}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-normal"
          >
            <option value="">Any trigger</option>
            <option value="github">GitHub</option>
            <option value="schedule">Schedule</option>
            <option value="webhook">Webhook</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm">
            Apply filters
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link
              href={hrefWith(searchParams, {
                repoOwner: null,
                repoName: null,
                automationSource: null,
                automationId: null,
                triggerSource: null,
                triggerKind: null,
                triggerId: null,
              })}
            >
              Clear
            </Link>
          </Button>
        </div>
      </form>

      {pollingPaused ? (
        <p className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          Live updates paused after ten minutes. Refresh to continue.
        </p>
      ) : null}
      {hasPartialFailure && !response?.allSourcesFailed ? (
        <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <p className="text-pretty">
            Some run history is unavailable. Healthy sources remain visible;
            pagination is paused until all sources recover.
          </p>
        </div>
      ) : null}

      {isLoading && !response ? <LoadingState /> : null}
      {response?.allSourcesFailed ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-5"
        >
          <h2 className="text-balance text-sm font-semibold">
            Could not load run history
          </h2>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            Both run sources are unavailable. Retry without changing filters.
          </p>
        </div>
      ) : null}
      {!isLoading && !response && error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-5 text-sm"
        >
          Could not load run history.
        </div>
      ) : null}
      {response && !response.allSourcesFailed && items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center">
          <h2 className="text-balance text-sm font-semibold">
            {isFiltered ? "No runs found" : "No runs yet"}
          </h2>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            {isFiltered
              ? "Try another status or clear the repository and trigger filters."
              : "Create an Automation and run it before execution history appears here."}
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href={isFiltered ? "/runs" : "/automations"}>
              {isFiltered ? "Clear filters" : "Create an Automation"}
            </Link>
          </Button>
        </div>
      ) : null}
      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((run) => (
            <RunRow key={run.id} run={run} searchParams={searchParams} />
          ))}
        </div>
      ) : null}
      {pageError ? (
        <p role="alert" className="text-sm text-destructive">
          {pageError}
        </p>
      ) : null}
      {nextCursor ? (
        <Button
          type="button"
          variant="outline"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Loading more…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
