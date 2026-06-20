import { tool } from "ai";
import { z } from "zod";

// ── Constants ──────────────────────────────────────────────────────────────────

export const MANAGE_BACKGROUND_AGENT_TOOL_NAME =
  "manage_background_agent" as const;

// ── Types ──────────────────────────────────────────────────────────────────────

/** The action the web layer injects via experimental_context. */
export type ManageBackgroundAgentAction = (input: {
  action: "create" | "update";
  agentId?: string;
  draft: unknown;
  summary: string;
  questionsForUser?: string[];
}) => Promise<{
  agentId: string;
  action: "created" | "updated";
  name: string;
}>;

// ── Schemas ────────────────────────────────────────────────────────────────────

const triggerSchema = z.object({
  name: z.string().min(1),
  kind: z.enum([
    "schedule",
    "pull_request.opened",
    "pull_request.synchronize",
    "issues.opened",
    "push",
    "webhook",
  ]),
  status: z.enum(["enabled", "disabled"]).default("enabled"),
  schedule: z.string().optional(),
  conditions: z.array(z.string().min(1)).default([]),
});

const backgroundAgentDraftSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  instructions: z.string().max(8000).default(""),
  outputMode: z
    .enum(["comment", "ready_pr", "issue", "notification", "none"])
    .default("ready_pr"),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  composioToolkitSlugs: z.array(z.string().min(1)).max(50).default([]),
  permissions: z
    .object({
      github: z
        .object({
          contents: z.enum(["read", "write"]).default("write"),
          pull_requests: z.enum(["read", "write"]).default("write"),
          issues: z.enum(["read", "write"]).default("read"),
        })
        .default({
          contents: "write",
          pull_requests: "write",
          issues: "read",
        }),
    })
    .default({
      github: {
        contents: "write",
        pull_requests: "write",
        issues: "read",
      },
    }),
  triggers: z.array(triggerSchema).min(1).max(10),
});

export const manageBackgroundAgentInputSchema = z.object({
  action: z
    .enum(["create", "update"])
    .describe(
      "Whether to create a new background agent or update an existing one.",
    ),
  agentId: z
    .string()
    .optional()
    .describe(
      "The ID of an existing background agent to update (required when action is 'update').",
    ),
  draft: backgroundAgentDraftSchema.describe(
    "The background agent configuration to create or apply as an update.",
  ),
  summary: z
    .string()
    .min(1)
    .describe(
      "A plain-language summary of what this background agent does, shown to the user for review.",
    ),
  questionsForUser: z
    .array(z.string().min(1))
    .default([])
    .describe("Open questions the user should answer before approving."),
});

export const manageBackgroundAgentOutputSchema = z.discriminatedUnion(
  "decision",
  [
    z.object({
      decision: z.literal("approved"),
      notes: z.string().optional(),
      createdAgentId: z.string().optional(),
    }),
    z.object({
      decision: z.literal("revise"),
      instructions: z.string().min(1),
    }),
    z.object({
      decision: z.literal("discarded"),
      reason: z.string().optional(),
    }),
  ],
);

export type ManageBackgroundAgentInput = z.infer<
  typeof manageBackgroundAgentInputSchema
>;
export type ManageBackgroundAgentOutput = z.infer<
  typeof manageBackgroundAgentOutputSchema
>;

// ── Tool definition ────────────────────────────────────────────────────────────

/**
 * manage_background_agent — policy-gated tool that lets an agent create or edit
 * a background agent on behalf of the user.
 *
 * The tool presents a draft to the user for review.  The user can approve
 * (persist the agent), revise (send instructions back to the model), or
 * discard (cancel).  The web layer injects a ManageBackgroundAgentAction
 * closure that calls the existing createBackgroundAgent / updateBackgroundAgent
 * store functions.
 *
 * Included in the toolset only when manageAgentEnabled === true (gated in
 * open-agent.ts / getRuntimeModeToolPolicy).
 */
export const manageBackgroundAgentTool = tool({
  description:
    "Create or edit a background agent that runs automated tasks on a repository. " +
    "Background agents execute on triggers (schedule, pull_request, push, webhook) " +
    "inside a sandbox and produce output (PR comment, ready PR, issue, notification). " +
    "Use this when a user asks to set up automation for a repo. " +
    "The draft will be shown to the user for review before it is saved.",
  inputSchema: manageBackgroundAgentInputSchema,
  outputSchema: manageBackgroundAgentOutputSchema,
  toModelOutput: ({ output }) => {
    if (!output) {
      return {
        type: "text" as const,
        value: "The background agent review was cancelled or timed out.",
      };
    }

    switch (output.decision) {
      case "approved":
        return {
          type: "text" as const,
          value:
            `Background agent ${output.createdAgentId ? `(ID: ${output.createdAgentId}) ` : ""}was approved and saved. ` +
            (output.notes ? `Notes: ${output.notes}` : ""),
        };
      case "revise":
        return {
          type: "text" as const,
          value: `The user requested revisions to the background agent draft. Instructions: ${output.instructions}`,
        };
      case "discarded":
        return {
          type: "text" as const,
          value: `The background agent draft was discarded. ${output.reason ? `Reason: ${output.reason}` : ""}`,
        };
    }
  },
});

// ── Gating helper ──────────────────────────────────────────────────────────────

/**
 * Returns the manage_background_agent tool if manageAgentEnabled === true,
 * else undefined.  Used by getRuntimeModeToolPolicy to conditionally include
 * the tool without polluting the base tool list.
 */
export function getManageBackgroundAgentTool(options: {
  manageAgentEnabled?: boolean;
}): typeof manageBackgroundAgentTool | undefined {
  return options.manageAgentEnabled === true
    ? manageBackgroundAgentTool
    : undefined;
}
