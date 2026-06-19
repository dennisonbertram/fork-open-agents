"use client";

import {
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ReadinessVerdict } from "@/components/ui/readiness-verdict";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";
import type { ActionsManagerReadinessVerdict } from "@/lib/github/actions-manager/readiness";
import type {
  WorkflowRunDisplay,
  WorkflowRunItem,
} from "@/lib/github/actions-manager/runs";
import type { WorkflowJobItem } from "@/lib/github/actions-manager/jobs";
import { RunActionsMenu } from "./run-actions-menu";
import type { WorkflowItem } from "@/lib/github/actions-manager/workflows";
import { DispatchDialog, type DispatchableWorkflow } from "./dispatch-dialog";

type ActionsDashboardClientProps = {
  owner: string;
  repo: string;
};

type ReadinessResponse =
  | { ok: true; readiness: ActionsManagerReadinessVerdict }
  | { ok: false; errorKind: string };

type RunsResponse =
  | { ok: true; totalCount: number; runs: WorkflowRunItem[] }
  | { ok: false; errorKind: string };

type JobsResponse =
  | { ok: true; totalCount: number; jobs: WorkflowJobItem[] }
  | { ok: false; errorKind: string };

type WorkflowsResponse =
  | { ok: true; totalCount: number; workflows: WorkflowItem[] }
  | { ok: false; errorKind: string };

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw Object.assign(new Error("Request failed"), {
      status: response.status,
      body,
    });
  }
  return body;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error("Request failed"), {
      status: response.status,
    });
  }
  return text;
}

function errorCopy(error: unknown): string {
  const body =
    error && typeof error === "object"
      ? (error as { body?: { errorKind?: string } }).body
      : undefined;
  const errorKind = body?.errorKind;
  if (errorKind === "github_rate_limited") {
    return "GitHub is rate-limiting requests - try again in a moment.";
  }
  if (errorKind === "app_no_actions_permission") {
    return "Re-authorize the GitHub App to view Actions.";
  }
  return "Couldn't load runs — try again.";
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return "";
  }
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function statusIcon(display: WorkflowRunDisplay) {
  switch (display.tone) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    case "failure":
    case "startup_failure":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "in_progress":
    case "queued":
      return <Loader2 className="h-4 w-4 animate-spin text-sky-600" />;
    default:
      return <Clock3 className="h-4 w-4 text-muted-foreground" />;
  }
}

function StatusDot({ display }: { display: WorkflowRunDisplay }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={display.label}
          className={cn("h-2.5 w-2.5 rounded-full", display.className)}
          role="img"
        />
      </TooltipTrigger>
      <TooltipContent>{display.label}</TooltipContent>
    </Tooltip>
  );
}

function RunSkeletons() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border p-3"
          key={index}
        >
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

function RunRow({
  run,
  onSelect,
  owner,
  repo,
  canWrite,
  onAction,
}: {
  run: WorkflowRunItem;
  onSelect: (run: WorkflowRunItem) => void;
  owner: string;
  repo: string;
  canWrite: boolean;
  onAction: () => void;
}) {
  const duration = formatDuration(run.durationMs);
  return (
    <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border border-border p-3">
      <StatusDot display={run.display} />
      <button
        type="button"
        onClick={() => onSelect(run)}
        className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium">
              {run.name} #{run.runNumber}
            </p>
            <Badge variant="secondary" className="shrink-0 gap-1">
              <GitBranch className="h-3 w-3" />
              {run.branch}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {run.actor ?? "GitHub"} / {run.event} /{" "}
            {formatRelativeTime(run.createdAt)}
            {duration ? ` / ${duration}` : ""}
          </p>
        </div>
      </button>
      <span className="shrink-0 text-xs text-muted-foreground">
        {run.display.label}
      </span>
      <RunActionsMenu
        run={run}
        owner={owner}
        repo={repo}
        canWrite={canWrite}
        onAction={onAction}
      />
    </div>
  );
}

function LogsPanel({
  owner,
  repo,
  selectedJob,
}: {
  owner: string;
  repo: string;
  selectedJob: WorkflowJobItem | null;
}) {
  const logUrl = selectedJob
    ? `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/jobs/${selectedJob.id}/logs`
    : null;
  const { data, error, isLoading } = useSWR<string>(logUrl, fetchText, {
    revalidateOnFocus: false,
  });

  if (!selectedJob) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Select a job to view logs.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-medium">{selectedJob.name}</h3>
        <Button
          aria-label="Copy logs"
          disabled={!data}
          onClick={() => data && void navigator.clipboard.writeText(data)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      <pre
        aria-live="polite"
        className="max-h-[48vh] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-5"
        role="log"
      >
        {isLoading
          ? "Loading logs..."
          : error
            ? "Could not load logs."
            : data || "No log output."}
      </pre>
    </div>
  );
}

