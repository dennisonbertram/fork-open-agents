"use client";

import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { WorkflowGoalJson } from "./hooks/use-session-observability";

// ---------------------------------------------------------------------------
// Status chip — reuses the same visual language as the rest of the panel
// ---------------------------------------------------------------------------

const goalStatusClassName: Record<string, string> = {
  draft: "border-muted bg-muted/50 text-muted-foreground",
  planned: "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  running:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  awaiting_input:
    "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  blocked: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  validating:
    "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  complete:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  canceled: "border-muted bg-muted/50 text-muted-foreground",
  archived: "border-muted bg-muted/50 text-muted-foreground",
};

const infoFallback = "border-border bg-muted/40 text-muted-foreground";

function GoalStatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium",
        goalStatusClassName[status] ?? infoFallback,
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Attention banner — shown for goals that need operator/user action
// ---------------------------------------------------------------------------

const ATTENTION_STATUSES = new Set(["blocked", "awaiting_input"]);

function NeedsAttentionBanner({
  blockedReason,
}: {
  blockedReason: string | null;
}) {
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-orange-500/30 bg-orange-500/10 px-2.5 py-2 text-xs text-orange-700 dark:text-orange-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">Needs attention</p>
        {blockedReason && (
          <p className="mt-0.5 text-[11px] text-orange-600/90 dark:text-orange-300/80">
            {blockedReason}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single goal card
// ---------------------------------------------------------------------------

function GoalCard({ goal }: { goal: WorkflowGoalJson }) {
  const showAttention = ATTENTION_STATUSES.has(goal.status);

  return (
    <div className="border-b border-border/60 px-3 py-3 last:border-b-0">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-medium">{goal.objective}</p>
        <GoalStatusChip status={goal.status} />
      </div>

      {/* Attention banner for blocked / awaiting_input */}
      {showAttention && (
        <div className="mt-2">
          <NeedsAttentionBanner blockedReason={goal.blockedReason} />
        </div>
      )}

      {/* Evidence refs */}
      {goal.evidenceRefs.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
            Evidence
          </p>
          <div className="flex flex-wrap gap-1">
            {goal.evidenceRefs.map((ref) => (
              <span
                key={ref}
                className="inline-flex items-center rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {ref}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Event timeline */}
      {goal.events.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
            Events
          </p>
          <ol className="space-y-1">
            {goal.events.map((event) => (
              <EventTimelineRow key={event.id} event={event} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single event row inside the timeline
// ---------------------------------------------------------------------------

function EventTimelineRow({
  event,
}: {
  event: WorkflowGoalJson["events"][number];
}) {
  return (
    <li className="flex items-start gap-1.5">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[9px] font-medium text-muted-foreground">
        {event.sequence}
      </span>
      <div className="min-w-0">
        <p className="truncate font-mono text-[10px] text-foreground">
          {event.eventType}
        </p>
        <p className="line-clamp-2 text-[10px] text-muted-foreground">
          {event.summary}
        </p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper  (mirrors the Section helper in runtime-observability-panel)
// ---------------------------------------------------------------------------

function GoalSection({ children }: { children: ReactNode }) {
  return (
    <section className="border-b border-border">
      <div className="border-b border-border/70 bg-muted/20 px-3 py-2">
        <h3 className="text-xs font-medium text-foreground">Goal Ledger</h3>
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// PUBLIC PRESENTER — exported and tested; the panel mounts this directly
// ---------------------------------------------------------------------------

/**
 * GoalLedgerSection
 *
 * A pure presenter for rendering the goal ledger in the Runtime Inspector.
 * Receives already-fetched WorkflowGoalJson[] from the hook/panel; performs
 * no data fetching of its own. Read-only — no mutation controls.
 */
export function GoalLedgerSection({ goals }: { goals: WorkflowGoalJson[] }) {
  return (
    <GoalSection>
      {goals.length === 0 ? (
        <div className="px-3 py-4 text-xs text-muted-foreground">
          No goals have been recorded for this chat.
        </div>
      ) : (
        goals.map((goal) => <GoalCard key={goal.id} goal={goal} />)
      )}
    </GoalSection>
  );
}
