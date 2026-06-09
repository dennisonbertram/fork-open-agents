import { tool } from "ai";
import { z } from "zod";

// ── Types ─────────────────────────────────────────────────────────────────────

export const PROPOSE_TOOL_NAME = "propose_composio_tool" as const;

/**
 * The action the web layer injects via experimental_context so the tool can
 * record the proposal without taking a direct DB dependency in packages/agent.
 * Mirrors the pattern used by the skill tool and the roster plumbing.
 */
export type ProposeToolAction = (input: {
  toolkitSlug: string;
  chatId?: string;
  runId?: string;
}) => Promise<{ entryId: string }>;

// ── Tool definition ───────────────────────────────────────────────────────────

const inputSchema = z.object({
  toolkitSlug: z
    .string()
    .min(1)
    .describe(
      "The Composio toolkit slug to add (e.g. 'github', 'linear', 'slack'). " +
        "Must be a valid Composio provider key.",
    ),
  reason: z
    .string()
    .describe(
      "Why you need this toolkit — shown to the owner when they review the proposal.",
    ),
});

/**
 * propose_composio_tool — policy-gated tool that records a proposal to add a
 * Composio toolkit to this agent's configuration.
 *
 * The proposal is stored with status="proposed" and requires owner approval
 * before the slug becomes live (off by default).
 *
 * This tool MUST only be included in the toolset when the resolved agent's
 * toolAuthoringEnabled === true (gate is in open-agent.ts / getRuntimeModeToolPolicy).
 */
export const proposeComposioToolTool = tool({
  description:
    "Propose adding a Composio toolkit to this agent's permanent tool configuration. " +
    "The proposal requires the owner's approval before the toolkit is granted. " +
    "Use this when a task would benefit from a reusable external integration " +
    "(e.g. GitHub, Linear, Slack) that should persist across future runs.",
  inputSchema,
  execute: async (
    { toolkitSlug, reason: _reason }: { toolkitSlug: string; reason: string },
    { experimental_context }: { experimental_context?: unknown },
  ) => {
    // Extract the web-injected propose action from context
    const ctx = experimental_context as Record<string, unknown> | undefined;
    const proposeAction = ctx?.["proposeToolAction"] as
      | ProposeToolAction
      | undefined;

    if (typeof proposeAction !== "function") {
      return {
        ok: false,
        error:
          "Tool authoring is not available in this context. " +
          "proposeToolAction was not injected into experimental_context.",
      };
    }

    try {
      const result = await proposeAction({ toolkitSlug });
      return {
        ok: true,
        message:
          `Proposed adding toolkit "${toolkitSlug}" to your agent configuration. ` +
          `Entry ID: ${result.entryId}. ` +
          "The owner will need to approve this before it becomes active.",
        entryId: result.entryId,
        status: "proposed",
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `Failed to record tool proposal: ${message}`,
      };
    }
  },
});

// ── Gating helper ─────────────────────────────────────────────────────────────

/**
 * Returns the propose_composio_tool if toolAuthoringEnabled=true, else undefined.
 *
 * Used by getRuntimeModeToolPolicy to conditionally include the authoring tool
 * without polluting the base tool list (off-by-default, per the design doc).
 */
export function getProposeTool(options: {
  toolAuthoringEnabled?: boolean;
}): typeof proposeComposioToolTool | undefined {
  return options.toolAuthoringEnabled === true
    ? proposeComposioToolTool
    : undefined;
}
