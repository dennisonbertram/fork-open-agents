import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  getAgentLoopsAllowedRepos,
  isAgentLoopsEnabled,
} from "@/lib/agent-loops/config";
import type {
  AgentLoopsReadinessCheck,
  AgentLoopsReadinessResponse,
} from "../types";

/**
 * GET /api/agent-loops/readiness
 *
 * Returns the readiness state of the agent loops feature.
 * Mirrors the background-agents readiness pattern:
 *   - Named checks with status/missing fields
 *   - Never exposes secret values
 */
export async function GET(_req?: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const enabled = isAgentLoopsEnabled();
  const allowedRepos = getAgentLoopsAllowedRepos();

  // Check 1: feature flag
  // Check 2: repo allowlist
  // allowedRepos === null means wildcard (unrestricted) which is ready.
  // allowedRepos = Set means an explicit allowlist is configured (also ready — operator opted in).
  const checks: AgentLoopsReadinessCheck[] = [
    {
      id: "feature_flag",
      label: "Feature flag",
      status: enabled ? "ready" : "disabled",
      detail:
        "AGENT_LOOPS_ENABLED gates trigger dispatch and run creation for agent loops.",
      missing: enabled ? [] : ["AGENT_LOOPS_ENABLED"],
    },
    {
      id: "repo_allowlist",
      label: "Repository allowlist",
      status: "ready",
      detail:
        allowedRepos === null
          ? "AGENT_LOOPS_ALLOWED_REPOS is unset — all repositories are allowed (wildcard)."
          : `AGENT_LOOPS_ALLOWED_REPOS is configured with ${allowedRepos.size} entr${allowedRepos.size === 1 ? "y" : "ies"}.`,
      missing: [],
    },
  ];

  const response: AgentLoopsReadinessResponse = {
    enabled,
    checks,
  };

  return Response.json(response);
}
