import {
  getRepoAccessErrorMessage,
  verifyRepoAccess,
  type RepoAccessDeniedReason,
  type RequiredRepoUserPermission,
} from "@/lib/github/access";

type BackgroundAgentRepoReadinessReason =
  | RepoAccessDeniedReason
  | "github_error";

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
