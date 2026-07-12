import "server-only";

import { getInstallationsByUserId } from "@/lib/db/installations";
import { listUserInstallationRepositories } from "@/lib/github/repos";
import { getUserGitHubToken } from "@/lib/github/token";
import { hasGitHubAccount } from "@/lib/github/users";

const DIRECTORY_REPOSITORIES_PER_INSTALLATION = 100;

type DirectoryStatus =
  | "ready"
  | "empty"
  | "github_not_connected"
  | "installation_required"
  | "partial"
  | "error";

export type RepositoryDirectoryErrorKind =
  | "provider_unavailable"
  | "provider_invalid_response"
  | "partial_provider_failure";

export type RepositoryDirectoryItem = {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  updatedAt: string;
  language: string | null;
};

export type RepositoryDirectorySnapshot = {
  status: DirectoryStatus;
  repositories: RepositoryDirectoryItem[];
  installationCount: number;
  failedInstallationCount: number;
  requestId: string;
  errorKind?: RepositoryDirectoryErrorKind;
};

type OwnedInstallation = {
  installationId: number;
  accountLogin: string;
};

export type RepositoryDirectoryDependencies = {
  hasGitHubAccount: (userId: string) => Promise<boolean>;
  getInstallations: (userId: string) => Promise<OwnedInstallation[]>;
  getUserToken: (userId: string) => Promise<string | null>;
  listInstallationRepositories: typeof listUserInstallationRepositories;
  createRequestId: () => string;
};

const defaultDependencies: RepositoryDirectoryDependencies = {
  hasGitHubAccount,
  getInstallations: getInstallationsByUserId,
  getUserToken: getUserGitHubToken,
  listInstallationRepositories: listUserInstallationRepositories,
  createRequestId: () => crypto.randomUUID(),
};

function classifyProviderError(error: unknown): RepositoryDirectoryErrorKind {
  return error instanceof Error &&
    error.message.startsWith(
      "Invalid GitHub user installation repositories response",
    )
    ? "provider_invalid_response"
    : "provider_unavailable";
}

function safeErrorSnapshot(params: {
  requestId: string;
  installationCount: number;
  failedInstallationCount: number;
  errorKind: Exclude<RepositoryDirectoryErrorKind, "partial_provider_failure">;
}): RepositoryDirectorySnapshot {
  return {
    status: "error",
    repositories: [],
    installationCount: params.installationCount,
    failedInstallationCount: params.failedInstallationCount,
    errorKind: params.errorKind,
    requestId: params.requestId,
  };
}

function activityTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function preferCandidate(
  current: RepositoryDirectoryItem,
  candidate: RepositoryDirectoryItem,
): RepositoryDirectoryItem {
  const activityDifference =
    activityTimestamp(candidate.updatedAt) -
    activityTimestamp(current.updatedAt);
  if (activityDifference > 0) return candidate;
  if (activityDifference < 0) return current;
  return candidate.fullName.localeCompare(current.fullName) < 0
    ? candidate
    : current;
}

function compareRepositories(
  left: RepositoryDirectoryItem,
  right: RepositoryDirectoryItem,
): number {
  const activityDifference =
    activityTimestamp(right.updatedAt) - activityTimestamp(left.updatedAt);
  if (activityDifference !== 0) return activityDifference;
  const normalizedDifference = left.fullName
    .toLowerCase()
    .localeCompare(right.fullName.toLowerCase());
  return normalizedDifference || left.fullName.localeCompare(right.fullName);
}

export async function loadRepositoryDirectory(
  userId: string,
  dependencies: RepositoryDirectoryDependencies = defaultDependencies,
): Promise<RepositoryDirectorySnapshot> {
  const requestId = dependencies.createRequestId();
  let linked: boolean;
  try {
    linked = await dependencies.hasGitHubAccount(userId);
  } catch {
    return safeErrorSnapshot({
      requestId,
      installationCount: 0,
      failedInstallationCount: 0,
      errorKind: "provider_unavailable",
    });
  }

  if (!linked) {
    return {
      status: "github_not_connected",
      repositories: [],
      installationCount: 0,
      failedInstallationCount: 0,
      requestId,
    };
  }

  let installations: OwnedInstallation[];
  try {
    installations = await dependencies.getInstallations(userId);
  } catch {
    return safeErrorSnapshot({
      requestId,
      installationCount: 0,
      failedInstallationCount: 0,
      errorKind: "provider_unavailable",
    });
  }

  if (installations.length === 0) {
    return {
      status: "installation_required",
      repositories: [],
      installationCount: 0,
      failedInstallationCount: 0,
      requestId,
    };
  }

  let userToken: string | null;
  try {
    userToken = await dependencies.getUserToken(userId);
  } catch {
    return safeErrorSnapshot({
      requestId,
      installationCount: installations.length,
      failedInstallationCount: installations.length,
      errorKind: "provider_unavailable",
    });
  }
  if (!userToken) {
    return safeErrorSnapshot({
      requestId,
      installationCount: installations.length,
      failedInstallationCount: installations.length,
      errorKind: "provider_unavailable",
    });
  }

  const results = await Promise.allSettled(
    installations.map(async (installation) => ({
      installation,
      repositories: await dependencies.listInstallationRepositories({
        installationId: installation.installationId,
        userToken,
        owner: installation.accountLogin,
        limit: DIRECTORY_REPOSITORIES_PER_INSTALLATION,
      }),
    })),
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length === results.length) {
    const invalidResponse = failures.some(
      (failure) =>
        classifyProviderError(failure.reason) === "provider_invalid_response",
    );
    return safeErrorSnapshot({
      requestId,
      installationCount: installations.length,
      failedInstallationCount: failures.length,
      errorKind: invalidResponse
        ? "provider_invalid_response"
        : "provider_unavailable",
    });
  }

  const uniqueRepositories = new Map<string, RepositoryDirectoryItem>();
  for (const result of results) {
    if (result.status === "rejected") continue;
    for (const repository of result.value.repositories) {
      const item: RepositoryDirectoryItem = {
        owner: result.value.installation.accountLogin,
        name: repository.name,
        fullName: `${result.value.installation.accountLogin}/${repository.name}`,
        description: repository.description,
        private: repository.private,
        updatedAt: repository.updated_at,
        language: repository.language,
      };
      const key = item.fullName.toLowerCase();
      const current = uniqueRepositories.get(key);
      uniqueRepositories.set(
        key,
        current ? preferCandidate(current, item) : item,
      );
    }
  }

  const repositories = [...uniqueRepositories.values()].sort(
    compareRepositories,
  );
  if (failures.length > 0) {
    return {
      status: "partial",
      repositories,
      installationCount: installations.length,
      failedInstallationCount: failures.length,
      errorKind: "partial_provider_failure",
      requestId,
    };
  }

  return {
    status: repositories.length > 0 ? "ready" : "empty",
    repositories,
    installationCount: installations.length,
    failedInstallationCount: 0,
    requestId,
  };
}
