/**
 * Structured logging for the `verifyRepoAccess` installation-resync path
 * (issue #791). Right after a user completes GitHub App installation, the
 * local installations DB row can lag behind GitHub's own state; these events
 * make that best-effort re-sync attempt observable instead of silent.
 *
 * Debug recipe:
 * `grep '"service":"github-access"' <logs> | grep '"userId":"<id>"'`
 *
 * Redaction: never log the user's GitHub token or full installation
 * payload — only userId, owner, counts, and boolean success/failure.
 */

const SERVICE = "github-access" as const;

export type GitHubAccessResyncErrorKind =
  | "resync_sync_failed"
  | "resync_still_missing"
  | "resync_token_missing";

function logAccessEvent(params: {
  level: "info" | "warn";
  event: string;
  userId: string;
  owner: string;
  extra?: Record<string, unknown>;
}): void {
  const payload = {
    service: SERVICE,
    event: params.event,
    level: params.level,
    userId: params.userId,
    owner: params.owner,
    ...params.extra,
  };

  if (params.level === "warn") {
    console.warn(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}

export function logInstallationResyncAttempted(params: {
  userId: string;
  owner: string;
}): void {
  logAccessEvent({
    level: "info",
    event: "installation-resync-attempted",
    userId: params.userId,
    owner: params.owner,
  });
}

export function logInstallationResyncSucceeded(params: {
  userId: string;
  owner: string;
  syncedCount: number;
}): void {
  logAccessEvent({
    level: "info",
    event: "installation-resync-succeeded",
    userId: params.userId,
    owner: params.owner,
    extra: { syncedCount: params.syncedCount },
  });
}

export function logInstallationResyncFailed(params: {
  userId: string;
  owner: string;
  errorKind: GitHubAccessResyncErrorKind;
}): void {
  logAccessEvent({
    level: "warn",
    event: "installation-resync-failed",
    userId: params.userId,
    owner: params.owner,
    extra: { errorKind: params.errorKind },
  });
}
