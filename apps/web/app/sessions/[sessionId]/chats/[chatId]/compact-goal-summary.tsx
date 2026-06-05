"use client";

import { cn } from "@/lib/utils";
import type { WorkflowGoalJson } from "./hooks/use-session-observability";

// ---------------------------------------------------------------------------
// Status colour mapping (subset — covers the active-goal statuses most useful
// in the compact chat header context)
// ---------------------------------------------------------------------------

const compactStatusClassName: Record<string, string> = {
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
};

const fallbackStatusClassName =
  "border-border bg-muted/40 text-muted-foreground";

// ---------------------------------------------------------------------------
// Pick the most relevant goal to surface in the compact view
// Preference: blocked/awaiting_input > running > most-recent
// ---------------------------------------------------------------------------

function pickActiveGoal(
  goals: WorkflowGoalJson[],
): WorkflowGoalJson | undefined {
  if (goals.length === 0) {
    return undefined;
  }
  const attention = goals.find(
    (g) => g.status === "blocked" || g.status === "awaiting_input",
  );
  if (attention) {
    return attention;
  }
  const running = goals.find((g) => g.status === "running");
  if (running) {
    return running;
  }
  return goals[goals.length - 1];
}

// ---------------------------------------------------------------------------
// PUBLIC COMPONENT — mount in session-chat-content header area
// ---------------------------------------------------------------------------

/**
 * CompactGoalSummary
 *
 * A small read-only chip that surfaces the most-relevant active goal's
 * objective (truncated) and a status chip in the chat header. Renders nothing
 * when goals is empty. Read-only — no mutation controls.
 */
export function CompactGoalSummary({ goals }: { goals: WorkflowGoalJson[] }) {
  const goal = pickActiveGoal(goals);

  if (!goal) {
    return null;
  }

  return (
    <span
      className="hidden max-w-[180px] items-center gap-1 truncate rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground sm:inline-flex"
      title={goal.objective}
    >
      <span className="min-w-0 truncate">{goal.objective}</span>
      <span
        className={cn(
          "inline-flex h-4 shrink-0 items-center rounded-full border px-1 text-[9px] font-medium",
          compactStatusClassName[goal.status] ?? fallbackStatusClassName,
        )}
      >
        {goal.status.replaceAll("_", " ")}
      </span>
    </span>
  );
}
