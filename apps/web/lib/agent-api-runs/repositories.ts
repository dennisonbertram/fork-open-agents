import {
  isValidGitHubRepoName,
  isValidGitHubRepoOwner,
  parseGitHubHttpsUrl,
} from "@/lib/github/urls";
import type { TokenRepositoryPolicy } from "@/lib/api-auth/tokens";

export type RepositoryInput = {
  owner: string;
  name: string;
  branch?: string;
  cloneUrl?: string;
  newBranch?: boolean;
};

export type RepositoryValidation =
  | {
      ok: true;
      repository: {
        owner: string;
        name: string;
        branch: string | null;
        cloneUrl: string;
        newBranch: boolean;
      } | null;
    }
  | {
      ok: false;
      status: 400 | 403;
      code: string;
      message: string;
    };

export function normalizeRepository(
  input: RepositoryInput | undefined,
  policy: TokenRepositoryPolicy,
): RepositoryValidation {
  if (!input) {
    // When the token has an explicit repository allowlist, a no-repo (empty-
    // workspace) run is denied. An allowlisted token is scoped to specific
    // repositories; running without one would bypass that restriction entirely.
    if (policy.allowedRepositories) {
      return {
        ok: false,
        status: 403,
        code: "repository_required",
        message:
          "This API token is restricted to specific repositories. A repository must be provided.",
      };
    }
    return {
      ok: true,
      repository: null,
    };
  }

  const owner = input.owner.trim();
  const name = input.name.trim();
  if (!isValidGitHubRepoOwner(owner)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_repository_owner",
      message: "Invalid repository owner.",
    };
  }

  if (!isValidGitHubRepoName(name)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_repository_name",
      message: "Invalid repository name.",
    };
  }

  const repoKey = `${owner}/${name}`.toLowerCase();
  if (
    policy.allowedRepositories &&
    !policy.allowedRepositories
      .map((repo) => repo.toLowerCase())
      .includes(repoKey)
  ) {
    return {
      ok: false,
      status: 403,
      code: "repository_not_allowed",
      message: "The API token is not allowed to access this repository.",
    };
  }

  const cloneUrl = input.cloneUrl ?? `https://github.com/${owner}/${name}.git`;
  const parsedCloneUrl = parseGitHubHttpsUrl(cloneUrl);
  if (
    !parsedCloneUrl ||
    parsedCloneUrl.owner.toLowerCase() !== owner.toLowerCase() ||
    parsedCloneUrl.repo.toLowerCase() !== name.toLowerCase()
  ) {
    return {
      ok: false,
      status: 400,
      code: "clone_url_mismatch",
      message: "Clone URL must match repository owner and name.",
    };
  }

  return {
    ok: true,
    repository: {
      owner,
      name,
      branch: input.branch?.trim() || null,
      cloneUrl,
      newBranch: input.newBranch ?? true,
    },
  };
}
