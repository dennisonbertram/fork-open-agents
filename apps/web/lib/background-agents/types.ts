import { z } from "zod";
import { USER_INFERENCE_OPTION_PREFIX } from "@/lib/inference/model-option-id";
import { triggerShapeSchema } from "./trigger-shape-schema";
import {
  backgroundAgentStatuses,
  backgroundAgentTriggerKinds,
  triggerConditionsSchema,
  type BackgroundAgentStatus,
  type BackgroundAgentTriggerKind,
} from "./trigger-primitives";

// Re-exported for backward compatibility — these primitives now live in
// trigger-primitives.ts (shared with trigger-shape-schema.ts, #762) to avoid
// a circular import between this file and trigger-shape-schema.ts.
export {
  backgroundAgentStatuses,
  backgroundAgentTriggerKinds,
  triggerConditionsSchema,
};
export type { BackgroundAgentStatus, BackgroundAgentTriggerKind };

export const backgroundAgentRunSources = [
  "github",
  "schedule",
  "webhook",
] as const;

export type BackgroundAgentRunSource =
  (typeof backgroundAgentRunSources)[number];

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
  "agent_deleted",
  "snapshot_missing",
  "snapshot_invalid",
  "snapshot_version_unsupported",
  "snapshot_hash_mismatch",
  "normalized_input_invalid",
  "normalized_input_version_unsupported",
  "normalized_input_policy_invalid",
  "permission_missing",
  "installation_missing",
  "sandbox_unavailable",
  "workflow_failed",
  "checks_failed",
  // Retired (#746): action-level errorKinds (write_scope_denied,
  // ci_not_green, github_api_error, token_mint_failed) from the native
  // GitHub action tools replace pr_creation_failed. Kept in this union for
  // backward compatibility with historical run rows.
  "pr_creation_failed",
  "model_resolution_failed",
  "webhook_signature_invalid",
  // (#916) Superseded for the progress-based stall path by "agent_stalled"
  // below — escalate-and-commit-on-stall replaces the hard kill. Retained
  // for backward compatibility with historical run rows (and the opt-in
  // absolute hard turn ceiling, #862/#896, which still uses this kind).
  "agent_turn_budget_exceeded",
  // (#916) A background-agent run that made no progress (git-delta) or kept
  // repeating/cycling the same tool calls, was nudged to re-plan, then
  // escalated to a tool-aware finalize instruction, and still did not
  // recover within the finalize window. Distinct from
  // agent_turn_budget_exceeded: work already committed/pushed/commented by
  // the agent's finalize turns is preserved, not discarded.
  "agent_stalled",
  // (#917) A background-agent run whose accumulated token usage breached the
  // per-run token fuse (BACKGROUND_AGENT_MAX_RUN_TOKENS) — a runaway-COST
  // backstop, not a work limit. Routes through the same escalate-and-commit
  // path as agent_stalled (work is preserved), but surfaces distinctly so
  // operators can review cost/runaway rather than a progress stall.
  "token_budget_exceeded",
] as const;

export type BackgroundAgentErrorKind =
  (typeof backgroundAgentErrorKinds)[number];

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
 * Per-action GitHub automation toggles (#745) — the sole behavior driver
 * for a background agent's GitHub-facing automation (#748).
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
    checkCommand: z.string().trim().max(500).optional().nullable(),
    composioToolkitSlugs: z.array(z.string().trim().min(1)).max(50).default([]),
    githubActions: githubActionsSchema.default(defaultGithubActions),
    writeScope: writeScopeSchema.default(defaultWriteScope),
    requireCiGreenForMerge: z.boolean().default(true),
    modelId: modelIdSchema.optional().default(null),
    // Per-agent-per-PR run budget (#749) — backstop against ping-pong loops.
    runBudgetPerTarget: z.number().int().min(1).max(1000).default(10),
    // The single-trigger shape (name/kind/status/conditions/schedule, with
    // schedule.cron validation) is shared with the loop-trigger routes
    // (#762) via trigger-shape-schema.ts — do not duplicate it here.
    triggers: z.array(triggerShapeSchema).min(1).max(10),
  })
  .strict();

export const updateBackgroundAgentSchema = z
  .object({
    name: createBackgroundAgentSchema.shape.name.optional(),
    description: createBackgroundAgentSchema.shape.description.optional(),
    status: createBackgroundAgentSchema.shape.status.removeDefault().optional(),
    repoOwner: createBackgroundAgentSchema.shape.repoOwner.optional(),
    repoName: createBackgroundAgentSchema.shape.repoName.optional(),
    instructions: createBackgroundAgentSchema.shape.instructions.optional(),
    permissions: createBackgroundAgentSchema.shape.permissions
      .removeDefault()
      .optional(),
    checkCommand: createBackgroundAgentSchema.shape.checkCommand.optional(),
    composioToolkitSlugs: createBackgroundAgentSchema.shape.composioToolkitSlugs
      .removeDefault()
      .optional(),
    githubActions: createBackgroundAgentSchema.shape.githubActions
      .removeDefault()
      .optional(),
    writeScope: createBackgroundAgentSchema.shape.writeScope
      .removeDefault()
      .optional(),
    requireCiGreenForMerge:
      createBackgroundAgentSchema.shape.requireCiGreenForMerge
        .removeDefault()
        .optional(),
    modelId: createBackgroundAgentSchema.shape.modelId
      .removeDefault()
      .optional(),
    runBudgetPerTarget: createBackgroundAgentSchema.shape.runBudgetPerTarget
      .removeDefault()
      .optional(),
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
