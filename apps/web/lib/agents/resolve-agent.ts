// STUB — to be implemented in the GREEN phase
// Exists only to allow the test runner to import the module and produce
// meaningful behavioral failures rather than "Cannot find module" errors.

export type AgentRole = "main" | "explorer" | "executor" | "design";
export type AgentScope = "user_default" | "repo" | "session";

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
}

export interface ResolvedAgent {
  role: AgentRole;
  modelId: string | null;
  inferenceProfileId: string | null;
  instructions: string | null;
  skillRefs: unknown[];
  builtinToolNames: string[] | null;
  composioToolkitSlugs: string[];
  composioProfileId: string | null;
  managedRuntimeProfileId: string | null;
  toolAuthoringEnabled: boolean;
}

export interface PickScopeKeys {
  sessionId?: string;
  repoOwner?: string;
  repoName?: string;
}

/**
 * STUB — always returns undefined, so tests expecting specific precedence fail.
 */
export function pickMostSpecificAgent(
  _rows: AgentRow[],
  _keys: PickScopeKeys,
): AgentRow | undefined {
  return undefined;
}

export interface ResolveAgentParams {
  userId: string;
  role: AgentRole;
  sessionId?: string;
  repoOwner?: string;
  repoName?: string;
}

/**
 * STUB — always throws so tests fail meaningfully.
 */
export async function resolveAgentForRole(
  _params: ResolveAgentParams,
): Promise<ResolvedAgent> {
  throw new Error("resolveAgentForRole: not yet implemented");
}
