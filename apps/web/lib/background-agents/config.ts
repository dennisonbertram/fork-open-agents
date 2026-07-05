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
 * @deprecated (#914) The turn loop no longer consumes this as its primary
 * budget — see getBackgroundAgentMaxStaleTurns for the no-progress
 * (git-delta) budget that replaced it, and getBackgroundAgentHardTurnCap for
 * the opt-in absolute ceiling BACKGROUND_AGENT_MAX_TURNS now controls.
 * Retained only for backward compatibility (existing callers/tests).
 *
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

/**
 * (#914) BACKGROUND_AGENT_MAX_TURNS is repurposed as an OPT-IN absolute hard
 * ceiling — a runaway safety fuse, not the primary budget. When unset (the
 * default), there is no total-turn cap; only the no-progress (git-delta)
 * budget below applies. Returns null when unset or invalid; clamps a set
 * value to BACKGROUND_AGENT_MAX_TURNS_CEILING.
 */
export function getBackgroundAgentHardTurnCap(): number | null {
  const raw = process.env.BACKGROUND_AGENT_MAX_TURNS?.trim();
  if (!raw || !POSITIVE_INTEGER_PATTERN.test(raw)) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return Math.min(parsed, BACKGROUND_AGENT_MAX_TURNS_CEILING);
}

/**
 * Default number of consecutive no-progress (unchanged git working-tree
 * fingerprint) turns a background-agent run tolerates before being stopped
 * (#914). This is a STARTING VALUE to tune from real
 * background_agent_events data, not a validated target — the epic's
 * estimate range was ~20-25; 20 is picked as the conservative end of that
 * range.
 */
export const DEFAULT_BACKGROUND_AGENT_MAX_STALE_TURNS = 20;

/**
 * Operator override for the no-progress budget via
 * BACKGROUND_AGENT_MAX_STALE_TURNS (#914). Falls back to the default for a
 * missing, non-numeric, non-integer, or non-positive value. Mirrors the
 * strict-parse pattern of getBackgroundAgentMaxTurns.
 */
export function getBackgroundAgentMaxStaleTurns(): number {
  const raw = process.env.BACKGROUND_AGENT_MAX_STALE_TURNS?.trim();
  if (!raw || !POSITIVE_INTEGER_PATTERN.test(raw)) {
    return DEFAULT_BACKGROUND_AGENT_MAX_STALE_TURNS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_BACKGROUND_AGENT_MAX_STALE_TURNS;
  }

  return parsed;
}

/**
 * Default number of consecutive turns whose whole-turn tool-call signature
 * repeats identically (or forms a short A/B-style cycle) before a
 * background-agent run is flagged as stalled (#915). This is a STARTING
 * VALUE to tune from real background_agent_events
 * `background-agent.progress.repetition_detected` data, not a validated
 * target.
 */
export const DEFAULT_BACKGROUND_AGENT_REPETITION_THRESHOLD = 6;

/**
 * Operator override for the action-repetition budget via
 * BACKGROUND_AGENT_REPETITION_THRESHOLD (#915). Falls back to the default
 * for a missing, non-numeric, non-integer, or non-positive value. Mirrors
 * the strict-parse pattern of getBackgroundAgentMaxStaleTurns.
 */
export function getBackgroundAgentRepetitionThreshold(): number {
  const raw = process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD?.trim();
  if (!raw || !POSITIVE_INTEGER_PATTERN.test(raw)) {
    return DEFAULT_BACKGROUND_AGENT_REPETITION_THRESHOLD;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_BACKGROUND_AGENT_REPETITION_THRESHOLD;
  }

  return parsed;
}

/**
 * Default number of consecutive stalled turns tolerated AFTER the initial
 * re-plan nudge before a stalled background-agent run is escalated to the
 * tool-aware "finalize now" instruction (#916). This is a STARTING VALUE to
 * tune from real background_agent_events `background-agent.progress.*`
 * data, not a validated target.
 */
export const DEFAULT_BACKGROUND_AGENT_STALL_GRACE_TURNS = 5;

/**
 * Operator override for the post-nudge grace window via
 * BACKGROUND_AGENT_STALL_GRACE_TURNS (#916). Falls back to the default for a
 * missing, non-numeric, non-integer, or non-positive value. Mirrors the
 * strict-parse pattern of getBackgroundAgentMaxStaleTurns.
 */
export function getBackgroundAgentStallGraceTurns(): number {
  const raw = process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS?.trim();
  if (!raw || !POSITIVE_INTEGER_PATTERN.test(raw)) {
    return DEFAULT_BACKGROUND_AGENT_STALL_GRACE_TURNS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_BACKGROUND_AGENT_STALL_GRACE_TURNS;
  }

  return parsed;
}

/**
 * Default number of turns an escalated (stalled) background-agent run gets
 * to commit/push and/or post a stuck-report comment before the run is
 * terminated (#916). This is a STARTING VALUE to tune from real
 * background_agent_events data, not a validated target.
 */
export const DEFAULT_BACKGROUND_AGENT_STALL_FINALIZE_TURNS = 3;

/**
 * Operator override for the post-escalation finalize window via
 * BACKGROUND_AGENT_STALL_FINALIZE_TURNS (#916). Falls back to the default
 * for a missing, non-numeric, non-integer, or non-positive value. Mirrors
 * the strict-parse pattern of getBackgroundAgentMaxStaleTurns.
 */
export function getBackgroundAgentStallFinalizeTurns(): number {
  const raw = process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS?.trim();
  if (!raw || !POSITIVE_INTEGER_PATTERN.test(raw)) {
    return DEFAULT_BACKGROUND_AGENT_STALL_FINALIZE_TURNS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_BACKGROUND_AGENT_STALL_FINALIZE_TURNS;
  }

  return parsed;
}
