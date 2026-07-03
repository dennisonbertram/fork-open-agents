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

const GITHUB_CONNECT_SUCCESS_STATUSES = new Set<GitHubConnectStatus>([
  "account_connected",
  "app_installed",
]);

/**
 * Resolves the final redirect target for a GitHub connect/install return
 * (`post-link`, `install`, `callback` routes), given the resolved
 * `github=<status>` value that route is about to emit.
 *
 * Non-success statuses (anything other than `account_connected` /
 * `app_installed`) always land on `/get-started` carrying `github=<status>`,
 * `step=github`, and `next=<sanitizedNext>` — regardless of what the caller's
 * own next/redirect target was — so the get-started client can render the
 * status notice. Without this, a failure/pending status returning to a
 * non-/get-started target (e.g. bare `/sessions`) would have its status
 * silently dropped by the `/sessions` onboarding gate, which cannot read
 * query params (see PR #829 comment 3516151659).
 *
 * Success statuses keep the existing behavior: redirect to the sanitized
 * `next` target with the status appended (plus `step=github` if that next
 * target happens to be `/get-started`).
 */
export function resolveGitHubReturnTarget(
  status: GitHubConnectStatus | string,
  sanitizedNext: string,
  requestUrl: string,
  options: { missingInstallationId?: boolean } = {},
): URL {
  const isSuccess =
    isKnownGitHubConnectStatus(status) &&
    GITHUB_CONNECT_SUCCESS_STATUSES.has(status);

  const targetUrl = isSuccess
    ? new URL(sanitizedNext, requestUrl)
    : new URL("/get-started", requestUrl);

  targetUrl.searchParams.set("github", status);

  if (!isSuccess) {
    targetUrl.searchParams.set("next", sanitizedNext);
  }

  if (options.missingInstallationId) {
    targetUrl.searchParams.set("missing_installation_id", "1");
  }

  addGitHubStepParamIfGetStarted(targetUrl);

  return targetUrl;
}
