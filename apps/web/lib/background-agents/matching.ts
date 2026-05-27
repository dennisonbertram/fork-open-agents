import type { BackgroundAgentTrigger } from "@/lib/db/schema";
import type { NormalizedBackgroundTriggerEvent } from "./types";

export function triggerMatchesEvent(
  trigger: Pick<BackgroundAgentTrigger, "conditions">,
  event: NormalizedBackgroundTriggerEvent,
): boolean {
  const conditions = trigger.conditions ?? {};

  if (
    conditions.actions?.length &&
    (!event.action || !conditions.actions.includes(event.action))
  ) {
    return false;
  }

  if (
    conditions.branches?.length &&
    (!event.branch || !conditions.branches.includes(event.branch))
  ) {
    return false;
  }

  if (conditions.labels?.length) {
    if (!event.labels?.length) {
      return false;
    }
    const labels = new Set(event.labels);
    if (!conditions.labels.some((label) => labels.has(label))) {
      return false;
    }
  }

  if (
    conditions.environments?.length &&
    (!event.environment || !conditions.environments.includes(event.environment))
  ) {
    return false;
  }

  if (
    conditions.severities?.length &&
    (!event.severity || !conditions.severities.includes(event.severity))
  ) {
    return false;
  }

  return true;
}
