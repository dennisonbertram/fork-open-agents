/**
 * agents-roster.ts — pure builder for the Settings → Agents roster.
 *
 * No I/O. Takes pre-loaded data and returns one row per agent role
 * (main, explorer, executor, design) with resolved display values.
 *
 * Descriptions are sourced from packages/agent/subagents/registry.ts
 * `shortDescription` fields but inlined here because the agent package
 * exports only its index and subpaths are not available as named exports.
 */
import type {
  ComposioAgentDefaults,
  ComposioToolProfileSummary,
} from "@/lib/composio/types";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

export type AgentRosterRow = {
  key: "main" | "explorer" | "executor" | "design";
  name: string;
  description: string;
  /** Resolved model id, or null when sub-role inherits main. */
  model: string | null;
  /**
   * The inference profile this role's model routes through, or null for the
   * Vercel gateway. The editor recomposes this with `model` (via
   * `getModelOptionSelectionId`) into the same composite id the Model
   * picker's own options use, so a profile-bound role's Save round-trips
   * without silently dropping its own-key routing (#1157).
   */
  inferenceProfileId: string | null;
  /** True when the sub-role has no explicit model override (inherits Main). */
  modelInherited: boolean;
  /** True when model comes from a user_default agent row (not preference default). */
  modelCustom: boolean;
  /** Human label for the Composio tools assignment (profile name or "None"). */
  toolsLabel: string;
  /** True when tools come from a user_default agent row. */
  toolsCustom: boolean;
  /**
   * Raw Composio toolkit slugs from the saved user_default agent row.
   * Empty array when no row exists or the row has none saved.
   * Populated so the AgentEditor can pre-populate without data loss on Save.
   */
  composioToolkitSlugs: string[];
  /** Instructions string or null (null = built-in). */
  instructions: string | null;
  /** True when instructions come from a user_default agent row (non-null). */
  instructionsCustom: boolean;
  /** Human label for the managed runtime profile. */
  runtimeLabel: string;
  /** True when runtime comes from a user_default agent row. */
  runtimeCustom: boolean;
  /**
   * Human label for the user's enabled skills. Skills are globally available to
   * the user's agents, so this label is identical across every role row.
   */
  skillsLabel: string;
  /**
   * Whether GitHub tools are enabled for this agent.
   * Only meaningful for the "main" role; sub-roles always get false.
   */
  githubToolsEnabled: boolean;
  /**
   * Whether tool authoring is enabled for this agent (propose_composio_tool).
   * Only meaningful for the "main" role; sub-roles always get false.
   */
  toolAuthoringEnabled: boolean;
};

/** Minimal shape of a user_default agent row needed by the roster builder. */
export type UserDefaultAgentRowSummary = {
  role: "main" | "explorer" | "executor" | "design";
  modelId: string | null;
  /** Optional for backward-compatible fixtures; absent means "no profile". */
  inferenceProfileId?: string | null;
  composioToolkitSlugs: string[];
  composioProfileId: string | null;
  instructions: string | null;
  managedRuntimeProfileId: string | null;
  githubToolsEnabled?: boolean;
  toolAuthoringEnabled?: boolean;
};

export type BuildAgentRosterInput = {
  preferences: {
    defaultModelId: string;
    defaultSubagentModelId: string | null;
    defaultManagedRuntimeProfileId: string;
  };
  composioDefaults: ComposioAgentDefaults;
  runtimeProfiles: ManagedRuntimeProfile[];
  /** Optional profile summaries for resolving profile names. */
  profileSummaries?: ComposioToolProfileSummary[];
  /** Count of the user's enabled, hand-authored skills. Defaults to 0. */
  enabledSkillCount?: number;
  /**
   * Phase 3: user_default agent rows.
   * When provided, values from these rows override the preference defaults for the
   * matching role's fields, and the `*Custom` flags are set to true.
   */
  userDefaultAgentRows?: UserDefaultAgentRowSummary[];
};

/** "None" when no skills are enabled, otherwise "N enabled". */
function formatSkillsLabel(count: number): string {
  return count > 0 ? `${count} enabled` : "None";
}

/** Human-friendly display name per role. */
const ROLE_NAMES: Record<"main" | "explorer" | "executor" | "design", string> =
  {
    main: "Main",
    explorer: "Explorer",
    executor: "Executor",
    design: "Design",
  };

/**
 * Per-role descriptions. Main is hardcoded (no registry entry exists for it).
 * Explorer/Executor/Design are copied verbatim from
 * packages/agent/subagents/registry.ts `shortDescription` fields.
 */
const ROLE_DESCRIPTIONS: Record<
  "main" | "explorer" | "executor" | "design",
  string
