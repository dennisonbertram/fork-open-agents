"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Globe,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  getComposioErrorKind,
  getComposioUserFacingError,
  redactComposioErrorMessage,
} from "@/lib/composio/errors";
import { cn } from "@/lib/utils";
import {
  type ManagedRuntimeCommandObservationJson,
  type SessionEventJson,
  useSessionObservability,
} from "./hooks/use-session-observability";

const statusClassName: Record<string, string> = {
  started: "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  starting:
    "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  running:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  succeeded:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  passed:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  completed:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  blocked: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  aborted: "border-muted bg-muted/50 text-muted-foreground",
  skipped: "border-muted bg-muted/50 text-muted-foreground",
  stopped: "border-muted bg-muted/50 text-muted-foreground",
  stale: "border-muted bg-muted/50 text-muted-foreground",
  info: "border-border bg-muted/40 text-muted-foreground",
};

function formatTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return "-";
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
        statusClassName[status] ?? statusClassName.info,
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border">
      <div className="border-b border-border/70 bg-muted/20 px-3 py-2">
        <h3 className="text-xs font-medium text-foreground">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2 px-3 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate">{value}</span>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-4 text-xs text-muted-foreground">{children}</div>
  );
}

function EventRow({ event }: { event: SessionEventJson }) {
  const summary = event.summary
    ? redactComposioErrorMessage(event.summary)
    : event.eventName;

  return (
    <div className="border-b border-border/60 px-3 py-2 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{summary}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {event.source} · {event.eventName}
          </p>
        </div>
        <StatusPill status={event.status} />
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
        <span>{formatTime(event.createdAt)}</span>
        {event.workflowRunId && (
          <span className="min-w-0 truncate font-mono">
            workflow {event.workflowRunId}
          </span>
        )}
      </div>
    </div>
  );
}

function normalizeEventSummary(event: SessionEventJson): string {
  return redactComposioErrorMessage(event.summary ?? event.eventName);
}

function getEventDedupeKey(event: SessionEventJson): string {
  return `${event.status}:${event.eventName}:${normalizeEventSummary(event)}`;
}

function collapseDuplicateEvents(events: SessionEventJson[]): Array<{
  event: SessionEventJson;
  count: number;
}> {
  const rows: Array<{ event: SessionEventJson; count: number }> = [];

  for (const event of events) {
    const last = rows.at(-1);
    if (last && getEventDedupeKey(last.event) === getEventDedupeKey(event)) {
      last.count += 1;
      continue;
    }
    rows.push({ event, count: 1 });
  }

  return rows;
}

function LikelyIssue({ events }: { events: SessionEventJson[] }) {
  const composioEvent = events.find(
    (event) =>
      event.eventName.startsWith("composio.") ||
      getComposioErrorKind(event.summary) !== "unknown",
  );
  const failedEvent = events.find((event) => event.status === "failed");
  const issueEvent = composioEvent ?? failedEvent;

  if (!issueEvent) {
    return null;
  }

  const isComposioIssue =
    issueEvent.eventName.startsWith("composio.") ||
    getComposioErrorKind(issueEvent.summary) !== "unknown";
  const summary = isComposioIssue
    ? getComposioUserFacingError(issueEvent.summary)
    : normalizeEventSummary(issueEvent);

  return (
    <Section title="Likely Issue">
      <div className="flex gap-2 px-3 py-3 text-xs">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">{summary}</p>
          <p className="text-muted-foreground">
            The detailed event timeline below keeps raw workflow evidence for
            debugging.
          </p>
        </div>
      </div>
    </Section>
  );
}

