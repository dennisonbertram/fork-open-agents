import { z } from "zod";
import { USER_INFERENCE_OPTION_PREFIX } from "@/lib/inference/model-option-id";
import { validateSchedule } from "./schedule-presets";

export const backgroundAgentTriggerKinds = [
  "github.pull_request",
  "github.pull_request_review",
  "github.deployment_status",
  "github.issue",
  "github.check_suite",
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
    // mergedOnly restricts github.pull_request to merged-closed events.
    // Stored as JSONB, no migration needed. Not user-exposed yet (CODE-03).
    mergedOnly: z.boolean().optional(),
    // actors/ignoreActors (#749): allowlist/denylist matched case-insensitively
    // against event.actor (sender.login). Lets a reviewer agent ignore its own
    // bot login, or a fixer ignore the reviewer, to break ping-pong loops.
    actors: z.array(z.string().min(1)).max(20).optional(),
    ignoreActors: z.array(z.string().min(1)).max(20).optional(),
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

/**
 * Per-action GitHub automation toggles (#745). Replaces `outputMode` as the
 * behavior driver; `outputMode` remains accepted (deprecated) until #C7.
 */
export const githubActionsSchema = z
  .object({
    open_pull_request: z.boolean().optional(),
    comment_on_pr_or_issue: z.boolean().optional(),
    approve_pull_request: z.boolean().optional(),
    request_changes: z.boolean().optional(),
    merge_pull_request: z.boolean().optional(),
    push: z.boolean().optional(),
    delete_branch: z.boolean().optional(),
  })
  .strict();

export const defaultGithubActions = {
  open_pull_request: true,
  comment_on_pr_or_issue: true,
} as const;

/**
 * Which repositories a background agent's write actions may target,
 * independent of the trigger-binding repoOwner/repoName pair.
 */
export const writeScopeSchema = z
  .object({
    mode: z.enum(["this_repo", "all_repos", "specific_repos"]),
    repos: z
      .array(
        z
          .object({
            owner: z.string().trim().min(1).max(120),
            name: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

export const defaultWriteScope = { mode: "this_repo" } as const;

// The model half may itself contain slashes — the catalog carries nested ids
// like 'fireworks/zai/glm-5.2' and Fireworks-style
// 'fireworks/accounts/fireworks/models/...' paths.
const gatewayModelIdPattern = /^[a-z0-9._-]+\/[a-z0-9._:/-]+$/i;

/**
 * modelId must be either a gateway `provider/model` id or a
 * `user-profile:`-prefixed inference profile selection (see
 * lib/inference/model-option-id.ts). Null/omitted means inherit the
 * default model.
 */
export const modelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      value.startsWith(USER_INFERENCE_OPTION_PREFIX) ||
      gatewayModelIdPattern.test(value),
    {
      message:
        "modelId must be a gateway 'provider/model' id or a 'user-profile:'-prefixed selection.",
    },
  )
  .nullable();

export const createBackgroundAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional().nullable(),
    status: z.enum(backgroundAgentStatuses).default("disabled"),
    repoOwner: z.string().trim().min(1).max(120),
    repoName: z.string().trim().min(1).max(120),
    instructions: z.string().trim().min(1).max(8000),
    permissions: permissionsSchema.default({}),
    // Deprecated: retained for backward compatibility until the column-drop
    // ticket (#748/#C7). Prefer githubActions for new behavior.
    outputMode: z.enum(backgroundAgentOutputModes).default("none"),
    checkCommand: z.string().trim().max(500).optional().nullable(),
    composioToolkitSlugs: z.array(z.string().trim().min(1)).max(50).default([]),
    githubActions: githubActionsSchema.default(defaultGithubActions),
    writeScope: writeScopeSchema.default(defaultWriteScope),
    requireCiGreenForMerge: z.boolean().default(true),
    modelId: modelIdSchema.optional().default(null),
    // Per-agent-per-PR run budget (#749) — backstop against ping-pong loops.
    runBudgetPerTarget: z.number().int().min(1).max(1000).default(10),
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
          .strict()
          .superRefine((trigger, ctx) => {
            if (trigger.kind === "schedule.cron") {
              const result = validateSchedule(trigger.schedule);
              if (!result.valid) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: ["schedule"],
                  message:
                    result.error ??
                    "Invalid schedule expression. Supported formats: @hourly, @daily, @weekly, or a 5-field cron expression.",
                });
              }
            }
          }),
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
  // pull_request: merged boolean on closed events
  merged?: boolean;
  // pull_request_review: review-specific fields
  reviewId?: number;
  reviewState?: string;
  reviewerLogin?: string;
  prUrl?: string;
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
