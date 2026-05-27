import { connectSandbox, withTemporaryGitHubAuth } from "@open-agents/sandbox";
import { requireOwnedSession } from "@/app/api/sessions/_lib/session-context";
import { checkBotProtection } from "@/lib/botid";
import { getInstallationByAccountLogin } from "@/lib/db/installations";
import { updateSession } from "@/lib/db/sessions";
import {
  mintInstallationToken,
  revokeInstallationToken,
} from "@/lib/github/app";
import {
  getRepoAccessErrorMessage,
  verifyRepoAccess,
} from "@/lib/github/access";
import { getUserGitHubToken } from "@/lib/github/token";
import {
  isValidGitHubRepoName,
  isValidGitHubRepoOwner,
} from "@/lib/github/urls";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

// Allow up to 2 minutes for git operations
export const maxDuration = 120;

interface CreateRepoRequest {
  sessionId: string;
  owner: string;
  repoName: string;
  description?: string;
  isPrivate: boolean;
}

interface GitHubCreateRepoResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  owner: {
    login: string;
  };
}

class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function getGitHubApiErrorMessage(status: number, body: string): string {
  if (status === 401) {
    return "Reconnect GitHub before creating a repository.";
  }
  if (status === 403) {
    return "GitHub denied repository creation. Reconnect GitHub and approve repository permissions, then try again.";
  }
  if (status === 422) {
    return "GitHub could not create that repository. The name may already be taken for this account.";
  }
  return `GitHub repository creation failed (${status}): ${body}`;
}

function parseCreateRepoRequest(
  rawBody: unknown,
): { ok: true; data: CreateRepoRequest } | { ok: false; error: string } {
  if (!rawBody || typeof rawBody !== "object") {
    return { ok: false, error: "Invalid create repository request" };
  }

  const body = rawBody as Record<string, unknown>;
  const sessionId = body.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { ok: false, error: "Session id is required" };
  }

  const owner = body.owner;
  if (typeof owner !== "string" || !isValidGitHubRepoOwner(owner)) {
    return { ok: false, error: "Invalid repository owner" };
  }

  const repoName = body.repoName;
  if (typeof repoName !== "string" || !isValidGitHubRepoName(repoName)) {
    return { ok: false, error: "Invalid repository name" };
  }

  const description =
    typeof body.description === "string" ? body.description.trim() : undefined;
  if (description !== undefined && description.length > 350) {
    return { ok: false, error: "Description is too long" };
  }

  if (body.isPrivate !== undefined && typeof body.isPrivate !== "boolean") {
    return { ok: false, error: "Invalid private repository value" };
  }

  return {
    ok: true,
    data: {
      sessionId,
      owner,
      repoName,
      description,
      isPrivate: body.isPrivate ?? false,
    },
  };
}

function isGitHubCreateRepoResponse(
  value: unknown,
): value is GitHubCreateRepoResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const repo = value as Record<string, unknown>;
  const owner = repo.owner as Record<string, unknown> | undefined;
  return (
    typeof repo.id === "number" &&
    typeof repo.name === "string" &&
    typeof repo.full_name === "string" &&
    typeof repo.html_url === "string" &&
    typeof repo.clone_url === "string" &&
    !!owner &&
    typeof owner.login === "string"
  );
}

async function createGitHubRepository(params: {
  token: string;
  owner: string;
  ownerType: "User" | "Organization";
  repoName: string;
  description?: string;
  isPrivate: boolean;
}): Promise<GitHubCreateRepoResponse> {
  const endpoint =
    params.ownerType === "Organization"
      ? `https://api.github.com/orgs/${params.owner}/repos`
      : "https://api.github.com/user/repos";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      name: params.repoName,
      description: params.description,
      private: params.isPrivate,
      auto_init: false,
      has_issues: true,
      has_projects: true,
      has_wiki: false,
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new GitHubApiError(
      getGitHubApiErrorMessage(response.status, responseText),
      response.status,
    );
  }

  const parsedJson = JSON.parse(responseText) as unknown;
  if (!isGitHubCreateRepoResponse(parsedJson)) {
    throw new Error("GitHub returned an invalid repository response.");
  }

  return parsedJson;
}

