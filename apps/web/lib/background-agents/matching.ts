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

  // mergedOnly restricts github.pull_request triggers to merged-closed PRs.
  // GitHub never sends action:"merged"; merged is a boolean on action:"closed".
  if (conditions.mergedOnly === true && event.merged !== true) {
    return false;
  }

  // actors (#749): allowlist matched case-insensitively against event.actor.
  // Missing actor never matches a configured allowlist.
  if (conditions.actors?.length) {
    const actor = event.actor?.toLowerCase();
    const allowed = conditions.actors.map((value) => value.toLowerCase());
    if (!actor || !allowed.includes(actor)) {
      return false;
    }
  }

  // ignoreActors (#749): denylist matched case-insensitively against
  // event.actor. This is the loop-safety backstop — e.g. a reviewer agent
  // ignores events authored by its own bot login. A missing actor never
  // matches a configured denylist (nothing to filter out).
  if (conditions.ignoreActors?.length) {
    const actor = event.actor?.toLowerCase();
    const ignored = conditions.ignoreActors.map((value) => value.toLowerCase());
    if (actor && ignored.includes(actor)) {
      return false;
    }
  }

  return true;
}
