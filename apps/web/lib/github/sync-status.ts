import { isGitHubInstallationsAuthError } from "@/lib/github/sync";

/**
 * Typed classification for a caught `syncUserInstallations` error, shared by
 * the GitHub App callback, install, post-link, and connection-status routes
 * (issue #783). Replaces four bespoke `catch` blocks that previously
 * swallowed non-auth sync failures and let the route fall through to an
 * ambiguous or false-success state.
 */
export type GitHubSyncErrorKind = "auth_required" | "sync_failed";

/**
 * Classifies a caught sync error as `"auth_required"` (401/403 per
 * `isGitHubInstallationsAuthError`) or `"sync_failed"` (any other thrown
 * error/non-2xx response). Callers should keep the existing reconnect
 * vocabulary for `"auth_required"` and emit `sync_failed` (or the
 * `connection-status` degraded status) for everything else.
 */
export function classifyGitHubSyncError(error: unknown): GitHubSyncErrorKind {
  return isGitHubInstallationsAuthError(error)
    ? "auth_required"
    : "sync_failed";
}

/**
 * Extracts a redaction-safe error kind/status summary for structured
 * logging. Never logs the raw GitHub API response body or a bearer token —
 * only `error.name` and, when available, `error.status` (a numeric HTTP
 * status) plus a truncated message.
 */
export function describeGitHubSyncError(error: unknown): {
  errorName: string;
  providerStatus: number | null;
  message: string;
} {
  if (error instanceof Error) {
    const providerStatus =
      "status" in error && typeof error.status === "number"
        ? error.status
        : null;

    return {
      errorName: error.name,
      providerStatus,
      message: error.message.slice(0, 200),
    };
  }

  return {
    errorName: "UnknownError",
    providerStatus: null,
    message: "Non-Error value thrown during GitHub installation sync",
  };
}
