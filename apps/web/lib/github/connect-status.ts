import { z } from "zod";

/**
 * Shared vocabulary for the `github=<status>` redirect param emitted by
 * `install/route.ts`, `callback/route.ts`, and `post-link/route.ts` when a
 * user returns from a GitHub connect/install attempt.
 *
 * `invalid_state` and `sync_failed` are forward-compatible members: no route
 * emits them yet (sibling tickets T3 and T4), but the rendering surface must
 * already treat them as known, non-crashing statuses.
 */
export const GITHUB_CONNECT_STATUSES = [
  "account_connected",
  "app_installed",
  "request_sent",
  "pending_sync",
  "no_action",
  "app_not_configured",
  "not_linked",
  "link_failed",
  "invalid_state",
  "sync_failed",
] as const;

export const gitHubConnectStatusSchema = z.enum(GITHUB_CONNECT_STATUSES);

export type GitHubConnectStatus = (typeof GITHUB_CONNECT_STATUSES)[number];

/**
 * Parses a raw `github` search-param value, returning it unchanged (or `null`
 * when absent). Unrecognized non-null values are preserved as-is so callers
 * can render a forward-compatible "unknown status" branch instead of
 * crashing on a status this module doesn't know about yet — use
 * `isKnownGitHubConnectStatus` to narrow to the known `GitHubConnectStatus`
 * union when needed.
 */
export function parseGitHubConnectStatus(
  rawStatus: string | null,
): string | null {
  if (!rawStatus) {
    return null;
  }

  return rawStatus;
}

export function isKnownGitHubConnectStatus(
  status: string,
): status is GitHubConnectStatus {
  return gitHubConnectStatusSchema.safeParse(status).success;
}

/**
 * Adds `step=github` to a redirect URL when its pathname resolves to
 * `/get-started`, so the GitHub connect step auto-opens on arrival. No-op for
 * any other redirect target (e.g. `/settings/connections`), which does not
 * use the `step` param.
 */
export function addGitHubStepParamIfGetStarted(url: URL): void {
  if (url.pathname === "/get-started") {
    url.searchParams.set("step", "github");
  }
}
