import "server-only";

function normalizeRepoKey(owner: string, repo: string): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
}

export function isAgentLoopsEnabled(): boolean {
  return process.env.AGENT_LOOPS_ENABLED === "true";
}

export function getAgentLoopsAllowedRepos(): Set<string> | null {
  const rawValue = process.env.AGENT_LOOPS_ALLOWED_REPOS?.trim();
  if (!rawValue) {
    return null;
  }

  const entries = rawValue
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (entries.includes("*")) {
    return null;
  }

  return new Set(entries);
}

export function isAgentLoopRepoAllowed(owner: string, repo: string): boolean {
  const allowedRepos = getAgentLoopsAllowedRepos();
  if (!allowedRepos) {
    return true;
  }

  return allowedRepos.has(normalizeRepoKey(owner, repo));
}