function RunSheet({
  owner,
  repo,
  run,
  onOpenChange,
}: {
  owner: string;
  repo: string;
  run: WorkflowRunItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedJobId, setSelectedJobId] = React.useState<number | null>(null);
  const jobsUrl = run
    ? `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${run.id}/jobs`
    : null;
  const { data, error, isLoading } = useSWR<JobsResponse>(jobsUrl, fetchJson, {
    revalidateOnFocus: false,
  });
  const jobs = data?.ok ? data.jobs : [];
  const selectedJob =
    jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;

  React.useEffect(() => {
    setSelectedJobId(null);
  }, [run?.id]);

  return (
    <Sheet open={Boolean(run)} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{run?.name ?? "Workflow run"}</SheetTitle>
          <SheetDescription>
            {run
              ? `#${run.runNumber} / ${run.display.label} / ${run.branch}`
              : "Workflow run details"}
          </SheetDescription>
        </SheetHeader>
        {run?.htmlUrl ? (
          <Button asChild size="sm" variant="outline">
            <Link href={run.htmlUrl} rel="noopener noreferrer" target="_blank">
              <ExternalLink className="h-4 w-4" />
              GitHub
            </Link>
          </Button>
        ) : null}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Jobs</h3>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error || (data && !data.ok) ? (
            <p className="text-sm text-destructive">Could not load jobs.</p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs found.</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <button
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border border-border p-2 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selectedJob?.id === job.id && "bg-muted/50",
                  )}
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  type="button"
                >
                  {statusIcon(job.display)}
                  <span className="min-w-0 flex-1 truncate">{job.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {job.display.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <LogsPanel owner={owner} repo={repo} selectedJob={selectedJob} />
      </SheetContent>
    </Sheet>
  );
}

export function ActionsDashboardClient({
  owner,
  repo,
}: ActionsDashboardClientProps) {
  const [selectedRun, setSelectedRun] = React.useState<WorkflowRunItem | null>(
    null,
  );
  const baseUrl = `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions`;
  const readiness = useSWR<ReadinessResponse>(
    `${baseUrl}/readiness`,
    fetchJson,
    { revalidateOnFocus: false },
  );
  const isReady =
    readiness.data?.ok && readiness.data.readiness.status === "ready";
  const runs = useSWR<RunsResponse>(
    isReady ? `${baseUrl}/runs` : null,
    fetchJson,
    {
      refreshInterval: (latest) => {
        if (!latest?.ok) {
          return 0;
        }
        return latest.runs.some(
          (run) => run.status === "queued" || run.status === "in_progress",
        )
          ? 5000
          : 0;
      },
    },
  );

  const workflows = useSWR<WorkflowsResponse>(
    isReady ? `${baseUrl}/workflows` : null,
    fetchJson,
    { revalidateOnFocus: false },
  );

  const canWrite = isReady === true;

  const defaultBranch = React.useMemo(() => {
    if (runs.data?.ok && runs.data.runs.length > 0) {
      return runs.data.runs[0].branch || "main";
    }
    return "main";
  }, [runs.data]);

  const dispatchableWorkflows = React.useMemo((): DispatchableWorkflow[] => {
    if (!workflows.data?.ok) return [];
    return workflows.data.workflows
      .filter((w) => w.id > 0)
      .map((w) => ({
        id: w.id,
        name: w.name,
        path: w.path,
        defaultBranch,
      }));
  }, [workflows.data, defaultBranch]);

  function handleActionsMutation() {
    void runs.mutate();
  }

  const readinessVerdict: ActionsManagerReadinessVerdict = readiness.data?.ok
    ? readiness.data.readiness
    : {
        status: readiness.error ? "error" : "unavailable",
        headline: readiness.error
          ? "Could not verify Actions access"
          : "Checking Actions access",
        subtext: readiness.error
          ? "GitHub App permissions could not be checked right now."
          : "GitHub App permissions are being verified.",
      };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <ReadinessVerdict
          action={
            readinessVerdict.actionHref ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={readinessVerdict.actionHref}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="h-4 w-4" />
                  {readinessVerdict.actionLabel ?? "Open GitHub settings"}
                </Link>
              </Button>
            ) : null
          }
          headline={readinessVerdict.headline}
          onRefresh={() => {
            void readiness.mutate();
            void runs.mutate();
          }}
          refreshing={readiness.isValidating || runs.isValidating}
          status={readinessVerdict.status}
          subtext={readinessVerdict.subtext}
        />

        {isReady && (
          <DispatchDialog
            canWrite={canWrite}
            defaultBranch={defaultBranch}
            onDispatched={handleActionsMutation}
            owner={owner}
            repo={repo}
            workflows={dispatchableWorkflows}
          />
        )}

        {!isReady ? null : runs.isLoading ? (
          <RunSkeletons />
        ) : runs.error || (runs.data && !runs.data.ok) ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/[0.03] p-3">
            <p className="text-sm text-destructive">{errorCopy(runs.error)}</p>
            <Button
              aria-label="Retry loading runs"
              onClick={() => void runs.mutate()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        ) : runs.data?.ok && runs.data.runs.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No workflow runs yet for this repo.
          </div>
        ) : runs.data?.ok ? (
          <div className="space-y-2">
            {runs.data.runs.map((run) => (
              <RunRow
                key={run.id}
                onSelect={setSelectedRun}
                run={run}
                owner={owner}
                repo={repo}
                canWrite={canWrite}
                onAction={handleActionsMutation}
              />
            ))}
          </div>
        ) : null}

        <RunSheet
          onOpenChange={(open) => !open && setSelectedRun(null)}
          owner={owner}
          repo={repo}
          run={selectedRun}
        />
      </div>
    </TooltipProvider>
  );
}
