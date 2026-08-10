/**
 * Create an empty GitHub repository with the user's OAuth token (#1177).
 *
 * Installation tokens cannot create repos on user accounts, so the user
 * token is the only identity that covers both user and org owners. Error
 * mapping mirrors the session-based create-repo flow so the picker and the
 * git panel surface identical typed errors.
 */

/** Minimal structural slice of Octokit used by this helper. */
export interface CreateEmptyRepoOctokit {
  rest: {
    repos: {
      createForAuthenticatedUser(params: {
        name: string;
        description?: string;
        private?: boolean;
      }): Promise<{ data: CreatedRepoData }>;
      createInOrg(params: {
        org: string;
        name: string;
        description?: string;
        private?: boolean;
      }): Promise<{ data: CreatedRepoData }>;
    };
  };
}

interface CreatedRepoData {
  html_url?: string;
  clone_url?: string;
  name?: string;
  owner?: { login?: string } | null;
}

export type CreateEmptyRepoResult =
  | {
      ok: true;
      owner: string;
      repoName: string;
      repoUrl: string | undefined;
      cloneUrl: string;
    }
  | {
      ok: false;
      error: string;
      errorKind: string;
      status: number;
      /** GitHub's own error message, for server-side diagnostics only. */
      upstreamMessage?: string;
    };

function githubStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function githubMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function createEmptyGitHubRepo({
  octokit,
  repoName,
  description,
  isPrivate,
  owner,
  accountType,
}: {
  octokit: CreateEmptyRepoOctokit;
  repoName: string;
  description?: string;
  isPrivate?: boolean;
  owner?: string;
  accountType?: "User" | "Organization";
}): Promise<CreateEmptyRepoResult> {
  let repoData: CreatedRepoData;
  try {
    const response =
      accountType === "Organization" && owner
        ? await octokit.rest.repos.createInOrg({
            org: owner,
            name: repoName,
            description,
            private: isPrivate,
          })
        : await octokit.rest.repos.createForAuthenticatedUser({
            name: repoName,
            description,
            private: isPrivate,
          });
    repoData = response.data;
  } catch (error) {
    const status = githubStatus(error);
    const upstreamMessage = githubMessage(error, "Unknown GitHub error");
    if (status === 422) {
      return {
        ok: false,
        error: owner
          ? `A repository named "${repoName}" already exists under ${owner}.`
          : `A repository named "${repoName}" already exists.`,
        errorKind: "repo_name_taken",
        status: 409,
        upstreamMessage,
      };
    }
    if (status === 403 || status === 404) {
      return {
        ok: false,
        error:
          "GitHub rejected the request. Reconnect GitHub to grant repository creation access, then try again. If reconnecting offers no new permission, the GitHub App needs repository Administration access enabled by an administrator.",
        errorKind: "github_scope_required",
        status: 403,
        upstreamMessage,
      };
    }
    return {
      ok: false,
      error: githubMessage(error, "Failed to create repository"),
      errorKind: "github_error",
      status: 502,
      upstreamMessage,
    };
  }

  const repoOwner = repoData.owner?.login ?? owner;
  if (!repoData.clone_url || !repoOwner || !repoData.name) {
    return {
      ok: false,
      error:
        "Repository may have been created, but GitHub returned incomplete data. Check GitHub before retrying.",
      errorKind: "github_error",
      status: 502,
    };
  }

  return {
    ok: true,
    owner: repoOwner,
    repoName: repoData.name,
    repoUrl: repoData.html_url,
    cloneUrl: repoData.clone_url,
  };
}
