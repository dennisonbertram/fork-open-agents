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

/**
 * Default number of openAgent turns a background-agent run gets before
 * exhaustion. No production evidence justifies raising this from the
 * historical DEFAULT_AGENT_MAX_STEPS value — keep unchanged.
 */
export const DEFAULT_BACKGROUND_AGENT_MAX_TURNS = 16;

/** Hard server-side ceiling: 4x the default, matching the loops guardrail ratio. */
export const BACKGROUND_AGENT_MAX_TURNS_CEILING = 64;

/** Matches a bare base-10 positive integer, e.g. "12" but not "2.5" or "16turns". */
const POSITIVE_INTEGER_PATTERN = /^\d+$/;

/**
 * Operator override for the background-agent turn budget via
 * BACKGROUND_AGENT_MAX_TURNS. Falls back to the default for a missing,
 * non-numeric, non-integer, or non-positive value; clamps to the ceiling.
 * Parsing is strict: the trimmed value must be entirely base-10 digits, so
 * malformed input like "2.5" or "16turns" falls back instead of silently
 * truncating to a partial budget.
 */
export function getBackgroundAgentMaxTurns(): number {
  const raw = process.env.BACKGROUND_AGENT_MAX_TURNS?.trim();
  if (!raw || !POSITIVE_INTEGER_PATTERN.test(raw)) {
    return DEFAULT_BACKGROUND_AGENT_MAX_TURNS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_BACKGROUND_AGENT_MAX_TURNS;
  }

  return Math.min(parsed, BACKGROUND_AGENT_MAX_TURNS_CEILING);
}
