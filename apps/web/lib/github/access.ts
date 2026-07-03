import { getInstallationByAccountLogin } from "@/lib/db/installations";
import {
  logInstallationResyncAttempted,
  logInstallationResyncFailed,
  logInstallationResyncSucceeded,
} from "./access-events";
import { withScopedInstallationOctokit } from "./app";
import { getUserOctokit } from "./client";
import { syncUserInstallations } from "./sync";
import { getUserGitHubToken } from "./token";
import { getGitHubUsername } from "./users";

export type RepoAccessDeniedReason =
  | "no_user_token"
  | "user_no_access"
  | "user_no_write"
  | "no_installation"
  | "app_no_access";

export type RequiredRepoUserPermission = "read" | "write";

export type RepoAccessResult =
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
      /** Resolved user permission level for the repo. "write" when the user
       * has push, maintain, or admin access; "read" otherwise. Callers can use
       * this to conditionally include write-grade tools without a second
       * round-trip. */
      userPermission: "read" | "write";
    }
  | { ok: false; reason: RepoAccessDeniedReason };

function hasUserWritePermission(
  permissions:
    | {
        admin: boolean;
        maintain?: boolean;
        push: boolean;
      }
    | undefined,
): boolean {
  return Boolean(
    permissions?.admin || permissions?.maintain || permissions?.push,
  );
}

/**
 * Best-effort re-sync of the user's GitHub App installations, used only when
 * `verifyRepoAccess` finds no local installation row for the owner (issue
 * #791). Mirrors the token + username lookup already used by the GitHub App
 * callback route (`app/api/github/app/callback/route.ts`) rather than
 * duplicating it. Never throws — any failure to resolve a token/username or
 * to sync is caught and folded into a `false` return so the caller can fall
 * back to the existing "no_installation" result.
 */
async function attemptInstallationResync(params: {
  userId: string;
  owner: string;
}): Promise<boolean> {
  const { userId, owner } = params;

  const userToken = await getUserGitHubToken(userId);
  if (!userToken) {
    logInstallationResyncFailed({
      userId,
      owner,
      errorKind: "resync_token_missing",
    });
    return false;
  }

  const username = await getGitHubUsername(userId);
  if (!username) {
    logInstallationResyncFailed({
      userId,
      owner,
      errorKind: "resync_token_missing",
    });
    return false;
  }

  logInstallationResyncAttempted({ userId, owner });

  try {
    const syncedCount = await syncUserInstallations(
      userId,
      userToken,
      username,
    );
    logInstallationResyncSucceeded({ userId, owner, syncedCount });
    return true;
  } catch {
    logInstallationResyncFailed({
      userId,
      owner,
      errorKind: "resync_sync_failed",
    });
    return false;
  }
}

function getGitHubHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }

  if (
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "status" in error.response &&
    typeof error.response.status === "number"
  ) {
    return error.response.status;
  }

  return null;
}

/**
 * Verify that the user can access a repo AND the GitHub App installation
 * covers it. Returns the installationId on success.
 *
 * This enforces the intersection: user permissions ∩ installation scope.
 */
export async function verifyRepoAccess(params: {
  userId: string;
  owner: string;
  repo: string;
  requiredUserPermission?: RequiredRepoUserPermission;
}): Promise<RepoAccessResult> {
  const { userId, owner, repo, requiredUserPermission = "read" } = params;

  // 1. check user can see the repo
  const userOctokit = await getUserOctokit(userId);
  if (!userOctokit) {
    return { ok: false, reason: "no_user_token" };
  }

  let repositoryId: number;
  let defaultBranch: string;
  let resolvedUserPermission: "read" | "write" = "read";
  try {
    const userRepoResponse = await userOctokit.rest.repos.get({ owner, repo });
    repositoryId = userRepoResponse.data.id;
    defaultBranch = userRepoResponse.data.default_branch;
    resolvedUserPermission = hasUserWritePermission(
      userRepoResponse.data.permissions,
    )
      ? "write"
      : "read";
    if (
      requiredUserPermission === "write" &&
      resolvedUserPermission === "read"
    ) {
      return { ok: false, reason: "user_no_write" };
    }
  } catch (error: unknown) {
    const status = getGitHubHttpStatus(error);
    if (status === 404 || status === 403) {
      return { ok: false, reason: "user_no_access" };
    }
    throw error;
  }

  // 2. check installation exists for this owner
  let installation = await getInstallationByAccountLogin(userId, owner);
  if (!installation) {
    // The local installations DB row can lag right after a fresh GitHub App
    // install/callback (issue #791). Attempt one best-effort re-sync before
    // giving up, then re-read — never retry more than once per call.
    const resynced = await attemptInstallationResync({ userId, owner });
    if (resynced) {
      installation = await getInstallationByAccountLogin(userId, owner);
    }
  }
  if (!installation) {
    return { ok: false, reason: "no_installation" };
  }

  // 3. check installation covers this specific repo
  try {
    await withScopedInstallationOctokit({
      installationId: installation.installationId,
      repositoryId,
      permissions: { contents: "read" },
      operation: async (installationOctokit) => {
        await installationOctokit.rest.repos.get({ owner, repo });
      },
    });
  } catch (error: unknown) {
    const status = getGitHubHttpStatus(error);
    const message = error instanceof Error ? error.message : "";
    if (
      status === 404 ||
      status === 403 ||
      status === 422 ||
      message.includes(": 422 ")
    ) {
      return { ok: false, reason: "app_no_access" };
    }
    throw error;
  }

  return {
    ok: true,
    installationId: installation.installationId,
    repositoryId,
    defaultBranch,
    userPermission: resolvedUserPermission,
  };
}

/**
 * Map access denial reasons to user-facing error messages.
 */
export function getRepoAccessErrorMessage(
  reason: RepoAccessDeniedReason,
): string {
  switch (reason) {
    case "no_user_token":
      return "Connect GitHub to access repositories";
    case "user_no_access":
      return "You don't have access to this repository";
    case "user_no_write":
      return "You need write access to this repository to perform this action";
    case "no_installation":
      return "GitHub App not installed for this organization. Install it from Settings > Connections.";
    case "app_no_access":
      return "GitHub App doesn't have access to this repository. Ask an org admin to update the app's repository permissions.";
  }
}
