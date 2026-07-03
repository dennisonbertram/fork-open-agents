import type { GitHubSyncErrorKind } from "@/lib/github/sync-status";

/**
 * Structured logging for the shared `github-installation-sync` failure path
 * (issue #783), used by the callback, install, post-link, and
 * connection-status routes when a caught `syncUserInstallations` error is
 * classified via `classifyGitHubSyncError`.
 *
 * Replaces the bare `console.error` calls previously scattered across those
 * four routes with one typed, greppable event per outcome.
 *
 * Debug recipe:
 * `grep '"module":"github-installation-sync"' <logs> | grep '"errorKind":"sync_failed"'`
 * to find real backend sync failures instead of user no-ops.
 *
 * Redaction: never pass the raw GitHub token or `GitHubInstallationsSyncError`
 * response body here — only `error.name`/`error.status`/a truncated message
 * via `describeGitHubSyncError`.
 */

const MODULE = "github-installation-sync" as const;

export type GitHubInstallationSyncRoute =
  | "callback"
  | "install"
  | "post-link"
  | "connection-status";

function logSyncEvent(params: {
  level: "warn" | "info";
  event: "sync_failed" | "auth_required";
  userId: string;
  route: GitHubInstallationSyncRoute;
  errorKind: GitHubSyncErrorKind;
  providerStatus?: number | null;
}): void {
  const payload = {
    module: MODULE,
    event: params.event,
    level: params.level,
    userId: params.userId,
    route: params.route,
    errorKind: params.errorKind,
    ...(params.providerStatus !== undefined
      ? { providerStatus: params.providerStatus }
      : {}),
  };

  if (params.level === "warn") {
    console.warn(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}

export function logGitHubSyncFailed(params: {
  userId: string;
  route: GitHubInstallationSyncRoute;
  providerStatus: number | null;
}): void {
  logSyncEvent({
    level: "warn",
    event: "sync_failed",
    userId: params.userId,
    route: params.route,
    errorKind: "sync_failed",
    providerStatus: params.providerStatus,
  });
}

export function logGitHubSyncAuthRequired(params: {
  userId: string;
  route: GitHubInstallationSyncRoute;
}): void {
  logSyncEvent({
    level: "info",
    event: "auth_required",
    userId: params.userId,
    route: params.route,
    errorKind: "auth_required",
  });
}
