import type { Octokit } from "@octokit/rest";
import type { DashboardErrorKind } from "../repo-dashboard";

export type WorkflowRunTone =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "stale"
  | "startup_failure"
  | "in_progress"
  | "queued"
  | "unknown";

export type WorkflowRunDisplay = {
  label: string;
  tone: WorkflowRunTone;
  className: string;
};

export type WorkflowRunItem = {
  id: number;
  runNumber: number;
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  event: string;
  actor: string | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  durationMs: number | null;
  display: WorkflowRunDisplay;
};

export type WorkflowRunsResult = {
  totalCount: number;
  runs: WorkflowRunItem[];
};

export type WorkflowRunFilters = {
  branch?: string;
  event?: string;
  status?: string;
  perPage?: number;
};

type GitHubWorkflowRun = {
  id: number;
  run_number?: number;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  head_branch?: string | null;
  event?: string | null;
  actor?: { login?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
  html_url?: string | null;
};

type WorkflowRunStatusFilter =
  | "completed"
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "skipped"
  | "stale"
  | "success"
  | "timed_out"
  | "in_progress"
  | "queued"
  | "requested"
  | "waiting"
  | "pending";

function toWorkflowRunStatusFilter(
  value: string | undefined,
): WorkflowRunStatusFilter | undefined {
  const allowed = new Set<WorkflowRunStatusFilter>([
    "completed",
    "action_required",
    "cancelled",
    "failure",
    "neutral",
    "skipped",
    "stale",
    "success",
    "timed_out",
    "in_progress",
    "queued",
    "requested",
    "waiting",
    "pending",
  ]);
  return value && allowed.has(value as WorkflowRunStatusFilter)
    ? (value as WorkflowRunStatusFilter)
    : undefined;
}

export const workflowRunDisplayByState: Record<
  WorkflowRunTone,
  WorkflowRunDisplay
> = {
  success: {
    label: "Succeeded",
    tone: "success",
    className: "bg-emerald-500",
  },
  failure: {
    label: "Failed",
    tone: "failure",
    className: "bg-destructive",
  },
  cancelled: {
    label: "Cancelled",
    tone: "cancelled",
    className: "bg-muted-foreground",
  },
  skipped: {
    label: "Skipped",
    tone: "skipped",
    className: "bg-slate-400",
  },
  timed_out: {
    label: "Timed out",
    tone: "timed_out",
    className: "bg-orange-500",
  },
  action_required: {
    label: "Action required",
    tone: "action_required",
    className: "bg-amber-500",
  },
  stale: {
    label: "Stale",
    tone: "stale",
    className: "bg-zinc-500",
  },
  startup_failure: {
    label: "Startup failure",
    tone: "startup_failure",
    className: "bg-rose-500",
  },
  in_progress: {
    label: "In progress",
    tone: "in_progress",
    className: "bg-sky-500",
  },
  queued: {
    label: "Queued",
    tone: "queued",
    className: "bg-amber-500",
  },
  unknown: {
    label: "Unknown",
    tone: "unknown",
    className: "bg-muted-foreground",
  },
};

const completedConclusionTones = new Set<WorkflowRunTone>([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
  "startup_failure",
]);

export function getWorkflowRunDisplay(
  status: string | null | undefined,
  conclusion: string | null | undefined,
): WorkflowRunDisplay {
  if (status === "queued") {
    return workflowRunDisplayByState.queued;
  }
  if (status === "in_progress") {
    return workflowRunDisplayByState.in_progress;
  }
  if (
    status === "completed" &&
    conclusion &&
    completedConclusionTones.has(conclusion as WorkflowRunTone)
  ) {
    return workflowRunDisplayByState[conclusion as WorkflowRunTone];
  }
  return workflowRunDisplayByState.unknown;
}

function calculateDurationMs(
  createdAt: string | null | undefined,
  updatedAt: string | null | undefined,
): number | null {
  if (!createdAt || !updatedAt) {
    return null;
  }
  const started = Date.parse(createdAt);
  const ended = Date.parse(updatedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
    return null;
  }
  return ended - started;
}

function mapWorkflowRun(run: GitHubWorkflowRun): WorkflowRunItem {
  const status = run.status ?? "unknown";
  const conclusion = run.conclusion ?? null;
  return {
    id: run.id,
    runNumber: run.run_number ?? run.id,
    name: run.name ?? "Workflow",
    status,
    conclusion,
    branch: run.head_branch ?? "unknown",
    event: run.event ?? "unknown",
    actor: run.actor?.login ?? null,
    createdAt: run.created_at ?? "",
    updatedAt: run.updated_at ?? run.created_at ?? "",
    htmlUrl: run.html_url ?? "",
    durationMs: calculateDurationMs(run.created_at, run.updated_at),
    display: getWorkflowRunDisplay(status, conclusion),
  };
}

export async function listWorkflowRuns(
  octokit: Octokit,
  owner: string,
  repo: string,
  filters: WorkflowRunFilters = {},
): Promise<WorkflowRunsResult> {
  const response = await octokit.rest.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    branch: filters.branch,
    event: filters.event,
    status: toWorkflowRunStatusFilter(filters.status),
    per_page: filters.perPage ?? 30,
  });
  const data = response.data as {
    total_count?: number;
    workflow_runs?: GitHubWorkflowRun[];
  };

  return {
    totalCount: data.total_count ?? data.workflow_runs?.length ?? 0,
    runs: (data.workflow_runs ?? []).map(mapWorkflowRun),
  };
}

export function assertSharedDashboardErrorKind(
  errorKind: DashboardErrorKind,
): DashboardErrorKind {
  return errorKind;
}
