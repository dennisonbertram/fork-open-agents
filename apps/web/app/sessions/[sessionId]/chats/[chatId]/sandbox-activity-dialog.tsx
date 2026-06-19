"use client";

import {
  Activity,
  AlertTriangle,
  Box,
  Clock3,
  Server,
  Zap,
} from "lucide-react";
import type { SessionObservabilityResponse } from "./hooks/use-session-observability";
import {
  buildSandboxActivitySummary,
  type SandboxActivityStatusTone,
} from "./sandbox-activity";
import type { LifecycleTimingInfo } from "./session-chat-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type SandboxActivityDialogProps = {
  hasSandboxState: boolean;
  hasSnapshot: boolean;
  isSandboxActive: boolean;
  uiStatusLabel: string;
  lifecycleTiming: LifecycleTimingInfo;
  observabilityData?: SessionObservabilityResponse | null;
};

const toneClassName: Record<SandboxActivityStatusTone, string> = {
  active:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  busy: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  paused: "border-border bg-muted/50 text-muted-foreground",
  warning: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  offline: "border-border bg-muted/40 text-muted-foreground",
};

const dotClassName: Record<SandboxActivityStatusTone, string> = {
  active: "bg-emerald-500",
  busy: "bg-amber-500",
  paused: "bg-muted-foreground/60",
  warning: "bg-red-500",
  offline: "bg-muted-foreground/40",
};

function formatDateTime(value: number | null): string {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatLifecycleState(value: string | null): string {
  return value ? value.replaceAll("_", " ") : "untracked";
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2">
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 border-b border-border/60 py-2 text-xs last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground">{value}</span>
    </div>
  );
}

export function SandboxActivityDialog({
  hasSandboxState,
  hasSnapshot,
  isSandboxActive,
  uiStatusLabel,
  lifecycleTiming,
  observabilityData,
}: SandboxActivityDialogProps) {
  const summary = buildSandboxActivitySummary({
    hasSandboxState,
    hasSnapshot,
    isSandboxActive,
    uiStatusLabel,
    lifecycleTiming,
    observabilityData,
  });
  const triggerLabel = `Sandbox ${summary.label}. ${summary.currentActivity}`;
  const showDialog = hasSandboxState || hasSnapshot || summary.stats.events > 0;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Open sandbox activity. ${triggerLabel}`}
          className="h-8 gap-2 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground"
          disabled={!showDialog}
        >
          <span className="relative flex h-5 w-7 shrink-0 items-center">
            <span className="absolute left-0 grid h-5 w-5 place-items-center rounded-full border border-border bg-background">
              <Box className="h-3 w-3" />
            </span>
            <span
              className={cn(
                "absolute right-0 h-5 w-5 rounded-full border-2 border-background",
                dotClassName[summary.tone],
              )}
            />
          </span>
          <span className="hidden sm:inline">{summary.label}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(720px,calc(100vh-2rem))] overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4 text-cyan-500" />
                Sandbox activity
              </DialogTitle>
              <DialogDescription className="mt-1">
                {summary.description}
              </DialogDescription>
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium",
                toneClassName[summary.tone],
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  dotClassName[summary.tone],
                )}
              />
              {summary.label}
            </span>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(min(720px,100vh-2rem)-92px)] overflow-y-auto px-4 py-4">
          <section className="rounded-md border border-border bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              {summary.tone === "warning" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              ) : (
                <Activity className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium">{summary.currentActivity}</p>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {summary.sandboxName}
                </p>
              </div>
            </div>
          </section>

          <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Events" value={summary.stats.events} />
            <StatTile
              label="Running"
              value={summary.stats.runningEvents + summary.stats.runningWorkers}
            />
            <StatTile label="Services" value={summary.stats.activeServices} />
            <StatTile label="Tool uses" value={summary.stats.toolUses} />
          </section>

          <section className="mt-4 rounded-md border border-border px-3">
            <DetailRow
              label="Lifecycle"
              value={formatLifecycleState(summary.lifecycleState)}
            />
            <DetailRow
              label="Last activity"
              value={formatDateTime(summary.lastActivityAtMs)}
            />
            <DetailRow
              label="Hibernate after"
              value={formatDateTime(summary.hibernateAfterMs)}
            />
            <DetailRow
              label="Expires"
              value={formatDateTime(summary.sandboxExpiresAtMs)}
            />
            <DetailRow
              label="Recorded work"
              value={`${summary.stats.workflows} workflows, ${summary.stats.workers} workers, ${summary.stats.browserRuns} browser checks`}
            />
          </section>

          <section className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              Recent sandbox activity
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              {summary.recentEvents.length > 0 ? (
                summary.recentEvents.map((event) => (
                  <div
                    key={event.id}
                    className="border-b border-border/60 px-3 py-2 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">
                          {event.summary ?? event.eventName}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {event.source} · {event.eventName}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {event.status}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-3 py-4 text-xs text-muted-foreground">
                  No sandbox events have been recorded yet.
                </div>
              )}
            </div>
          </section>

          {summary.stats.failedEvents > 0 ? (
            <section className="mt-4 flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Recent sandbox-related events include failures or blockers. Open
                the Runtime Inspector for the full evidence stream.
              </p>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
