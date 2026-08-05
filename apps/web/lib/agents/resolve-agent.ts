import { listAgentsForUser } from "@/lib/db/agents";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { parseModelOptionSelection } from "@/lib/inference/model-option-id";
import type { GlobalSkillRef } from "@/lib/skills/global-skill-refs";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentRole = "main" | "explorer" | "executor" | "design";
export type AgentScope = "user_default" | "repo" | "session";

/** Minimal shape of an agent DB row that the resolver needs. */
export interface AgentRow {
  id: string;
  userId: string;
  name: string;
  role: AgentRole;
  scope: AgentScope;
  sessionId: string | null;
  repoOwner: string | null;
  repoName: string | null;
  modelId: string | null;
  inferenceProfileId: string | null;
  instructions: string | null;
  skillRefs: unknown[];
  builtinToolNames: string[] | null;
  composioToolkitSlugs: string[];
  composioProfileId: string | null;
  managedRuntimeProfileId: string | null;
  toolAuthoringEnabled: boolean;
  githubToolsEnabled: boolean;
}

/**
 * The flattened, inheritance-collapsed view of an agent configuration.
 * This is what every run type consumes.
 */
export interface ResolvedAgent {
  role: AgentRole;
  /**
   * True when this resolution came from a real DB agents row.
   * False when it is the synthetic prefs-derived fallback (no rows exist).
   *
   * Consumers (e.g. chat.ts toRosterEntry) must check this before including
   * modelId in a roster entry: a synthetic modelId must NOT be threaded into
   * the roster because it lacks providerOptionsOverrides, which would silently
   * drop model-variant overrides already wired through subagentModel.
   */
  fromDbRow: boolean;
  /**
   * The DB agents row id, or null when this is a synthetic fallback (no DB row).
   * Required to attribute tool-entry proposals (agent_tool_entries.agent_id FK).
   */
  agentId: string | null;
  modelId: string | null;
  inferenceProfileId: string | null;
  instructions: string | null;
  skillRefs: GlobalSkillRef[];
  builtinToolNames: string[] | null;
  composioToolkitSlugs: string[];
  composioProfileId: string | null;
  managedRuntimeProfileId: string | null;
  toolAuthoringEnabled: boolean;
  githubToolsEnabled: boolean;
}

export interface PickScopeKeys {
  sessionId?: string;
  repoOwner?: string;
  repoName?: string;
}

// ── Pure helper ───────────────────────────────────────────────────────────────

/**
 * Pure function — given a list of agent rows for a single role and a set of
 * scope lookup keys, returns the most specific matching row following the
 * resolution order:
 *
 *   session > repo > user_default
 *
 * Returns `undefined` when no row matches any scope.
 */
export function pickMostSpecificAgent(
  rows: AgentRow[],
  keys: PickScopeKeys,
): AgentRow | undefined {
  // 1. Session scope — exact sessionId match
  if (keys.sessionId) {
    const sessionRow = rows.find(
      (r) => r.scope === "session" && r.sessionId === keys.sessionId,
    );
    if (sessionRow) return sessionRow;
  }

  // 2. Repo scope — exact repoOwner+repoName match
  if (keys.repoOwner && keys.repoName) {
    const repoRow = rows.find(
      (r) =>
        r.scope === "repo" &&
        r.repoOwner === keys.repoOwner &&
        r.repoName === keys.repoName,
    );
    if (repoRow) return repoRow;
  }

  // 3. User-default scope
  const userDefaultRow = rows.find((r) => r.scope === "user_default");
  if (userDefaultRow) return userDefaultRow;

  return undefined;
}

// ── Resolver ──────────────────────────────────────────────────────────────────

export interface ResolveAgentParams {
  userId: string;
  role: AgentRole;
  sessionId?: string;
  repoOwner?: string;
  repoName?: string;
}

/**
 * Resolve the effective agent configuration for a given role + scope context.
 *
 * Resolution order (most specific wins):
 *   1. scope=session  row for {userId, role, sessionId}
 *   2. scope=repo     row for {userId, role, repoOwner, repoName}
 *   3. scope=user_default row for {userId, role}
 *   4. Synthetic built-in fallback derived from userPreferences
 *      → returns exactly today's behavior when zero agent rows exist.
 *
 * The synthetic fallback is CRITICAL: with no `agents` rows every resolution
 * returns exactly today's behavior, so the foundation ships with zero runtime
 * change.
 */
export async function resolveAgentForRole(
  params: ResolveAgentParams,
): Promise<ResolvedAgent> {
  const { userId, role, sessionId, repoOwner, repoName } = params;

  // Fetch all rows for this user+role in one query
  const rows = await listAgentsForUser({ userId, role });

  const matched = pickMostSpecificAgent(rows, {
    sessionId,
    repoOwner,
    repoName,
  });

  if (matched) {
    return rowToResolvedAgent(matched);
  }

  // Synthetic fallback — derived from userPreferences so behavior is unchanged
  // when no agent rows exist.
  const prefs = await getUserPreferences(userId);

  // #1123: only `defaultModelId` is paired with `defaultInferenceProfileId`.
  // The subagent default is a standalone option id, so it carries its own
  // profile inside the composite — never inherit the main model's profile.
  const isSubRole = role !== "main";
  const subagentSelection =
    isSubRole && prefs.defaultSubagentModelId
      ? parseModelOptionSelection(prefs.defaultSubagentModelId)
      : null;

  return {
    role,
    fromDbRow: false,
    agentId: null,
    modelId: subagentSelection?.modelId ?? prefs.defaultModelId,
    inferenceProfileId: subagentSelection
      ? subagentSelection.inferenceProfileId
      : (prefs.defaultInferenceProfileId ?? null),
    instructions: null, // null = use built-in system prompt for the role
    skillRefs: [],
    builtinToolNames: null, // null = use role's default policy from packages/agent
    composioToolkitSlugs: [],
    composioProfileId: null,
    managedRuntimeProfileId: prefs.defaultManagedRuntimeProfileId,
    toolAuthoringEnabled: false,
    githubToolsEnabled: false,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function normalizeSkillRefs(value: unknown): GlobalSkillRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is GlobalSkillRef =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>)["source"] === "string" &&
      typeof (item as Record<string, unknown>)["skillName"] === "string",
  );
}

function rowToResolvedAgent(row: AgentRow): ResolvedAgent {
  return {
    role: row.role,
    fromDbRow: true,
    agentId: row.id,
    modelId: row.modelId,
    inferenceProfileId: row.inferenceProfileId,
    instructions: row.instructions,
    skillRefs: normalizeSkillRefs(row.skillRefs),
    builtinToolNames: row.builtinToolNames,
    composioToolkitSlugs: row.composioToolkitSlugs,
    composioProfileId: row.composioProfileId,
    managedRuntimeProfileId: row.managedRuntimeProfileId,
    toolAuthoringEnabled: row.toolAuthoringEnabled,
    githubToolsEnabled: row.githubToolsEnabled,
  };
}
