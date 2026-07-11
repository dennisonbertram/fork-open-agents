import { Clock3, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import type { BackgroundAgentRun } from "@/lib/db/schema";
import { DashboardStatusPill } from "./dashboard-status-pill";
import {
  INSTRUCTION_PREVIEW_CAP,
  SUMMARY_PREVIEW_CAP,
  truncatePreview,
} from "./truncate-preview";

// Type aliases for consumers of these window components.
export type DashboardRun = BackgroundAgentRun;
export type DashboardAgent = BackgroundAgentWithTriggers;

function formatDate(value: Date | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

// ---- Placeholder window (for PR, Issues, Actions) -------------------------

export function PlaceholderWindow({ label }: { label: string }) {
  return (
    <section
      aria-label={`${label} window`}
      className="rounded-md border border-border"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">{label}</h2>
      </div>
      <div className="p-8 text-center text-sm text-muted-foreground">
        {label} signals are not available yet in this slice.
      </div>
    </section>
  );
}

// ---- Overview window -------------------------------------------------------

type OverviewWindowProps = {
  agentCount: number;
  runCount: number;
  repoOwner: string;
  repoName: string;
};

export function OverviewWindow({
  agentCount,
  runCount,
  repoOwner,
  repoName,
}: OverviewWindowProps) {
  return (
    <section
      aria-label="Overview window"
      className="rounded-md border border-border"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Overview</h2>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-4">
        <div className="px-4 py-4">
          <p className="text-xs text-muted-foreground">Project agents</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {agentCount}
          </p>
        </div>
        <div className="px-4 py-4">
          <p className="text-xs text-muted-foreground">Runs</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{runCount}</p>
        </div>
        <div className="col-span-2 px-4 py-4">
          <p className="text-xs text-muted-foreground">Repository</p>
          <p className="mt-1 font-mono text-sm">
            {repoOwner}/{repoName}
          </p>
        </div>
      </div>
    </section>
  );
}

// ---- Agents window --------------------------------------------------------

type AgentsWindowProps = {
  agents: DashboardAgent[];
};

export function AgentsWindow({ agents }: AgentsWindowProps) {
  return (
    <section
      aria-label="Project agents window"
      className="rounded-md border border-border"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Project agents</h2>
      </div>
      {agents.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No agents configured for this repository.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{agent.name}</p>
                  <DashboardStatusPill status={agent.status} />
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {truncatePreview(agent.instructions, INSTRUCTION_PREVIEW_CAP)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {agent.triggers.map((trigger) => (
                  <span
                    key={trigger.id}
                    className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {trigger.kind}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---- Activity window -------------------------------------------------------

type ActivityWindowProps = {
  runs: DashboardRun[];
  repoOwner: string;
  repoName: string;
};

export function ActivityWindow({
  runs,
  repoOwner,
  repoName,
}: ActivityWindowProps) {
  const runsHref = `/runs?repoOwner=${encodeURIComponent(repoOwner)}&repoName=${encodeURIComponent(repoName)}`;
  return (
    <section
      aria-label="Activity window"
      className="rounded-md border border-border"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Activity</h2>
        <Link
          href={runsHref}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          View all runs
        </Link>
      </div>
      {runs.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No runs recorded for this repository.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {runs.map((run) => (
            <Link
              key={run.id}
              href={`/background-runs/${run.id}`}
              className="grid gap-3 px-4 py-3 transition-colors hover:bg-muted/30 md:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="truncate font-mono text-xs">
                    {run.triggerKind}
                  </p>
                  <DashboardStatusPill status={run.status} />
                </div>
                <p className="mt-1 truncate text-sm">
                  {truncatePreview(
                    run.payloadSummary.title ??
                      run.payloadSummary.message ??
                      run.externalId,
                    SUMMARY_PREVIEW_CAP,
                  )}
                </p>
                <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                  {run.sha ?? run.ref ?? run.branch ?? "no ref"}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatDate(run.createdAt)}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
