import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  getAgentLoopsAllowedRepos,
  isAgentLoopRepoAllowed,
  isAgentLoopsEnabled,
} from "@/lib/agent-loops/config";
import type {
  AgentLoopsReadinessCheck,
  AgentLoopsReadinessResponse,
} from "../types";

/**
 * GET /api/agent-loops/readiness?owner=<owner>&repo=<repo>
 *
 * Returns the readiness state of the agent loops feature.
 * Mirrors the background-agents readiness pattern:
 *   - Named checks with status/missing fields
 *   - Never exposes secret values
 *
 * When `owner` and `repo` query params are both present, an additional
 * `repo_access` check is appended reporting whether THIS repository is
 * allowed under the configured allowlist (isAgentLoopRepoAllowed) — used by
 * the create-form precheck (#767) so a user sees "not enabled for loops on
 * this deployment" before submitting, instead of a first-run 403. Omitting
 * owner/repo keeps the response identical to the pre-#767 shape.
 */
export async function GET(req?: Request): Promise<Response> {
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

  const url = req ? new URL(req.url) : null;
  const owner = url?.searchParams.get("owner")?.trim();
  const repo = url?.searchParams.get("repo")?.trim();

  if (owner && repo) {
    const allowed = isAgentLoopRepoAllowed(owner, repo);
    checks.push({
      id: "repo_access",
      label: "This repository",
      status: allowed ? "ready" : "disabled",
      detail: allowed
        ? `${owner}/${repo} is enabled for loops on this deployment.`
        : `${owner}/${repo} isn't enabled for loops on this deployment.`,
      missing: allowed ? [] : ["AGENT_LOOPS_ALLOWED_REPOS"],
    });
  }

  const response: AgentLoopsReadinessResponse = {
    enabled,
    checks,
  };

  return Response.json(response);
}
