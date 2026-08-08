/**
 * SubagentRoster — per-role configuration that is threaded through
 * experimental_context from the web app into the task tool.
 *
 * Transport: same experimental_context channel as `skills` and `model`.
 * No new schema or DB column — this is a runtime-only object built from
 * ResolvedAgent rows in apps/web and forwarded inside OpenAgentCallOptions.
 */

import type { LanguageModel } from "ai";
import type { AgentModelSelection, DirectInferenceConfig } from "../models";
import { gateway, toAnthropicDirectModelId } from "../models";

/**
 * The per-role override record that the web layer resolves and the agent
 * consumes. All fields are optional — missing or null means "use default".
 */
export interface SubagentRosterEntry {
  /**
   * Override model for this role, already resolved to a real provider id
   * (never an unparsed "user-profile:<profileId>:<modelId>" composite — see
   * #1157). null/absent = use the shared subagent default.
   *
   * `directInference`/`providerOptionsOverrides` on this selection are set
   * only when the role has its OWN inference profile; a plain gateway id
   * override carries neither and falls back to the base selection's routing
   * (see `applyRosterOverrides`) rather than the Vercel gateway.
   */
  modelSelection?: AgentModelSelection | null;
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
    /**
     * The resolved selection that built `model` — the role's effective
     * default routing before any roster override. When a roster entry's
     * own `modelSelection` carries no `directInference`/
     * `providerOptionsOverrides` of its own (a plain gateway id override),
     * this selection's routing is reused instead of falling back to the
     * Vercel gateway (#1157, bug 2).
     */
    selection?: AgentModelSelection;
  };
};

export type ApplyRosterOverridesResult = {
  model: LanguageModel | { modelId: string };
  instructions: string;
  composioToolkitSlugs?: string[];
};

/**
 * Derive a direct-inference config for `overrideModelId` from the base
 * selection's direct config, WITHOUT reusing the base's provider-side
 * modelId (#1157, bug: the base's directInference object carries the base
 * model's provider-side id, and gateway() builds the provider call from that
 * id, not from the roster entry's own model — silently running the base
 * model, or the wrong provider entirely on a cross-provider override).
 *
 * Only the key/endpoint (apiKey, baseURL, provider) are reused — the
 * modelId is always re-derived for the role's own model:
 * - anthropic: mapped via toAnthropicDirectModelId, the same catalog-id
 *   mapping resolve-inference-profile-model-selection.ts uses. Returns
 *   undefined when the override isn't an "anthropic/…" catalog id (a
 *   cross-provider override) — direct routing can't be derived, so the
 *   caller falls back to the plain Vercel gateway with the role's own id
 *   rather than silently substituting the base model.
 * - openai-compatible: the provider model id is sent verbatim (mirrors
 *   profile-resolution.ts's non-anthropic path), so the override's id is
 *   used directly.
 */
function deriveFallbackDirectConfig(
  baseDirect: DirectInferenceConfig,
  overrideModelId: string,
): DirectInferenceConfig | undefined {
  if (baseDirect.provider === "anthropic") {
    const directModelId = toAnthropicDirectModelId(overrideModelId);
    return directModelId
      ? { ...baseDirect, modelId: directModelId }
      : undefined;
  }
  return { ...baseDirect, modelId: overrideModelId };
}

/**
 * Apply the roster entry for `role` on top of the base subagent options.
 *
 * Rules:
 * - roster null or role absent → return base unchanged (byte-identical behavior)
 * - entry.modelSelection present and non-null → replace model with
 *   packages/agent/models.ts's gateway(), so directInference and
 *   providerOptionsOverrides always reach a provider call. The entry's own
 *   routing wins when present; otherwise direct routing is DERIVED for the
 *   entry's own model from `base.selection`'s key/endpoint (never a bare
 *   reuse of the base's provider-side modelId — see
 *   `deriveFallbackDirectConfig`). When derivation isn't possible (a
 *   cross-provider override), the entry routes through the plain Vercel
 *   gateway with its own model id instead of silently running the base
 *   model.
 * - entry.instructions present and non-null → append to base instructions
 * - entry.composioToolkitSlugs non-empty → return them for tool assembly
 *
 * This function does not perform DB access or inference-profile resolution —
 * it only builds a model from an already-resolved selection. Resolving a
 * roster entry's own profile happens upstream, in
 * apps/web/app/workflows/resolve-step-agent-models.ts.
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
  let model = base.model;
  if (entry.modelSelection) {
    const ownDirect =
      entry.modelSelection.directInference ??
      entry.modelSelection.directAnthropic;
    const baseDirect =
      base.selection?.directInference ?? base.selection?.directAnthropic;
    const directInference =
      ownDirect ??
      (baseDirect
        ? deriveFallbackDirectConfig(baseDirect, entry.modelSelection.id)
        : undefined);

    model = gateway(entry.modelSelection.id, {
      directInference,
      providerOptionsOverrides:
        entry.modelSelection.providerOptionsOverrides ??
        base.selection?.providerOptionsOverrides,
    });
  }

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