function CommandRow({
  command,
}: {
  command: ManagedRuntimeCommandObservationJson;
}) {
  const Icon =
    command.status === "passed"
      ? CheckCircle2
      : command.status === "failed"
        ? XCircle
        : Clock3;

  return (
    <div className="border-b border-border/60 px-3 py-2 last:border-b-0">
      <div className="flex items-start gap-2">
        <Icon
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0",
            command.status === "passed"
              ? "text-emerald-500"
              : command.status === "failed"
                ? "text-red-500"
                : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-medium">{command.label}</p>
            <StatusPill status={command.status} />
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {command.commandId} · {formatDuration(command.durationMs)}
            {command.exitCode !== undefined && command.exitCode !== null
              ? ` · exit ${command.exitCode}`
              : ""}
          </p>
          {command.summary && (
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
              {command.summary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function RuntimeObservabilityPanel({
  sessionId,
  chatId,
}: {
  sessionId: string;
  chatId: string;
}) {
  const { data, error, isLoading, mutate } = useSessionObservability({
    sessionId,
    chatId,
  });
  const latestWorkflow = data?.workflowRuns[0] ?? null;
  const latestProfileRun = data?.profileRuns[0] ?? null;
  const profileCommands = latestProfileRun
    ? [
        ...latestProfileRun.setupResults,
        ...latestProfileRun.verificationResults,
      ]
    : [];
  const visibleBrowserRuns = data?.browserRuns.slice(0, 5) ?? [];
  const visibleEvents = data?.events.slice(0, 40) ?? [];
  const visibleEventRows = collapseDuplicateEvents(visibleEvents);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="h-4 w-4 shrink-0 text-cyan-500" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">Runtime Inspector</p>
            <p className="truncate text-[10px] text-muted-foreground">
              Sandbox, profile, service, and browser evidence
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="Refresh runtime inspector"
          onClick={() => void mutate()}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
          />
        </Button>
      </div>

      {error ? (
        <EmptyState>Runtime observability is unavailable.</EmptyState>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section title="Session Runtime">
            <InfoRow
              label="Mode"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <StatusPill
                    status={
                      data?.runtimeMode === "managed_runtime"
                        ? "running"
                        : "info"
                    }
                  />
                  <span className="font-medium">
                    {data?.runtimeMode === "managed_runtime"
                      ? "Managed runtime"
                      : "Classic"}
                  </span>
                </span>
              }
            />
            <InfoRow
              label="Workflow"
              value={
                latestWorkflow ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <StatusPill status={latestWorkflow.status} />
                    <span className="truncate font-mono">
                      {latestWorkflow.id}
                    </span>
                  </span>
                ) : (
                  "No workflow recorded yet"
                )
              }
            />
            <InfoRow
              label="Sandbox"
              value={
                latestWorkflow?.sandboxName ??
                latestProfileRun?.sandboxName ??
                "-"
              }
            />
            <InfoRow
              label="Profile Run"
              value={latestProfileRun?.id ?? "No managed profile run yet"}
            />
          </Section>

          <LikelyIssue events={data?.events ?? []} />

          <Section title="Managed Profile">
            {latestProfileRun ? (
              <>
                <InfoRow
                  label="Profile"
                  value={`${latestProfileRun.profileDisplayName} · ${latestProfileRun.profileVersion}`}
                />
                <InfoRow
                  label="Status"
                  value={<StatusPill status={latestProfileRun.status} />}
                />
                <InfoRow
                  label="Expected"
                  value={latestProfileRun.expectedTools.join(", ") || "-"}
                />
                <InfoRow
                  label="Optional"
                  value={latestProfileRun.optionalTools.join(", ") || "-"}
                />
                {profileCommands.length > 0 ? (
                  <div className="border-t border-border/70">
                    {profileCommands.map((command) => (
                      <CommandRow
                        key={`${latestProfileRun.id}:${command.commandId}:${command.startedAt}`}
                        command={command}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState>
                    Profile setup has started but no command results are
                    recorded yet.
                  </EmptyState>
                )}
              </>
            ) : (
              <EmptyState>
                Managed runtime profile setup has not run for this chat. Select
                managed runtime before starting work to capture profile
                evidence.
              </EmptyState>
            )}
          </Section>

          <Section title="Services">
            {data?.services.length ? (
              data.services.map((service) => (
                <div
                  key={service.id}
                  className="border-b border-border/60 px-3 py-2 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                        <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {service.packagePath} · port {service.port}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {service.url ?? service.failureMessage ?? "No URL yet"}
                      </p>
                    </div>
                    <StatusPill status={service.status} />
                  </div>
                </div>
              ))
            ) : (
              <EmptyState>No managed services have been started.</EmptyState>
            )}
          </Section>

          <Section title="Browser Checks">
            {visibleBrowserRuns.length ? (
              <>
                {visibleBrowserRuns.map((run) => (
                  <div
                    key={run.id}
                    className="border-b border-border/60 px-3 py-2 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                          <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          {run.targetUrl}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                          {run.summary ?? "Browser check running"}
                        </p>
                      </div>
                      <StatusPill status={run.status} />
                    </div>
                  </div>
                ))}
                {(data?.browserRuns.length ?? 0) >
                  visibleBrowserRuns.length && (
                  <div className="px-3 py-2 text-[10px] text-muted-foreground">
                    Showing latest {visibleBrowserRuns.length} of{" "}
                    {data?.browserRuns.length} browser checks.
                  </div>
                )}
              </>
            ) : (
              <EmptyState>No browser checks have been captured.</EmptyState>
            )}
          </Section>

          <Section title="Event Timeline">
            {visibleEventRows.length ? (
              <>
                {visibleEventRows.map(({ event, count }) => (
                  <div key={event.id} className="relative">
                    <EventRow event={event} />
                    {count > 1 ? (
                      <span className="absolute top-2 right-3 rounded-full border border-border bg-background px-1.5 text-[10px] text-muted-foreground">
                        {count} retries
                      </span>
                    ) : null}
                  </div>
                ))}
                {(data?.events.length ?? 0) > visibleEvents.length && (
                  <div className="px-3 py-2 text-[10px] text-muted-foreground">
                    Showing latest {visibleEvents.length} of{" "}
                    {data?.events.length} events.
                  </div>
                )}
              </>
            ) : (
              <EmptyState>No runtime events have been recorded yet.</EmptyState>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

export default RuntimeObservabilityPanel;
