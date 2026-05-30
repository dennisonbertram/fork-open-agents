import "server-only";

function normalizeRepoKey(owner: string, repo: string): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
}

export function isBackgroundAgentsEnabled(): boolean {
  return process.env.BACKGROUND_AGENTS_ENABLED === "true";
}

export function getBackgroundAgentsAllowedRepos(): Set<string> | null {
  const rawValue = process.env.BACKGROUND_AGENTS_ALLOWED_REPOS?.trim();
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

export function isBackgroundAgentRepoAllowed(
  owner: string,
  repo: string,
): boolean {
  const allowedRepos = getBackgroundAgentsAllowedRepos();
  if (!allowedRepos) {
    return true;
  }

  return allowedRepos.has(normalizeRepoKey(owner, repo));
}

export function getBackgroundAgentsCronSecret(): string | null {
  return (
    process.env.BACKGROUND_AGENTS_CRON_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    null
  );
}

export function getBackgroundAgentsWebhookSecret(): string | null {
  return process.env.BACKGROUND_AGENTS_WEBHOOK_SECRET?.trim() || null;
}
