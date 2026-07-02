/**
 * Plain-language labels for the event-trigger kinds the dispatcher matches
 * (#762). Kept separate from trigger-label.ts (lib/background-agents) —
 * that module formats a full sentence including conditions; this is just the
 * short "kind" label used in the Triggers card's event-kind picker and list.
 */
import type { BackgroundAgentTriggerKind } from "@/lib/background-agents/types";

/** Event-trigger kinds selectable from a loop's Triggers card (webhook.error
 * and schedule.cron are handled separately — this list is event kinds only). */
export const LOOP_EVENT_TRIGGER_KINDS = [
  "github.pull_request",
  "github.issue",
  "github.deployment_status",
  "github.pull_request_review",
  "github.check_suite",
] as const satisfies readonly BackgroundAgentTriggerKind[];

export type LoopEventTriggerKind = (typeof LOOP_EVENT_TRIGGER_KINDS)[number];

export const LOOP_TRIGGER_KIND_LABELS: Record<LoopEventTriggerKind, string> = {
  "github.pull_request": "Pull request",
  "github.issue": "Issue",
  "github.deployment_status": "Deployment status",
  "github.pull_request_review": "Pull request review",
  "github.check_suite": "CI checks finishing",
};

export function getTriggerKindLabel(kind: string): string {
  if (kind === "schedule.cron") {
    return "Schedule";
  }
  return LOOP_TRIGGER_KIND_LABELS[kind as LoopEventTriggerKind] ?? kind;
}
