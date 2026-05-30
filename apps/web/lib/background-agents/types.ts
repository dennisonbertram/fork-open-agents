import { z } from "zod";

export const backgroundAgentTriggerKinds = [
  "github.pull_request",
  "github.deployment_status",
  "github.issue",
  "schedule.cron",
  "webhook.error",
] as const;

export type BackgroundAgentTriggerKind =
  (typeof backgroundAgentTriggerKinds)[number];

export const backgroundAgentRunSources = [
  "github",
  "schedule",
  "webhook",
] as const;

export type BackgroundAgentRunSource =
  (typeof backgroundAgentRunSources)[number];

export const backgroundAgentOutputModes = [
  "comment",
  "ready_pr",
  "issue",
  "notification",
  "none",
] as const;

export type BackgroundAgentOutputMode =
  (typeof backgroundAgentOutputModes)[number];

export const backgroundAgentStatuses = ["enabled", "disabled"] as const;

export type BackgroundAgentStatus = (typeof backgroundAgentStatuses)[number];

export const backgroundAgentRunStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
] as const;

export type BackgroundAgentRunStatus =
  (typeof backgroundAgentRunStatuses)[number];

export const backgroundAgentErrorKinds = [
  "duplicate_event",
  "agent_disabled",
  "permission_missing",
  "installation_missing",
  "sandbox_unavailable",
  "workflow_failed",
  "checks_failed",
  "pr_creation_failed",
  "webhook_signature_invalid",
] as const;

export type BackgroundAgentErrorKind =
  (typeof backgroundAgentErrorKinds)[number];

export const triggerConditionsSchema = z
  .object({
    actions: z.array(z.string().min(1)).optional(),
    branches: z.array(z.string().min(1)).optional(),
    labels: z.array(z.string().min(1)).optional(),
    environments: z.array(z.string().min(1)).optional(),
    severities: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const permissionsSchema = z
  .object({
    github: z
      .object({
        contents: z.enum(["read", "write"]).optional(),
        pullRequests: z.enum(["read", "write"]).optional(),
        issues: z.enum(["read", "write"]).optional(),
        deployments: z.literal("read").optional(),
        statuses: z.literal("read").optional(),
        checks: z.literal("read").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const createBackgroundAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional().nullable(),
    status: z.enum(backgroundAgentStatuses).default("disabled"),
    repoOwner: z.string().trim().min(1).max(120),
    repoName: z.string().trim().min(1).max(120),
    instructions: z.string().trim().min(1).max(8000),
    permissions: permissionsSchema.default({}),
    outputMode: z.enum(backgroundAgentOutputModes).default("none"),
    checkCommand: z.string().trim().max(500).optional().nullable(),
    triggers: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(100),
            kind: z.enum(backgroundAgentTriggerKinds),
            status: z.enum(backgroundAgentStatuses).default("enabled"),
            conditions: triggerConditionsSchema.default({}),
            schedule: z.string().trim().max(100).optional().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();

export const updateBackgroundAgentSchema = createBackgroundAgentSchema
  .omit({ triggers: true })
  .partial()
  .extend({
    triggers: createBackgroundAgentSchema.shape.triggers.optional(),
  })
  .strict();

export type CreateBackgroundAgentInput = z.infer<
  typeof createBackgroundAgentSchema
>;

export type UpdateBackgroundAgentInput = z.infer<
  typeof updateBackgroundAgentSchema
>;

export type NormalizedBackgroundTriggerEvent = {
  source: BackgroundAgentRunSource;
  kind: BackgroundAgentTriggerKind;
  externalId: string;
  repoOwner: string;
  repoName: string;
  action?: string;
  ref?: string;
  sha?: string;
  branch?: string;
  prNumber?: number;
  issueNumber?: number;
  deploymentUrl?: string;
  labels?: string[];
  environment?: string;
  severity?: string;
  title?: string;
  url?: string;
  actor?: string;
  message?: string;
  occurredAt?: string;
};

export function normalizeRepoName(value: string): string {
  return value.trim().toLowerCase();
}

export function buildBackgroundRunIdempotencyKey(params: {
  agentId: string;
  triggerId: string;
  event: NormalizedBackgroundTriggerEvent;
}): string {
  return [
    params.agentId,
    params.triggerId,
    params.event.source,
    params.event.kind,
    params.event.externalId,
  ].join(":");
}
