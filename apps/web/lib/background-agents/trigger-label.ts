/**
 * Pure helper: turns a trigger kind + conditions into a human-readable label
 * for display in agent cards, detail pages, and the condition editor.
 */
import type { TriggerKind, TriggerConditions } from "./agent-spec";

/**
 * Formats a human-readable label for a trigger kind and its conditions.
 * Examples:
 *   formatTriggerLabel("github.pull_request", { actions: ["opened"] }) → "On PR opened"
 *   formatTriggerLabel("github.issue", { labels: ["bug"] }) → "On issue labeled bug"
 *   formatTriggerLabel("github.deployment_status", { environments: ["production"] }) → "On deployment to production"
 */
export function formatTriggerLabel(
  kind: TriggerKind,
  conditions: TriggerConditions,
): string {
  switch (kind) {
    case "github.pull_request":
      return formatPrLabel(conditions);
    case "github.issue":
      return formatIssueLabel(conditions);
    case "github.deployment_status":
      return formatDeploymentLabel(conditions);
    case "schedule.cron":
      return "Scheduled";
    case "webhook.error":
      return "On error webhook";
  }
}

function formatPrLabel(conditions: TriggerConditions): string {
  const hasActions = conditions.actions && conditions.actions.length > 0;
  const hasBranches = conditions.branches && conditions.branches.length > 0;
  const hasLabels = conditions.labels && conditions.labels.length > 0;

  if (!hasActions && !hasBranches && !hasLabels) {
    return "On pull request";
  }

  const parts: string[] = ["On PR"];

  if (hasActions) {
    parts.push(conditions.actions!.join(", "));
  }

  if (hasLabels && !hasActions) {
    parts.push("labeled");
    parts.push(conditions.labels![0]!);
  }

  if (hasBranches) {
    parts.push("to");
    parts.push(conditions.branches![0]!);
  }

  return parts.join(" ");
}

function formatIssueLabel(conditions: TriggerConditions): string {
  const hasActions = conditions.actions && conditions.actions.length > 0;
  const hasLabels = conditions.labels && conditions.labels.length > 0;

  if (!hasActions && !hasLabels) {
    return "On issue";
  }

  const parts: string[] = ["On issue"];

  if (hasActions) {
    parts.push(conditions.actions![0]!);
  }

  if (hasLabels && !hasActions) {
    parts.push("labeled");
    parts.push(conditions.labels![0]!);
  }

  return parts.join(" ");
}

function formatDeploymentLabel(conditions: TriggerConditions): string {
  const hasEnvironments =
    conditions.environments && conditions.environments.length > 0;
  // Deployment status is stored in conditions.actions (the normalizer sets
  // event.action = state and the matcher checks conditions.actions).
  // The UI "Statuses" field (conditionSeverities) writes here via buildConditions.
  const hasStatuses = conditions.actions && conditions.actions.length > 0;

  if (!hasEnvironments && !hasStatuses) {
    return "On deployment";
  }

  const parts: string[] = ["On deployment"];

  if (hasStatuses) {
    parts.push(conditions.actions![0]!);
  }

  if (hasEnvironments) {
    parts.push("to");
    parts.push(conditions.environments![0]!);
  }

  return parts.join(" ");
}
