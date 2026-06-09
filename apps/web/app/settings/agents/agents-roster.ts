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
  /** True when the sub-role has no explicit model override (inherits Main). */
  modelInherited: boolean;
  /** Human label for the Composio tools assignment (profile name or "None"). */
  toolsLabel: string;
  /** Human label for the managed runtime profile. */
  runtimeLabel: string;
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
};

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
  main: "Drives every chat. Plans, calls tools, and delegates work to subagents.",
  explorer:
    "Use for read-only codebase exploration, tracing behavior, and answering questions without changing files",
  executor:
    "Use for well-scoped implementation work, including edits, scaffolding, refactors, and other file changes",
  design:
    "Use for creating distinctive, production-grade frontend interfaces with high design quality. Generates creative, polished code that avoids generic AI aesthetics.",
};

/**
 * Build the read-only agent roster rows from pre-loaded settings data.
 * Returns exactly four rows in canonical role order.
 */
export function buildAgentRoster({
  preferences,
  composioDefaults,
  runtimeProfiles,
  profileSummaries = [],
}: BuildAgentRosterInput): AgentRosterRow[] {
  const profileById = new Map(profileSummaries.map((p) => [p.id, p]));

  const runtimeProfile = runtimeProfiles.find(
    (p) => p.id === preferences.defaultManagedRuntimeProfileId,
  );
  const runtimeLabel = runtimeProfile?.displayName ?? "Default sandbox";

  const subagentModel = preferences.defaultSubagentModelId;
  const subagentModelInherited = subagentModel === null;

  const keys = ["main", "explorer", "executor", "design"] as const;

  return keys.map((key): AgentRosterRow => {
    // Model
    const isMain = key === "main";
    const model = isMain ? preferences.defaultModelId : (subagentModel ?? null);
    const modelInherited = !isMain && subagentModelInherited;

    // Description
    const description = ROLE_DESCRIPTIONS[key];

    // Tools label
    const profileId = composioDefaults[key].defaultProfileId;
    const profile = profileId != null ? profileById.get(profileId) : undefined;
    const toolsLabel = profile?.name ?? "None";

    return {
      key,
      name: ROLE_NAMES[key],
      description,
      model,
      modelInherited,
      toolsLabel,
      runtimeLabel,
    };
  });
}
