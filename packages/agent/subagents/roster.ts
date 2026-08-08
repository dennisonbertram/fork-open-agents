/**
 * SubagentRoster — per-role configuration that is threaded through
 * experimental_context from the web app into the task tool.
 *
 * Transport: same experimental_context channel as `skills` and `model`.
 * No new schema or DB column — this is a runtime-only object built from
 * ResolvedAgent rows in apps/web and forwarded inside OpenAgentCallOptions.
 */

import type { LanguageModel } from "ai";
import { gateway } from "ai";
import type { ProviderModelId } from "../provider-model-id";

/**
 * The per-role override record that the web layer resolves and the agent
 * consumes. All fields are optional — missing or null means "use default".
 */
export interface SubagentRosterEntry {
  /** Override model id for this role. null = use the shared subagent default. */
  modelId?: ProviderModelId | null;
  /** Additional instructions appended to this role's system prompt. null = none. */
  instructions?: string | null;
  /** Composio toolkit slugs for this role. Empty array or absent = no tools. */
  composioToolkitSlugs?: string[];
}

/** Map from subagent role name to its override entry. */
export type SubagentRoster = Partial<
  Record<"explorer" | "executor" | "design", SubagentRosterEntry>
>;

export type ApplyRosterOverridesParams = {
  role: "explorer" | "executor" | "design";
  roster: SubagentRoster | null;
  base: {
    model: LanguageModel | { modelId: string };
    instructions: string;
  };
};

export type ApplyRosterOverridesResult = {
  model: LanguageModel | { modelId: string };
  instructions: string;
  composioToolkitSlugs?: string[];
};

/**
 * Apply the roster entry for `role` on top of the base subagent options.
 *
 * Rules:
 * - roster null or role absent → return base unchanged (byte-identical behavior)
 * - entry.modelId present and non-null → replace model with gateway(modelId)
 * - entry.instructions present and non-null → append to base instructions
 * - entry.composioToolkitSlugs non-empty → return them for tool assembly
 */
export function applyRosterOverrides({
  role,
  roster,
  base,
}: ApplyRosterOverridesParams): ApplyRosterOverridesResult {
  if (!roster) {
    return { model: base.model, instructions: base.instructions };
  }

  const entry = roster[role];
  if (!entry) {
    return { model: base.model, instructions: base.instructions };
  }

  // Model override
  const model =
    entry.modelId != null
      ? (gateway(entry.modelId) as LanguageModel)
      : base.model;

  // Instructions override — append to base
  const instructions =
    entry.instructions != null
      ? `${base.instructions}\n\n${entry.instructions}`
      : base.instructions;

  // Composio tool slugs — only forward when non-empty
  const composioToolkitSlugs =
    entry.composioToolkitSlugs && entry.composioToolkitSlugs.length > 0
      ? entry.composioToolkitSlugs
      : undefined;

  return { model, instructions, composioToolkitSlugs };
}