> = {
  main: "Coordinates each Session, plans work, calls tools, and delegates to helper roles.",
  explorer:
    "A helper role for read-only codebase exploration, tracing behavior, and answering questions without changing files",
  executor:
    "A helper role for well-scoped implementation work, including edits, scaffolding, refactors, and other file changes",
  design:
    "A helper role for creating distinctive, production-grade frontend interfaces with high design quality.",
};

/**
 * Build the agent roster rows from pre-loaded settings data.
 * Returns exactly four rows in canonical role order.
 *
 * Phase 3: when userDefaultAgentRows are provided, their values override the
 * preference defaults and the `*Custom` flags are set accordingly, so the
 * collapsed summary reflects saved values. All original behavior is preserved
 * when no rows are provided (or rows is empty).
 */
export function buildAgentRoster({
  preferences,
  composioDefaults,
  runtimeProfiles,
  profileSummaries = [],
  enabledSkillCount = 0,
  userDefaultAgentRows = [],
}: BuildAgentRosterInput): AgentRosterRow[] {
  const profileById = new Map(profileSummaries.map((p) => [p.id, p]));

  const runtimeProfile = runtimeProfiles.find(
    (p) => p.id === preferences.defaultManagedRuntimeProfileId,
  );
  const defaultRuntimeLabel = runtimeProfile?.displayName ?? "Default sandbox";
  const skillsLabel = formatSkillsLabel(enabledSkillCount);

  const subagentModel = preferences.defaultSubagentModelId;
  const subagentModelInherited = subagentModel === null;

  // Index user_default rows by role for O(1) lookup
  const agentRowByRole = new Map(userDefaultAgentRows.map((r) => [r.role, r]));

  const keys = ["main", "explorer", "executor", "design"] as const;

  return keys.map((key): AgentRosterRow => {
    const isMain = key === "main";
    const description = ROLE_DESCRIPTIONS[key];
    const agentRow = agentRowByRole.get(key);

    // ── Model ──────────────────────────────────────────────────────────────
    let model: string | null;
    let inferenceProfileId: string | null;
    let modelInherited: boolean;
    let modelCustom: boolean;

    if (agentRow?.modelId != null) {
      // agent row has an explicit modelId
      model = agentRow.modelId;
      inferenceProfileId = agentRow.inferenceProfileId ?? null;
      modelInherited = false;
      modelCustom = true;
    } else {
      // fall back to preference defaults (no per-role profile routing here)
      model = isMain ? preferences.defaultModelId : (subagentModel ?? null);
      inferenceProfileId = null;
      modelInherited = !isMain && subagentModelInherited;
      modelCustom = false;
    }

    // ── Tools ──────────────────────────────────────────────────────────────
    let toolsLabel: string;
    let toolsCustom: boolean;

    if (
      agentRow &&
      (agentRow.composioToolkitSlugs.length > 0 ||
        agentRow.composioProfileId != null)
    ) {
      // agent row has explicit tools
      if (
        agentRow.composioProfileId != null &&
        agentRow.composioToolkitSlugs.length === 0
      ) {
        const prof = profileById.get(agentRow.composioProfileId);
        toolsLabel = prof?.name ?? agentRow.composioProfileId;
      } else {
        const count = agentRow.composioToolkitSlugs.length;
        toolsLabel =
          count === 1 ? agentRow.composioToolkitSlugs[0] : `${count} toolkits`;
      }
      toolsCustom = true;
    } else {
      // fall back to composio defaults
      const profileId = composioDefaults[key].defaultProfileId;
      const profile =
        profileId != null ? profileById.get(profileId) : undefined;
      toolsLabel = profile?.name ?? "None";
      toolsCustom = false;
    }

    // ── Instructions ───────────────────────────────────────────────────────
    const instructions = agentRow?.instructions ?? null;
    const instructionsCustom = instructions != null;

    // ── Runtime ────────────────────────────────────────────────────────────
    let runtimeLabel: string;
    let runtimeCustom: boolean;

    if (agentRow?.managedRuntimeProfileId != null) {
      const prof = runtimeProfiles.find(
        (p) => p.id === agentRow.managedRuntimeProfileId,
      );
      runtimeLabel = prof?.displayName ?? agentRow.managedRuntimeProfileId;
      runtimeCustom = true;
    } else {
      runtimeLabel = defaultRuntimeLabel;
      runtimeCustom = false;
    }

    return {
      key,
      name: ROLE_NAMES[key],
      description,
      model,
      inferenceProfileId,
      modelInherited,
      modelCustom,
      toolsLabel,
      toolsCustom,
      composioToolkitSlugs: agentRow?.composioToolkitSlugs ?? [],
      instructions,
      instructionsCustom,
      runtimeLabel,
      runtimeCustom,
      skillsLabel,
      githubToolsEnabled: agentRow?.githubToolsEnabled ?? false,
      toolAuthoringEnabled: agentRow?.toolAuthoringEnabled ?? false,
    };
  });
}
