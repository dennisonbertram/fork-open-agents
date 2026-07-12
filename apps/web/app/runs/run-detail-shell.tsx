import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  RunMetadataTable,
  type RunMetadataRow,
} from "@/components/run-metadata-table";
import { cn } from "@/lib/utils";
import type { RunDetailShellSummary } from "./run-detail-summary";

function words(value: string): string {
  return value.replaceAll("_", " ");
}

function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function statusClasses(summary: RunDetailShellSummary): string {
  if (summary.health === "needs_attention") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  if (summary.health === "warning") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (summary.state === "running" || summary.state === "queued") {
    return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  }
  return "border-border bg-muted/30 text-foreground";
}

function proofRows(summary: RunDetailShellSummary): RunMetadataRow[] {
  return [
    {
      key: "repository",
      label: "Repository",
      value: summary.repository
        ? `${summary.repository.owner}/${summary.repository.name}`
        : null,
    },
    {
      key: "automation-source",
      label: "Automation type",
      value:
        summary.source === "background_agent" ? "single-step" : "multi-step",
    },
    {
      key: "automation-id",
      label: "Automation ID",
      value: summary.automation.sourceId,
    },
    {
      key: "trigger",
      label: "Trigger",
      value: summary.trigger.kind
        ? `${summary.trigger.source} · ${summary.trigger.kind}`
        : summary.trigger.source,
    },
    {
      key: "trigger-id",
      label: "Trigger ID",
      value: summary.trigger.id,
    },
    {
      key: "evidence-source",
      label: "Evidence source",
      value: summary.evidence.source,
    },
    {
      key: "native-status",
      label: "Native status",
      value: summary.nativeStatus,
    },
    { key: "state", label: "State", value: words(summary.state) },
    {
      key: "outcome",
      label: "Outcome",
      value: summary.outcome ? words(summary.outcome) : null,
    },
    { key: "health", label: "Health", value: words(summary.health) },
    {
      key: "attention",
      label: "Attention",
      value:
        summary.attentionReasons.length > 0
          ? summary.attentionReasons.map(words).join(", ")
          : "none",
    },
    {
      key: "workflow-run",
      label: "Workflow Run",
      value: summary.evidence.workflowRunId,
      copyable: true,
    },
    {
      key: "request-id",
      label: "Request ID",
      value: summary.evidence.requestId,
      copyable: true,
    },
    {
      key: "sandbox",
      label: "Sandbox",
      value: summary.evidence.sandboxName,
    },
  ];
}

export function RunDetailShell({
  summary,
  children,
  headerAction,
  statusMessage,
}: {
  summary: RunDetailShellSummary;
  children: ReactNode;
  headerAction?: ReactNode;
  statusMessage?: ReactNode;
}) {
  const sourceLabel =
    summary.source === "background_agent"
      ? "Single-step Automation run"
      : "Multi-step Automation run";

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <header className="space-y-4 border-b border-border pb-4">
          <nav
            aria-label="Run breadcrumb"
            className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm"
          >
            <Link
              href="/runs"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              Runs
            </Link>
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            {summary.repository ? (
              <>
                {summary.repository.href ? (
                  <Link
                    href={summary.repository.href}
                    className="min-w-0 truncate font-mono text-muted-foreground hover:text-foreground"
                  >
                    {summary.repository.owner}/{summary.repository.name}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate font-mono text-muted-foreground">
                    {summary.repository.owner}/{summary.repository.name}
                  </span>
                )}
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              </>
            ) : null}
            {summary.automation.href ? (
              <Link
                href={summary.automation.href}
                className="min-w-0 truncate text-muted-foreground hover:text-foreground"
              >
                {summary.automation.name}
              </Link>
            ) : (
              <span className="min-w-0 truncate text-muted-foreground">
                {summary.automation.name}
              </span>
            )}
          </nav>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-muted-foreground">{sourceLabel}</p>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="min-w-0 truncate text-balance text-2xl font-semibold">
                  {summary.automation.name}
                </h1>
                <span
                  className={cn(
                    "inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium",
                    statusClasses(summary),
                  )}
                >
                  {words(summary.nativeStatus)}
                </span>
              </div>
              <p className="truncate font-mono text-sm text-muted-foreground">
                {summary.runId}
              </p>
              <p className="text-pretty text-xs text-muted-foreground">
                Trigger: {summary.trigger.source}
                {summary.trigger.kind ? ` · ${summary.trigger.kind}` : ""}
              </p>
              {statusMessage ? (
                <div role="status" className="text-pretty text-xs">
                  {statusMessage}
                </div>
              ) : null}
            </div>
            {headerAction}
          </div>

          <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground tabular-nums">
            <div className="flex gap-1.5">
              <dt>Created</dt>
              <dd>{formatTimestamp(summary.timestamps.createdAt)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Updated</dt>
              <dd>{formatTimestamp(summary.timestamps.updatedAt)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Started</dt>
              <dd>{formatTimestamp(summary.timestamps.startedAt) ?? "—"}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Finished</dt>
              <dd>{formatTimestamp(summary.timestamps.finishedAt) ?? "—"}</dd>
            </div>
          </dl>
        </header>

        <section aria-label="Run evidence summary">
          <RunMetadataTable rows={proofRows(summary)} />
        </section>

        {children}
      </div>
    </main>
  );
}