async function addRepositoryToInstallation(params: {
  token: string;
  installationId: number;
  repositoryId: number;
}): Promise<boolean> {
  const response = await fetch(
    `https://api.github.com/user/installations/${params.installationId}/repositories/${params.repositoryId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${params.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  return response.ok || response.status === 304;
}

function toGitErrorMessage(result: {
  stderr?: string;
  stdout?: string;
}): string {
  return result.stderr?.trim() || result.stdout?.trim() || "Git command failed";
}

async function runGitCommand(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
  command: string,
  timeoutMs: number,
): Promise<void> {
  const result = await sandbox.exec(
    command,
    sandbox.workingDirectory,
    timeoutMs,
  );
  if (!result.success) {
    throw new Error(toGitErrorMessage(result));
  }
}

async function prepareSandboxRepository(params: {
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
  repoCloneUrl: string;
  branch: string;
}): Promise<void> {
  const { sandbox, repoCloneUrl, branch } = params;

  await runGitCommand(sandbox, "git status --short", 10_000);
  await runGitCommand(sandbox, `git branch -M ${branch}`, 10_000);
  await runGitCommand(sandbox, "git add -A", 20_000);

  const diffResult = await sandbox.exec(
    "git diff --cached --quiet",
    sandbox.workingDirectory,
    20_000,
  );
  if (diffResult.exitCode === 1) {
    await runGitCommand(sandbox, 'git commit -m "Initial commit"', 60_000);
  } else if (!diffResult.success) {
    throw new Error(toGitErrorMessage(diffResult));
  }

  await sandbox.exec(
    "git remote remove origin",
    sandbox.workingDirectory,
    10_000,
  );
  await runGitCommand(sandbox, `git remote add origin ${repoCloneUrl}`, 10_000);
}

async function pushSandboxRepository(params: {
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
  token: string;
  branch: string;
}): Promise<void> {
  await withTemporaryGitHubAuth(params.sandbox, params.token, () =>
    runGitCommand(
      params.sandbox,
      `GIT_TERMINAL_PROMPT=0 git push -u origin ${params.branch}`,
      60_000,
    ),
  );
}

export async function POST(req: Request) {
  // 1. Validate session
  const session = await getServerSession();
  if (!session?.user) {
    return jsonError("Not authenticated", 401);
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return jsonError("Access denied", 403);
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["github-create-repo", session.user.id]),
    limit: 5,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsedBody = parseCreateRepoRequest(rawBody);
  if (!parsedBody.ok) {
    return jsonError(parsedBody.error, 400);
  }

  const body = parsedBody.data;
  const ownedSession = await requireOwnedSession({
    userId: session.user.id,
    sessionId: body.sessionId,
  });
  if (!ownedSession.ok) {
    return ownedSession.response;
  }

  if (
    ownedSession.sessionRecord.repoOwner ||
    ownedSession.sessionRecord.repoName
  ) {
    return jsonError("Session is already connected to a repository", 409);
  }

  if (!isSandboxActive(ownedSession.sessionRecord.sandboxState)) {
    return jsonError("Sandbox not initialized", 400);
  }

  const installation = await getInstallationByAccountLogin(
    session.user.id,
    body.owner,
  );
  if (!installation) {
    return jsonError(
      "Install the GitHub App on this account before creating a repository.",
      403,
    );
  }

  const userToken = await getUserGitHubToken(session.user.id);
  if (!userToken) {
    return jsonError("Reconnect GitHub before creating a repository.", 403);
  }

  const branch = "main";

  try {
    const createdRepo = await createGitHubRepository({
      token: userToken,
      owner: body.owner,
      ownerType: installation.accountType,
      repoName: body.repoName,
      description: body.description,
      isPrivate: body.isPrivate,
    });

    if (installation.repositorySelection === "selected") {
      await addRepositoryToInstallation({
        token: userToken,
        installationId: installation.installationId,
        repositoryId: createdRepo.id,
      }).catch((error) => {
        console.warn(
          `Failed to add ${createdRepo.full_name} to GitHub App installation ${installation.installationId}:`,
          error,
        );
      });
    }

    const sandbox = await connectSandbox(
      ownedSession.sessionRecord.sandboxState,
    );
    await prepareSandboxRepository({
      sandbox,
      repoCloneUrl: createdRepo.clone_url,
      branch,
    });

    const access = await verifyRepoAccess({
      userId: session.user.id,
      owner: createdRepo.owner.login,
      repo: createdRepo.name,
      requiredUserPermission: "write",
    });

    if (access.ok) {
      const pushToken = await mintInstallationToken({
        installationId: access.installationId,
        repositoryIds: [access.repositoryId],
        permissions: { contents: "write" },
      });
      try {
        await pushSandboxRepository({
          sandbox,
          token: pushToken.token,
          branch,
        });
      } finally {
        await revokeInstallationToken(pushToken.token);
      }
    } else {
      console.warn(
        `GitHub App access unavailable after creating ${createdRepo.full_name}: ${access.reason}`,
      );
      await pushSandboxRepository({
        sandbox,
        token: userToken,
        branch,
      });
    }

    await updateSession(body.sessionId, {
      repoOwner: createdRepo.owner.login,
      repoName: createdRepo.name,
      cloneUrl: createdRepo.clone_url,
      branch,
      isNewBranch: false,
    });

    return Response.json({
      repoUrl: createdRepo.html_url,
      owner: createdRepo.owner.login,
      repoName: createdRepo.name,
      cloneUrl: createdRepo.clone_url,
      branch,
      appAccess: access.ok ? "verified" : "needs_update",
      ...(access.ok
        ? {}
        : { appAccessMessage: getRepoAccessErrorMessage(access.reason) }),
    });
  } catch (error) {
    console.error("Failed to create GitHub repository:", error);
    return jsonError(
      error instanceof Error ? error.message : "Failed to create repository",
      error instanceof GitHubApiError ? error.status : 500,
    );
  }
}
