import { z } from "zod";
import type { OutputMode, TriggerKind } from "./agent-spec";

const draftTriggerKinds = [
  "github.pull_request",
  "github.pull_request_review",
  "github.deployment_status",
  "github.issue",
  "schedule.cron",
  "webhook.error",
] as const;

const draftOutputModes = ["none", "ready_pr"] as const;

const conditionListSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(20)
  .optional();

export const backgroundAgentDraftOutputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  goal: z.string().trim().max(240).default(""),
  triggerKind: z.enum(draftTriggerKinds),
  instructions: z.string().trim().min(20).max(4000),
  outputMode: z.enum(draftOutputModes).default("none"),
  checkCommand: z.string().trim().max(240).default(""),
  schedule: z.string().trim().max(120).default(""),
  conditions: z
    .object({
      actions: conditionListSchema,
      branches: conditionListSchema,
      labels: conditionListSchema,
      environments: conditionListSchema,
      statuses: conditionListSchema,
      severities: conditionListSchema,
    })
    .default({}),
});

export type BackgroundAgentDraftOutput = z.infer<
  typeof backgroundAgentDraftOutputSchema
>;

export type BackgroundAgentDraftForm = {
  name: string;
  goal: string;
  triggerKind: TriggerKind;
  instructions: string;
  outputMode: OutputMode;
  checkCommand: string;
  schedule: string;
  conditionActions: string;
  conditionBranches: string;
  conditionLabels: string;
  conditionEnvironments: string;
  conditionSeverities: string;
};

function joinList(values: string[] | undefined): string {
  return values?.join(", ") ?? "";
}

export function normalizeBackgroundAgentDraft(
  draft: BackgroundAgentDraftOutput,
): BackgroundAgentDraftForm {
  return {
    name: draft.name.trim(),
    goal: draft.goal.trim(),
    triggerKind: draft.triggerKind,
    instructions: draft.instructions.trim(),
    outputMode: draft.outputMode,
    checkCommand: draft.checkCommand.trim(),
    schedule:
      draft.triggerKind === "schedule.cron" ? draft.schedule.trim() : "",
    conditionActions: joinList(draft.conditions.actions),
    conditionBranches: joinList(draft.conditions.branches),
    conditionLabels: joinList(draft.conditions.labels),
    conditionEnvironments: joinList(draft.conditions.environments),
    conditionSeverities: joinList(
      draft.conditions.statuses ?? draft.conditions.severities,
    ),
  };
}

export function buildBackgroundAgentDraftPrompt(input: {
  description: string;
  repoOwner: string;
  repoName: string;
}): string {
  return `Draft a background agent spec for ${input.repoOwner}/${input.repoName}.

User description:
${input.description.trim()}

Return one JSON object matching this shape:
{
  "name": "short recognizable name",
  "goal": "one short sentence",
  "triggerKind": "github.pull_request | github.pull_request_review | github.deployment_status | github.issue | schedule.cron | webhook.error",
  "instructions": "specific instructions the unattended agent should follow",
  "outputMode": "none | ready_pr",
  "checkCommand": "optional shell command, blank when not needed",
  "schedule": "cron expression, only for schedule.cron",
  "conditions": {
    "actions": ["opened"],
    "branches": ["main"],
    "labels": ["bug"],
    "environments": ["production"],
    "statuses": ["failure"],
    "severities": ["error"]
  }
}

Rules:
- Prefer "none" unless the user clearly wants the agent to change code and open a draft pull request.
- Pick the narrowest trigger that matches the description.
- For issue triage, use "github.issue" with action "opened" when appropriate.
- For PR review or CI follow-up, use "github.pull_request".
- For scheduled reports, use "schedule.cron" and include a simple cron expression.
- Keep instructions concrete, reviewable, and non-destructive; explicitly say what not to do when relevant.
- Leave unused condition arrays empty or omit them.`;
}
