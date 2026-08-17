import {
  getRepoAccessErrorMessage,
  verifyRepoAccess,
  type RepoAccessDeniedReason,
  type RequiredRepoUserPermission,
} from "@/lib/github/access";
import { getBackgroundAgentRepoAccess } from "./config";

type BackgroundAgentRepoReadinessReason =
  | RepoAccessDeniedReason
  | "github_error"
  | "repo_not_allowlisted"
  | "repo_allowlist_unconfigured"
  | "repo_allowlist_invalid";

/**
 * Operator-facing copy for an allowlist refusal. Names the variable that has
 * to change, because the person reading this is the person who can fix it.
 */
function allowlistRefusalMessage(
  reason: string,
  repoOwner: string,
  repoName: string,
): string {
  if (reason === "repo_allowlist_unconfigured") {
    return "BACKGROUND_AGENTS_ALLOWED_REPOS is not configured, so dispatch is denied for every repository. Set it before enabling this agent.";
  }
  if (reason === "repo_allowlist_invalid") {
    return "BACKGROUND_AGENTS_ALLOWED_REPOS contains invalid entries, so dispatch is denied. Correct it before enabling this agent.";
  }
  return `${repoOwner}/${repoName} is not in BACKGROUND_AGENTS_ALLOWED_REPOS, so scheduled and webhook triggers for it are refused. Add it to the allowlist to enable dispatch.`;
}

export type BackgroundAgentRepoReadiness = {
  ready: boolean;
  repoOwner: string;
  repoName: string;
  requiredUserPermission: RequiredRepoUserPermission;
  reason: BackgroundAgentRepoReadinessReason | null;
  message: string;
  installationId: number | null;
  repositoryId: number | null;
  defaultBranch: string | null;
};

export async function getBackgroundAgentRepoReadiness(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
  requiredUserPermission?: RequiredRepoUserPermission;
}): Promise<BackgroundAgentRepoReadiness> {
  const requiredUserPermission = params.requiredUserPermission ?? "write";

  // Check the allowlist FIRST, and check it for THIS repo.
  //
  // The dispatcher refuses a trigger via getBackgroundAgentRepoAccess before it
  // ever looks at GitHub permission. Readiness previously verified only GitHub
  // permission, so a repo absent from the allowlist reported ready and then
  // never ran: one production trigger was refused weekly from 2026-07-06 with
  // `repo_not_allowlisted` while this panel showed green. Readiness that
  // disagrees with the dispatcher is worse than none — it actively tells the
  // operator to stop looking.
  const repoAccess = getBackgroundAgentRepoAccess(
    params.repoOwner,
    params.repoName,
  );
  if (!repoAccess.allowed) {
    return {
      ready: false,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      requiredUserPermission,
      reason: repoAccess.reason,
      message: allowlistRefusalMessage(
        repoAccess.reason,
        params.repoOwner,
        params.repoName,
      ),
      installationId: null,
      repositoryId: null,
      defaultBranch: null,
    };
  }

  try {
    const access = await verifyRepoAccess({
      userId: params.userId,
      owner: params.repoOwner,
      repo: params.repoName,
      requiredUserPermission,
    });

    if (!access.ok) {
      return {
        ready: false,
        repoOwner: params.repoOwner,
        repoName: params.repoName,
        requiredUserPermission,
        reason: access.reason,
        message: getRepoAccessErrorMessage(access.reason),
        installationId: null,
        repositoryId: null,
        defaultBranch: null,
      };
    }

    return {
      ready: true,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      requiredUserPermission,
      reason: null,
      message:
        "GitHub user access and GitHub App installation cover this repo.",
      installationId: access.installationId,
      repositoryId: access.repositoryId,
      defaultBranch: access.defaultBranch,
    };
  } catch (error) {
    console.warn("[background-agents] GitHub repo readiness check failed", {
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      reason: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      ready: false,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      requiredUserPermission,
      reason: "github_error",
      message:
        "GitHub repo readiness could not be verified. Check server logs and GitHub App configuration.",
      installationId: null,
      repositoryId: null,
      defaultBranch: null,
    };
  }
}
