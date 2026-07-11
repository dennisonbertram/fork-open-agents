import "server-only";

import {
  checkRepositoryAllowlist,
  parseRepositoryAllowlist,
} from "@/lib/repository-allowlist";

export type AgentLoopRepoRefusalReason =
  | "repo_allowlist_unconfigured"
  | "repo_allowlist_invalid"
  | "repo_not_allowed";

export type AgentLoopRepoAccess =
  | { allowed: true }
  | { allowed: false; reason: AgentLoopRepoRefusalReason };

export function isAgentLoopsEnabled(): boolean {
  return process.env.AGENT_LOOPS_ENABLED === "true";
}

export function getAgentLoopsAllowedRepos(): Set<string> | null {
  const policy = getAgentLoopsRepoPolicy();
  return policy.state === "wildcard" ? null : new Set(policy.entries);
}

export function getAgentLoopsRepoPolicy() {
  return parseRepositoryAllowlist(process.env.AGENT_LOOPS_ALLOWED_REPOS);
}

export function getAgentLoopRepoAccess(
  owner: string,
  repo: string,
): AgentLoopRepoAccess {
  const access = checkRepositoryAllowlist(
    getAgentLoopsRepoPolicy(),
    owner,
    repo,
  );
  if (access.allowed) {
    return access;
  }
  const reasonByPolicyReason = {
    missing: "repo_allowlist_unconfigured",
    invalid: "repo_allowlist_invalid",
    not_listed: "repo_not_allowed",
  } as const;
  return { allowed: false, reason: reasonByPolicyReason[access.reason] };
}

export function isAgentLoopRepoAllowed(owner: string, repo: string): boolean {
  return getAgentLoopRepoAccess(owner, repo).allowed;
}

/**
 * Returns the stall threshold in minutes.
 * Runs with status queued/running whose latest event is older than this are
 * considered stalled by the sweep.  Configurable via AGENT_LOOPS_STALL_MINUTES;
 * defaults to 15.
 */
export function getAgentLoopsStallMinutes(): number {
  const raw = process.env.AGENT_LOOPS_STALL_MINUTES?.trim();
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 15;
}
